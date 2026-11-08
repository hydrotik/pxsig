//! Pin: text records are labels only. On a fixture corpus, `pxsig check` gives every row the same
//! gate, reasons, `pass`, note, metrics, detail, pixels and error, and the same exit code, whether
//! the renders and baselines carry text records or not. Only `textDiff` may differ.

mod text_corpus;

use serde_json::Value;
use text_corpus::{build_in, check, rows, scratch};

/// A row without the keys text may add.
fn verdict(r: &Value) -> Value {
    let mut r = r.clone();
    if let Some(o) = r.as_object_mut() {
        o.remove("textDiff");
    }
    r
}

fn run(text: bool, extra: &[&str]) -> (i32, Value) {
    let d = scratch(&format!(
        "pin-{text}-{}",
        extra.join("-").replace(['@', '/', '.'], "")
    ));
    // The baselines' environment is the renders' (`--env @env.json` compares their text).
    build_in(&d, text, Some("aaaabbbbccccdddd"));
    let out = check(&d, extra);
    let _ = std::fs::remove_dir_all(&d);
    out
}

fn assert_same(extra: &[&str]) {
    let (off_code, off) = run(false, extra);
    let (on_code, on) = run(true, extra);
    assert_eq!(off_code, on_code, "exit code with {extra:?}");
    assert_eq!(off["summary"]["failed"], on["summary"]["failed"]);
    let (a, b) = (rows(&off), rows(&on));
    assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
    for (id, r) in &a {
        assert!(
            r.get("textDiff").is_none(),
            "{id}: no text record, no textDiff"
        );
        assert_eq!(verdict(r), verdict(&b[id]), "{id} with {extra:?}");
    }
}

#[test]
fn every_verdict_and_the_exit_code_are_the_same_with_text_on_and_off() {
    assert_same(&[]);
}

#[test]
fn every_verdict_is_the_same_when_text_is_compared() {
    assert_same(&["--env", "@env.json"]);
}

#[test]
fn a_passing_selection_exits_0_with_text_on_and_off() {
    let (off_code, _) = run(false, &["--only", "same"]);
    let (on_code, on) = run(true, &["--only", "same"]);
    assert_eq!((off_code, on_code), (0, 0));
    assert_eq!(on["summary"]["failed"], 0);
}
