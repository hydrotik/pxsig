//! `react-diff` on hand-made plans and results: every `change`, the alert texts, the cache.

use serde_json::{json, Value};

use super::cache;
use super::diff::diff;
use super::plan_tests::tmp;

fn compiled(name: &str, line: u64) -> Value {
    json!({ "name": name, "kind": "component", "line": line, "endLine": line + 5, "outcome": "compiled", "memoSlots": 3, "diagnostics": [] })
}

fn bailout(name: &str, line: u64, rule: &str, reason: &str, at: u64) -> Value {
    json!({ "name": name, "kind": "component", "line": line, "endLine": line + 5, "outcome": "bailout",
            "diagnostics": [{ "rule": rule, "category": "Refs", "reason": reason, "line": at, "severity": "error", "stops": true }] })
}

fn with_finding(mut f: Value, rule: &str, reason: &str, at: u64) -> Value {
    f["diagnostics"].as_array_mut().unwrap().push(json!({ "rule": rule, "category": "EffectSetState", "reason": reason, "line": at, "stops": false }));
    f
}

fn other(name: &str, outcome: &str) -> Value {
    json!({ "name": name, "kind": "hook", "line": 90, "outcome": outcome, "diagnostics": [] })
}

/// One file, both sides missing from the cache, results given inline.
fn run(base: Option<Vec<Value>>, head: Vec<Value>, compare: bool) -> (Value, std::path::PathBuf) {
    let d = tmp("diff");
    let has_base = base.is_some();
    let plan = json!({
        "v": 1, "base": { "since": "main", "commit": "4883bcd" }, "skipped": [], "notes": [],
        "files": [{ "path": "src/Button/Button.tsx", "entries": ["a", "b", "c"], "all": false, "compare": compare,
                    "head": { "sha": "aa11", "hit": false },
                    "base": if has_base { json!({ "sha": "bb22", "hit": false }) } else { Value::Null } }],
    });
    let results = json!({
        "backend": { "name": "babel", "compiler": "1.0.0", "babel": "7.29.7" }, "project": "ui", "ms": 12,
        "results": { "aa11": { "functions": head }, "bb22": { "functions": base.unwrap_or_default() } },
    });
    (diff(&plan, &results, &d).unwrap(), d)
}

