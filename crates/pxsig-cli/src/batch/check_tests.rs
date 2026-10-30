//! `check`: a manifest that does not load, an entry without a baseline or a render, a corrupt
//! baseline, the content cache and the history line.

use super::tests::{scratch, write_png};
use super::*;
use serde_json::json;

fn opts(d: &Path) -> CheckOpts {
    CheckOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.to_path_buf(),
        out_dir: None,
        artifacts: Artifacts::None,
        only: None,
        cache: None,
        history: None,
        enforcement: None,
        base_png_dir: None,
        tolerance: 16,
        cli_gate: GateSpec::default(),
        env_gate: GateSpec::default(),
    }
}

/// Renders and baselines for `ids` (shade 10), and a manifest listing `ids` then `extra`.
fn store(d: &Path, ids: &[&str], extra: &[&str]) {
    let stories: Vec<Value> = ids
        .iter()
        .chain(extra)
        .map(|id| json!({ "id": id, "sig": format!("s/{id}.psig") }))
        .collect();
    fs::write(d.join("m.json"), json!({ "stories": stories }).to_string()).unwrap();
    for id in ids {
        write_png(&d.join(format!("png/{id}.png")), 10);
        super::capture_png(
            &d.join(format!("png/{id}.png")),
            &d.join(format!("s/{id}.psig")),
            16,
            true,
            None,
            None,
        )
        .unwrap();
    }
}

fn row(res: &Value, id: &str) -> Value {
    res["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == json!(id))
        .unwrap_or_else(|| panic!("no row {id}"))
        .clone()
}

#[test]
fn a_manifest_that_does_not_load_is_an_error_not_a_run() {
    let d = scratch("check-manifest");
    let err = |o: &CheckOpts| format!("{:#}", check(o).err().unwrap());
    assert!(err(&opts(&d)).starts_with("manifest not found: "));
    fs::write(d.join("m.json"), "{ not json").unwrap();
    assert!(err(&opts(&d)).starts_with("manifest is not valid JSON"));
    fs::write(d.join("m.json"), r#"{ "stories": [{ "id": "a" }] }"#).unwrap();
    assert!(
        err(&opts(&d)).starts_with("manifest is not valid JSON"),
        "an entry without its sig"
    );
    fs::write(d.join("m.json"), r#"{ "stories": [] }"#).unwrap();
    let h = d.join("history.ndjson");
    let o = CheckOpts {
        history: Some(h.clone()),
        ..opts(&d)
    };
    assert_eq!(err(&o), "manifest has no stories");
    assert!(!h.exists(), "no history line for a run that did not happen");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn an_entry_without_a_baseline_or_a_render_fails_with_why() {
    let d = scratch("check-missing");
    store(&d, &["ok", "no-render"], &["no-base"]);
    fs::remove_file(d.join("png/no-render.png")).unwrap();
    let res = check(&opts(&d)).unwrap();
    assert_eq!(res["summary"]["stories"], json!(3));
    assert_eq!(res["summary"]["failed"], json!(2));
    assert_eq!(row(&res, "ok")["pass"], json!(true));
    let nb = row(&res, "no-base");
    assert_eq!(nb["pass"], json!(false));
    assert_eq!(
        nb["error"],
        json!("no baseline sig (run baseline first): s/no-base.psig")
    );
    assert_eq!(nb["note"], nb["error"]);
    let nr = row(&res, "no-render");
    assert_eq!(nr["pass"], json!(false));
    assert!(
        nr["error"].as_str().unwrap().starts_with("PNG not found: "),
        "{nr}"
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_corrupt_baseline_is_an_error_row() {
    let d = scratch("check-corrupt");
    store(&d, &["a", "b"], &[]);
    fs::write(d.join("s/a.psig"), b"{ not a baseline").unwrap();
    let res = check(&opts(&d)).unwrap();
    let a = row(&res, "a");
    assert_eq!(a["pass"], json!(false));
    assert!(
        a["error"]
            .as_str()
            .unwrap()
            .starts_with("baseline is not valid JSON ("),
        "{a}"
    );
    assert_eq!(row(&res, "b")["pass"], json!(true), "the others still run");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_changed_render_fails_and_carries_its_pixel_diff() {
    let d = scratch("check-changed");
    store(&d, &["a"], &[]);
    write_png(&d.join("png/a.png"), 250);
    let r = row(&check(&opts(&d)).unwrap(), "a");
    assert_eq!(r["pass"], json!(false));
    assert!(r["error"].is_null(), "a change, not an error");
    assert!(!r["reasons"].as_array().unwrap().is_empty());
    assert_eq!(
        r["note"],
        json!(r["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("; "))
    );
    assert_eq!(
        r["pixels"]["width"],
        json!(32),
        "from the image inside the .psig"
    );
    assert!(r["pixels"]["changed"].as_u64().unwrap() > 0);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn the_cache_answers_a_repeat_and_history_appends_one_line_per_run() {
    let d = scratch("check-cache");
    store(&d, &["a", "b"], &[]);
    write_png(&d.join("png/b.png"), 250);
    let h = d.join("h/history.ndjson");
    let o = CheckOpts {
        cache: Some(d.join("cache")),
        history: Some(h.clone()),
        enforcement: Some(json!({ "gates": ["visual"], "a11yNew": 0 })),
        ..opts(&d)
    };
    let first = check(&o).unwrap();
    assert_eq!(first["summary"]["cached"], json!(0));
    let second = check(&o).unwrap();
    assert_eq!(second["summary"]["cached"], json!(2));
    assert_eq!(row(&second, "a")["pass"], json!(true));
    assert_eq!(row(&second, "b")["pass"], json!(false), "a cached failure");
    assert_eq!(row(&first, "a")["render"], row(&second, "a")["render"]);
    let lines: Vec<Value> = fs::read_to_string(&h)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["summary"]["failed"], json!(1));
    assert_eq!(lines[1]["rows"]["a"][0], json!(1));
    assert_eq!(lines[1]["rows"]["b"][0], json!(0));
    assert_eq!(lines[1]["enforcement"], json!(["visual"]));
    assert_eq!(lines[1]["wouldFail"], json!(true));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn only_checks_the_selected_entries() {
    let d = scratch("check-only");
    store(&d, &["a", "b"], &["c"]);
    let o = CheckOpts {
        only: Some(["a".to_string()].into_iter().collect()),
        ..opts(&d)
    };
    let res = check(&o).unwrap();
    assert_eq!(res["summary"]["stories"], json!(1));
    assert_eq!(row(&res, "a")["pass"], json!(true));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn artifacts_parse_and_reject_an_unknown_value() {
    assert_eq!(Artifacts::parse("all").unwrap(), Artifacts::All);
    assert_eq!(Artifacts::parse("failed").unwrap(), Artifacts::Failed);
    assert_eq!(Artifacts::parse("none").unwrap(), Artifacts::None);
    assert_eq!(
        Artifacts::parse("some").err().unwrap().to_string(),
        "--artifacts must be all | failed | none (got some)"
    );
}
