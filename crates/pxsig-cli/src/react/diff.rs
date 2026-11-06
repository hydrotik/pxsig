//! `react-diff`: each function's result at the merge base and now, classified; the alerts; and
//! `reports/react.json`. Alerts only: nothing here changes an exit code.
//!
//! | `change` | base → now | alert |
//! | --- | --- | --- |
//! | `new-bailout` | `compiled` → `bailout` | yes |
//! | `new-function-bailout` | absent → `bailout` | yes |
//! | `reason-changed` | `bailout` → `bailout` with a stopping rule that was not there | yes |
//! | `new-finding` | a finding (rule) absent at base appears, the function still compiles | yes (note) |
//! | `fixed` | `bailout` → `compiled`, or a finding gone | no |
//! | `still-bailout` | `bailout` → `bailout`, same rules | no |
//! | `unchanged`, `new`, `removed`, `opted-out`, `compiler-error`, `analysis-timeout` | | no |
//!
//! A base side that is not `compiled` or `bailout` gives nothing to compare with: `unchanged`.
//! With no comparison at all (`--all`, no merge base, an unreadable base), `change` is null.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::Result;
use serde_json::{json, Value};

use super::cache;

/// One function on one side, after duplicates are merged and repeated names numbered.
#[derive(Clone)]
struct Func {
    name: String,
    v: Value,
}

fn outcome(f: &Func) -> &str {
    f.v["outcome"].as_str().unwrap_or("")
}

fn diags(f: &Func, stops: bool) -> Vec<&Value> {
    f.v["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|d| d["stops"].as_bool().unwrap_or(false) == stops)
        .collect()
}

/// A diagnostic's rule name (the eslint-plugin-react-hooks rule), else its category.
fn rule(d: &Value) -> String {
    d["rule"]
        .as_str()
        .filter(|r| !r.is_empty())
        .map(String::from)
        .unwrap_or_else(|| d["category"].as_str().unwrap_or("").to_lowercase())
}

fn rules(f: &Func, stops: bool) -> BTreeSet<String> {
    diags(f, stops).into_iter().map(rule).collect()
}

/// A side's functions: the same function logged twice (same name and line) is one, with its
/// diagnostics merged; a second function of the same name in the file is `<name>~2`.
fn functions(result: &Value) -> Vec<Func> {
    let mut merged: Vec<Value> = Vec::new();
    for f in result["functions"].as_array().into_iter().flatten() {
        let same = merged
            .iter_mut()
            .find(|m| m["name"] == f["name"] && m["line"] == f["line"]);
        match same {
            Some(m) => {
                if f["outcome"] == "bailout" {
                    m["outcome"] = json!("bailout");
                }
                let mut ds = m["diagnostics"].as_array().cloned().unwrap_or_default();
                for d in f["diagnostics"].as_array().into_iter().flatten() {
                    if !ds.contains(d) {
                        ds.push(d.clone());
                    }
                }
                m["diagnostics"] = json!(ds);
            }
            None => merged.push(f.clone()),
        }
    }
    merged.sort_by_key(|f| f["line"].as_u64().unwrap_or(0));
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    merged
        .into_iter()
        .map(|v| {
            let base = v["name"].as_str().unwrap_or("anonymous").to_string();
            let n = seen.entry(base.clone()).or_default();
            *n += 1;
            let name = if *n == 1 { base } else { format!("{base}~{n}") };
            Func { name, v }
        })
        .collect()
}

/// The change and, for an alert, the diagnostic its text names.
fn classify<'a>(
    base: Option<&'a Func>,
    head: Option<&'a Func>,
) -> (&'static str, Option<&'a Value>) {
    let Some(h) = head else {
        return ("removed", None);
    };
    let first_new = |stops: bool, old: &BTreeSet<String>| {
        diags(h, stops)
            .into_iter()
            .find(|d| !old.contains(&rule(d)))
    };
    let none = BTreeSet::new();
    match (outcome(h), base.map(outcome)) {
        ("opted-out", _) => ("opted-out", None),
        ("compiler-error", _) => ("compiler-error", None),
        ("analysis-timeout", _) => ("analysis-timeout", None),
        ("bailout", None) => ("new-function-bailout", first_new(true, &none)),
        ("bailout", Some("compiled")) => ("new-bailout", first_new(true, &none)),
        ("bailout", Some("bailout")) => match first_new(true, &rules(base.unwrap(), true)) {
            Some(d) => ("reason-changed", Some(d)),
            None => ("still-bailout", None),
        },
        ("compiled", None) => match first_new(false, &none) {
            Some(d) => ("new-finding", Some(d)),
            None => ("new", None),
        },
        ("compiled", Some("bailout")) => ("fixed", None),
        ("compiled", Some("compiled")) => {
            let b = base.unwrap();
            match first_new(false, &rules(b, false)) {
                Some(d) => ("new-finding", Some(d)),
                None if !rules(b, false).is_subset(&rules(h, false)) => ("fixed", None),
                None => ("unchanged", None),
            }
        }
        _ => ("unchanged", None),
    }
}

