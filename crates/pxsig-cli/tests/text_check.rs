//! `pxsig check` labels each row's text (`textDiff`) on the fixture corpus: the kind per case,
//! the states that compare nothing, and the cache that keys on the text record.

mod text_corpus;

use serde_json::{json, Value};
use text_corpus::{build_in, check, plan, rows, scratch};

const ENV: &str = "aaaabbbbccccdddd";

fn checked(name: &str, extra: &[&str]) -> std::collections::BTreeMap<String, Value> {
    let d = scratch(name);
    build_in(&d, true, Some(ENV));
    plan(&d, "other.json", "eeeeffff00001111");
    let (_, v) = check(&d, extra);
    let _ = std::fs::remove_dir_all(&d);
    rows(&v)
}

#[test]
fn each_case_gets_its_kind() {
    let r = checked("kinds", &["--env", "@env.json"]);
    let kind = |id: &str| r[id]["textDiff"]["kind"].clone();
    let state = |id: &str| r[id]["textDiff"]["state"].clone();
    for (id, k) in [
        ("copy-reflow", json!("copy-reflow")),
        ("copy", json!("copy")),
        ("pixel", json!("pixel")),
        ("restyled", json!("restyled")),
        ("moved", json!("moved")),
        ("same", Value::Null),
    ] {
        assert_eq!(state(id), json!("compared"), "{id}: {}", r[id]);
        assert_eq!(kind(id), k, "{id}: {}", r[id]["textDiff"]);
    }
    let reflow = &r["copy-reflow"]["textDiff"];
    assert_eq!(reflow["outsidePx"], json!(0));
    let moved = reflow["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "moved")
        .unwrap();
    assert_eq!(
        (moved["dx"].clone(), moved["pushed"].clone()),
        (json!(4.0), json!(true))
    );
    // An identical render: nothing drawn changed, so no text change either.
    assert_eq!(r["same"]["textDiff"]["changeCount"], json!(0));
    assert_eq!(r["same"]["textDiff"]["outsidePx"], json!(0));
    assert_eq!(state("no-record"), json!("no-baseline"));
    assert!(
        r["no-render"].get("textDiff").is_none(),
        "an error row has no textDiff"
    );
}

#[test]
fn a_copy_change_under_the_gate_is_labelled_and_still_passes() {
    let r = checked("passing", &["--env", "@env.json"]);
    let row = &r["copy-passing"];
    assert_eq!(row["pass"], json!(true), "{row}");
    assert!(row.get("pixels").is_none(), "a passing row lists no pixels");
    assert_eq!(row["textDiff"]["kind"], json!("copy"));
    assert_eq!(row["textDiff"]["changes"][0]["was"], json!("Total"));
}

#[test]
fn a_truncated_record_is_compared_and_says_so() {
    let r = checked("truncated", &["--env", "@env.json"]);
    let t = &r["truncated"]["textDiff"];
    assert_eq!(
        (t["state"].clone(), t["truncated"].clone()),
        (json!("compared"), json!(true))
    );
    assert_eq!(t["kind"], json!("copy"));
}

#[test]
fn another_or_an_unknown_environment_compares_no_text() {
    for extra in [&["--env", "@other.json"][..], &[][..]] {
        let r = checked(&format!("env-{}", extra.len()), extra);
        for (id, row) in &r {
            if id == "no-render" {
                continue;
            }
            assert_eq!(
                row["textDiff"],
                json!({ "v": 1, "state": "env-differs" }),
                "{id} {extra:?}"
            );
        }
    }
}

#[test]
fn the_cache_keys_on_the_text_record_and_the_environment() {
    let d = scratch("cache");
    build_in(&d, true, Some(ENV));
    plan(&d, "other.json", "eeeeffff00001111");
    let only = ["--only", "copy", "--cache", "cache"];
    let run = |extra: &[&str]| rows(&check(&d, &[&only[..], extra].concat()).1)["copy"].clone();
    let first = run(&["--env", "@env.json"]);
    assert_eq!(
        (first["cached"].clone(), first["textDiff"]["kind"].clone()),
        (json!(false), json!("copy"))
    );
    assert_eq!(run(&["--env", "@env.json"])["cached"], json!(true));
    let other = run(&["--env", "@other.json"]);
    assert_eq!(
        other["cached"],
        json!(false),
        "another environment is another result"
    );
    assert_eq!(other["textDiff"]["state"], json!("env-differs"));
    // A changed text record (the same render): not the cached result.
    let f = d.join("cur/copy.boxes.json");
    let mut rec: Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
    rec["runs"][0]["s"] = json!("abe");
    std::fs::write(&f, rec.to_string()).unwrap();
    let changed = run(&["--env", "@env.json"]);
    assert_eq!(changed["cached"], json!(false));
    assert_eq!(changed["textDiff"]["changes"][0]["now"], json!("abe"));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn a_record_that_does_not_read_is_an_error_state_named_without_its_folder() {
    let d = scratch("bad");
    build_in(&d, true, Some(ENV));
    std::fs::write(d.join("cur/copy.boxes.json"), "{ not json").unwrap();
    let (_, v) = check(&d, &["--env", "@env.json", "--only", "copy"]);
    let t = &rows(&v)["copy"]["textDiff"];
    assert_eq!(t["state"], json!("error"));
    let msg = t["error"].as_str().unwrap();
    assert!(msg.starts_with("copy.boxes.json: "), "{msg}");
    assert!(!msg.contains(&*d.to_string_lossy()), "{msg}");
    assert_eq!(
        rows(&v)["copy"]["pass"],
        json!(false),
        "the verdict is the gate's"
    );
    let _ = std::fs::remove_dir_all(&d);
}