fn change(r: &Value, name: &str) -> String {
    r["functions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["name"] == name)
        .map(|f| f["change"].as_str().unwrap_or("null").to_string())
        .unwrap_or_else(|| panic!("{name} not in {r:#}"))
}

#[test]
fn every_change_row() {
    let base = vec![
        compiled("NewBailout", 10),
        compiled("Same", 20),
        bailout("Fixed", 30, "refs", "Cannot access refs during render", 31),
        bailout("Still", 40, "refs", "Cannot access refs during render", 41),
        bailout("Reason", 50, "refs", "Cannot access refs during render", 51),
        compiled("Gone", 60),
        with_finding(
            compiled("FindingGone", 70),
            "set-state-in-effect",
            "Calling setState in an effect",
            71,
        ),
        compiled("NewFinding", 80),
        other("Opted", "compiled"),
    ];
    let head = vec![
        bailout(
            "NewBailout",
            10,
            "refs",
            "Cannot access refs during render.",
            18,
        ),
        compiled("Same", 20),
        compiled("Fixed", 30),
        bailout("Still", 40, "refs", "Cannot access refs during render", 41),
        bailout(
            "Reason",
            50,
            "set-state-in-render",
            "Calling setState during render",
            77,
        ),
        bailout(
            "Brand",
            55,
            "immutability",
            "This value cannot be modified",
            56,
        ),
        compiled("Fresh", 57),
        compiled("FindingGone", 70),
        with_finding(
            compiled("NewFinding", 80),
            "set-state-in-effect",
            "Calling setState synchronously within an effect can trigger cascading renders",
            81,
        ),
        other("Opted", "opted-out"),
        other("Broke", "compiler-error"),
        other("Slow", "analysis-timeout"),
    ];
    let (r, _) = run(Some(base), head, true);
    for (name, want) in [
        ("NewBailout", "new-bailout"),
        ("Same", "unchanged"),
        ("Fixed", "fixed"),
        ("Still", "still-bailout"),
        ("Reason", "reason-changed"),
        ("Brand", "new-function-bailout"),
        ("Fresh", "new"),
        ("Gone", "removed"),
        ("FindingGone", "fixed"),
        ("NewFinding", "new-finding"),
        ("Opted", "opted-out"),
        ("Broke", "compiler-error"),
        ("Slow", "analysis-timeout"),
    ] {
        assert_eq!(change(&r, name), want, "{name}");
    }
    let texts: Vec<&str> = r["alerts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, [
        "NewBailout (src/Button/Button.tsx): compiled at main, skipped now: Cannot access refs during render (refs, line 18). Reaches 3 entries.",
        "Reason (src/Button/Button.tsx): still skipped, for a new reason: Calling setState during render (set-state-in-render, line 77).",
        "Brand (src/Button/Button.tsx): new, skipped by the React Compiler: This value cannot be modified (immutability, line 56).",
        "NewFinding (src/Button/Button.tsx): Calling setState synchronously within an effect can trigger cascading renders (set-state-in-effect, line 81). It still compiles.",
    ]);
    let levels: Vec<&str> = r["alerts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["level"].as_str().unwrap())
        .collect();
    assert_eq!(levels, ["warning", "warning", "warning", "note"]);
    assert_eq!(r["alerts"][0]["id"], "src/Button/Button.tsx#NewBailout");
    let s = &r["summary"];
    assert_eq!(
        (
            s["alerts"].as_u64(),
            s["newBailouts"].as_u64(),
            s["newFindings"].as_u64(),
            s["fixed"].as_u64()
        ),
        (Some(4), Some(2), Some(1), Some(2))
    );
    assert_eq!(
        (
            s["compiled"].as_u64(),
            s["bailouts"].as_u64(),
            s["optedOut"].as_u64(),
            s["findings"].as_u64()
        ),
        (Some(5), Some(4), Some(1), Some(1))
    );
    assert_eq!(
        (s["files"].as_u64(), s["ms"].as_u64(), s["cached"].as_u64()),
        (Some(1), Some(12), Some(0))
    );
    assert_eq!(
        (r["v"].clone(), r["mode"].clone(), r["project"].clone()),
        (json!(1), json!("alert"), json!("ui"))
    );
    assert_eq!(
        r["files"],
        json!([{ "path": "src/Button/Button.tsx", "entries": 3, "all": false, "head": "compiled", "base": "compiled" }])
    );
}

#[test]
fn duplicates_merge_and_repeated_names_are_numbered() {
    let dup = bailout("Card", 10, "refs", "Cannot access refs during render", 12);
    let head = vec![dup.clone(), dup, compiled("Card", 30), compiled("Card", 50)];
    let (r, _) = run(None, head, true);
    let names: Vec<&str> = r["functions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Card", "Card~2", "Card~3"]);
    assert_eq!(
        r["functions"][0]["head"]["diagnostics"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(r["functions"][1]["id"], "src/Button/Button.tsx#Card~2");
    // A new file: its skipped function alerts, the compiled ones are new.
    assert_eq!(change(&r, "Card"), "new-function-bailout");
    assert_eq!(change(&r, "Card~2"), "new");
}

#[test]
fn a_renamed_function_is_one_removed_and_one_new() {
    let (r, _) = run(
        Some(vec![compiled("Old", 10)]),
        vec![compiled("Renamed", 10)],
        true,
    );
    assert_eq!(
        (change(&r, "Old"), change(&r, "Renamed")),
        ("removed".into(), "new".into())
    );
    assert_eq!(r["alerts"], json!([]));
}

#[test]
fn without_a_comparison_nothing_alerts() {
    let (r, _) = run(
        None,
        vec![
            bailout("A", 1, "refs", "x", 2),
            with_finding(compiled("B", 5), "purity", "y", 6),
        ],
        false,
    );
    assert_eq!(change(&r, "A"), "null");
    assert_eq!(r["alerts"], json!([]));
    assert_eq!(r["summary"]["bailouts"], 1);
    assert_eq!(r["summary"]["compiled"], 1);
}

#[test]
fn a_category_without_a_rule_names_the_category() {
    let mut f = bailout("T", 1, "", "Support for this syntax is not implemented", 3);
    f["diagnostics"][0]["category"] = json!("Todo");
    let (r, _) = run(Some(vec![compiled("T", 1)]), vec![f], true);
    assert!(
        r["alerts"][0]["text"]
            .as_str()
            .unwrap()
            .ends_with("(todo, line 3). Reaches 3 entries."),
        "{:#}",
        r["alerts"]
    );
}

#[test]
fn compile_results_are_cached_and_errors_are_not() {
    let (_, d) = run(Some(vec![compiled("A", 1)]), vec![compiled("A", 1)], true);
    assert_eq!(
        cache::read(&d, "aa11").unwrap()["functions"][0]["name"],
        "A"
    );
    assert!(cache::read(&d, "bb22").is_some());
    // A cached side is read back from the cache and counted.
    let plan = json!({ "base": null, "files": [{ "path": "x.tsx", "entries": [], "all": true, "compare": false, "head": { "sha": "aa11", "hit": true }, "base": null }] });
    let r = diff(&plan, &json!({ "results": {} }), &d).unwrap();
    assert_eq!(r["summary"]["cached"], 1);
    assert_eq!(r["files"][0]["head"], "cached");
    assert_eq!(r["functions"][0]["change"], Value::Null);
    // A timed-out file: no functions, not cached.
    let plan = json!({ "base": null, "files": [{ "path": "y.tsx", "entries": [], "all": false, "compare": false, "head": { "sha": "cc33", "hit": false }, "base": null }] });
    let r = diff(
        &plan,
        &json!({ "results": { "cc33": { "error": "analysis-timeout" } } }),
        &d,
    )
    .unwrap();
    assert_eq!(r["files"][0]["head"], "analysis-timeout");
    assert_eq!(r["functions"], json!([]));
    assert!(cache::read(&d, "cc33").is_none());
    // A missing result is reported as missing.
    let r = diff(&plan, &json!({ "results": {} }), &d).unwrap();
    assert_eq!(r["files"][0]["head"], "missing");
}

#[test]
fn a_base_that_failed_compares_nothing_in_that_file() {
    let d = tmp("diff-base-error");
    let plan = json!({ "base": { "since": "main" }, "files": [{ "path": "z.tsx", "entries": ["a"], "all": false, "compare": true,
        "head": { "sha": "dd44", "hit": false }, "base": { "sha": "ee55", "hit": false } }] });
    let results = json!({ "results": { "dd44": { "functions": [bailout("Z", 1, "refs", "x", 2)] }, "ee55": { "error": "analysis-timeout" } } });
    let r = diff(&plan, &results, &d).unwrap();
    assert_eq!(r["files"][0]["base"], "analysis-timeout");
    assert_eq!(change(&r, "Z"), "null");
    assert_eq!(r["alerts"], json!([]));
}