fn alert_text(
    change: &str,
    f: &Func,
    path: &str,
    d: Option<&Value>,
    since: &str,
    reach: &str,
) -> String {
    let (reason, rule, line) = match d {
        Some(d) => (
            d["reason"]
                .as_str()
                .unwrap_or("")
                .trim_end_matches('.')
                .to_string(),
            rule(d),
            d["line"].as_u64().or(f.v["line"].as_u64()).unwrap_or(0),
        ),
        None => (
            String::new(),
            String::new(),
            f.v["line"].as_u64().unwrap_or(0),
        ),
    };
    let why = format!("{reason} ({rule}, line {line})");
    let name = &f.name;
    match change {
        "new-bailout" => {
            format!("{name} ({path}): compiled at {since}, skipped now: {why}. {reach}")
        }
        "new-function-bailout" => {
            format!("{name} ({path}): new, skipped by the React Compiler: {why}.")
        }
        "reason-changed" => format!("{name} ({path}): still skipped, for a new reason: {why}."),
        _ => format!("{name} ({path}): {why}. It still compiles."),
    }
}

/// A side's result: from the cache when the plan found it there, else from this run's results
/// (stored in the cache when it is a real compile result, unless `write` is off).
fn side_result(
    side: &Value,
    results: &Value,
    cache_dir: &Path,
    write: bool,
    cached: &mut usize,
) -> Result<Value> {
    let sha = side["sha"].as_str().unwrap_or("");
    if side["hit"] == true {
        if let Some(r) = cache::read(cache_dir, sha) {
            *cached += 1;
            return Ok(r);
        }
    }
    let r = results["results"][sha].clone();
    if r["functions"].is_array() && r.get("error").is_none() {
        if write {
            cache::write(cache_dir, sha, &r)?;
        }
        return Ok(r);
    }
    Ok(json!({ "error": r["error"].as_str().unwrap_or("missing") }))
}

/// `reports/react.json` from a plan and the worker results. `write: false` (another process holds
/// the store) reads the cache and writes nothing to it.
pub fn diff(plan: &Value, results: &Value, cache_dir: &Path, write: bool) -> Result<Value> {
    let since = plan["base"]["since"]
        .as_str()
        .unwrap_or("the base")
        .to_string();
    let mut cached = 0;
    let (mut files, mut funcs, mut alerts) = (Vec::new(), Vec::new(), Vec::new());
    let mut n = BTreeMap::<&str, u64>::new();
    for f in plan["files"].as_array().into_iter().flatten() {
        let path = f["path"].as_str().unwrap_or("");
        let entries = f["entries"].as_array().map_or(0, Vec::len);
        let reach = if f["all"] == true {
            "Reaches every entry.".to_string()
        } else if entries == 1 {
            "Reaches 1 entry.".to_string()
        } else {
            format!("Reaches {entries} entries.")
        };
        let head = side_result(&f["head"], results, cache_dir, write, &mut cached)?;
        let base = if f["base"].is_object() {
            Some(side_result(
                &f["base"],
                results,
                cache_dir,
                write,
                &mut cached,
            )?)
        } else {
            None
        };
        let state = |s: &Value, r: &Value| -> Value {
            match r["error"].as_str() {
                Some(e) => json!(e),
                None if s["hit"] == true => json!("cached"),
                None => json!("compiled"),
            }
        };
        // `ids`: the entries the file reaches (none listed when it reaches every entry).
        files.push(json!({
            "path": path, "entries": entries, "all": f["all"],
            "ids": if f["all"] == true { Value::Null } else { f["entries"].clone() },
            "head": state(&f["head"], &head),
            "base": base.as_ref().map(|b| state(&f["base"], b)),
        }));
        if head.get("error").is_some() {
            continue;
        }
        let compare =
            f["compare"] == true && base.as_ref().is_none_or(|b| b.get("error").is_none());
        let hs = functions(&head);
        let bs = base.as_ref().map(functions).unwrap_or_default();
        let mut names: Vec<&str> = hs.iter().map(|x| x.name.as_str()).collect();
        if compare {
            names.extend(
                bs.iter()
                    .map(|x| x.name.as_str())
                    .filter(|b| !hs.iter().any(|h| h.name == *b)),
            );
        }
        for name in names {
            let h = hs.iter().find(|x| x.name == name);
            let b = bs.iter().find(|x| x.name == name);
            let (change, d) = if compare { classify(b, h) } else { ("", None) };
            let alert = matches!(
                change,
                "new-bailout" | "new-function-bailout" | "reason-changed" | "new-finding"
            );
            let any = h.or(b).unwrap();
            let id = format!("{path}#{name}");
            let side = |x: Option<&Func>| {
                x.map(|x| {
                    let mut s = json!({ "outcome": outcome(x) });
                    if let Some(m) = x.v.get("memoSlots") {
                        s["memoSlots"] = m.clone();
                    }
                    if x.v["diagnostics"].as_array().is_some_and(|a| !a.is_empty()) {
                        s["diagnostics"] = x.v["diagnostics"].clone();
                    }
                    s
                })
            };
            funcs.push(json!({
                "id": id, "name": name, "kind": any.v["kind"], "line": any.v["line"],
                "base": side(b), "head": side(h),
                "change": if compare { json!(change) } else { Value::Null }, "alert": alert,
            }));
            if let Some(h) = h {
                *n.entry(match outcome(h) {
                    "compiled" => "compiled",
                    "bailout" => "bailouts",
                    "opted-out" => "optedOut",
                    _ => "other",
                })
                .or_default() += 1;
                *n.entry("findings").or_default() += diags(h, false).len() as u64;
            }
            *n.entry(match change {
                "new-bailout" | "new-function-bailout" => "newBailouts",
                "new-finding" => "newFindings",
                "fixed" => "fixed",
                _ => "other",
            })
            .or_default() += 1;
            if alert {
                let text = alert_text(change, any, path, d, &since, &reach);
                alerts.push(json!({
                    "kind": "compiler", "id": id, "name": name, "path": path, "change": change,
                    "level": if change == "new-finding" { "note" } else { "warning" },
                    "rule": d.map(rule), "line": d.and_then(|d| d["line"].as_u64()).or(any.v["line"].as_u64()),
                    "text": text,
                }));
            }
        }
    }
    let c = |k: &str| n.get(k).copied().unwrap_or(0);
    let summary = json!({
        "files": files.len(), "functions": funcs.len(), "compiled": c("compiled"), "bailouts": c("bailouts"),
        "newBailouts": c("newBailouts"), "findings": c("findings"), "newFindings": c("newFindings"),
        "fixed": c("fixed"), "optedOut": c("optedOut"), "alerts": alerts.len(),
        "ms": results["ms"], "cached": cached,
    });
    Ok(json!({
        "v": 1, "generatedAt": crate::io::iso_now(), "project": results["project"], "mode": "alert",
        "backend": results["backend"], "base": plan["base"], "files": files, "functions": funcs,
        "alerts": alerts, "skipped": plan["skipped"], "notes": plan["notes"], "summary": summary,
    }))
}
