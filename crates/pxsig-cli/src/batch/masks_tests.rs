//! Masks (`masks.rs`): the record beside a render, the baseline header's `masks`, and `check`:
//! the same masks pass, a mask added, removed or grown fails as "masks changed", story masks
//! against a baseline that records none, the large-mask warning, the cache.

use super::masks::{changes, large, reason, record};
use super::tests::{scratch, write_png};
use super::*;
use serde_json::json;
use std::path::PathBuf;

/// A masks record for a 32×32 render: `(selector, source, px)`.
fn write_masks(png: &Path, masks: &[(&str, &str, u32)]) {
    let list: Vec<Value> = masks
        .iter()
        .map(|(s, src, px)| json!({ "selector": s, "source": src, "count": 1, "px": px }))
        .collect();
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": list }).to_string(),
    )
    .unwrap();
}

fn opts(d: &Path, cache: Option<PathBuf>) -> CheckOpts {
    CheckOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.to_path_buf(),
        out_dir: None,
        artifacts: Artifacts::None,
        only: None,
        cache,
        history: None,
        enforcement: None,
        history_extra: None,
        base_png_dir: None,
        tolerance: 16,
        cli_gate: GateSpec::default(),
        env_gate: GateSpec::default(),
        env: None,
    }
}

/// One entry `a`: its render and, with `masks`, its record; then its baseline from them.
fn store(d: &Path, masks: Option<&[(&str, &str, u32)]>) -> PathBuf {
    let png = d.join("png/a.png");
    write_png(&png, 10);
    let m = json!({ "stories": [{ "id": "a", "sig": "s/a.psig" }] });
    fs::write(d.join("m.json"), m.to_string()).unwrap();
    if let Some(list) = masks {
        write_masks(&png, list);
    }
    let o = BaselineOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.to_path_buf(),
        only: None,
        no_detail: true,
        env: None,
    };
    assert_eq!(baseline(&o).unwrap()["summary"]["failed"], json!(0));
    png
}

fn row(d: &Path, cache: Option<PathBuf>) -> Value {
    check(&opts(d, cache)).unwrap()["results"][0].clone()
}

#[test]
fn the_record_becomes_the_header_masks_with_each_area() {
    let d = scratch("masks-header");
    store(&d, Some(&[("[data-volatile]", "attribute", 256)]));
    let h = pxsig_core::psig::header(&fs::read(d.join("s/a.psig")).unwrap()).unwrap();
    assert_eq!(
        h["masks"],
        json!({ "v": 1, "masks": [{ "selector": "[data-volatile]", "source": "attribute", "area": 0.25 }] })
    );
    let b = load_baseline(&d.join("s/a.psig")).unwrap();
    assert_eq!(b.masks, Some(h["masks"].clone()));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn no_record_writes_no_header_key_and_reads_as_no_masks() {
    let d = scratch("masks-none");
    store(&d, None);
    let h = pxsig_core::psig::header(&fs::read(d.join("s/a.psig")).unwrap()).unwrap();
    assert!(h.get("masks").is_none(), "{h}");
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true), "{r}");
    assert!(r.get("masks").is_none() && r.get("masksChanged").is_none());
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_record_that_does_not_read_is_an_error() {
    let d = scratch("masks-bad");
    let png = d.join("png/a.png");
    write_png(&png, 10);
    for body in [
        "not json",
        r#"{ "v": 2, "masks": [] }"#,
        r#"{ "v": 1, "masks": [{ "selector": "x", "source": "elsewhere", "px": 1 }] }"#,
    ] {
        fs::write(png.with_extension("masks.json"), body).unwrap();
        let err = format!("{:#}", record(&png).unwrap_err());
        assert!(err.starts_with("a.masks.json"), "{err}");
        assert!(!err.contains(&*d.to_string_lossy()), "no folder in {err}");
    }
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn the_same_masks_pass_and_a_changed_one_fails_with_its_reason() {
    let d = scratch("masks-check");
    let png = store(&d, Some(&[(".clock", "project", 64)]));
    assert_eq!(row(&d, None)["pass"], json!(true));
    // The volatile content itself changing is no change: the mask covers it.
    write_masks(&png, &[(".clock", "workspace", 64)]);
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true), "a source is a label: {r}");
    write_masks(
        &png,
        &[
            (".clock", "project", 128),
            ("[data-volatile]", "attribute", 8),
        ],
    );
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false));
    assert_eq!(
        r["masksChanged"],
        json!({ "added": ["[data-volatile]"], "removed": [], "grew": [".clock"] })
    );
    assert_eq!(r["reasons"], json!(["masks changed: 1 added, 1 grew"]));
    assert_eq!(r["note"], json!("masks changed: 1 added, 1 grew"));
    fs::remove_file(png.with_extension("masks.json")).unwrap();
    let r = row(&d, None);
    assert_eq!(r["masksChanged"]["removed"], json!([".clock"]), "{r}");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn story_masks_against_a_baseline_without_a_record_are_no_change() {
    let d = scratch("masks-story");
    let png = store(&d, None);
    write_masks(&png, &[(".live", "story", 64)]);
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true), "{r}");
    assert_eq!(r["masks"][0]["selector"], json!(".live"));
    write_masks(
        &png,
        &[(".live", "story", 64), ("[data-volatile]", "attribute", 8)],
    );
    let r = row(&d, None);
    assert_eq!(
        r["masksChanged"]["added"],
        json!(["[data-volatile]"]),
        "{r}"
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_mask_over_a_quarter_of_the_capture_is_a_warning_only() {
    let d = scratch("masks-large");
    store(
        &d,
        Some(&[("#all", "project", 300), (".small", "story", 10)]),
    );
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true));
    assert_eq!(
        r["masksLarge"],
        json!([{ "selector": "#all", "source": "project", "area": 0.293 }])
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn the_cache_sees_a_masks_change() {
    let d = scratch("masks-cache");
    let png = store(&d, Some(&[(".clock", "project", 64)]));
    let cache = Some(d.join("cache"));
    assert_eq!(row(&d, cache.clone())["pass"], json!(true));
    let again = row(&d, cache.clone());
    assert_eq!(again["cached"], json!(true));
    write_masks(&png, &[(".clock", "project", 64), (".other", "project", 4)]);
    let r = row(&d, cache);
    assert_eq!(r["cached"], json!(false));
    assert_eq!(r["pass"], json!(false));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn changes_large_and_reason() {
    let m = |l: &[(&str, &str, f64)]| {
        let list: Vec<Value> = l
            .iter()
            .map(|(s, src, a)| json!({ "selector": s, "source": src, "area": a }))
            .collect();
        json!({ "v": 1, "masks": list })
    };
    let base = m(&[("a", "project", 0.1)]);
    assert!(changes(Some(&base), Some(&m(&[("a", "story", 0.1005)]))).is_none());
    assert!(changes(None, None).is_none());
    let ch = changes(Some(&base), None).unwrap();
    assert_eq!(reason(&ch), "masks changed: 1 removed");
    assert!(changes(None, Some(&m(&[("s", "story", 0.9)]))).is_none());
    assert!(changes(Some(&m(&[])), Some(&m(&[("s", "story", 0.1)]))).is_some());
    assert_eq!(
        large(Some(&m(&[("a", "project", 0.25)]))),
        Vec::<Value>::new()
    );
    assert_eq!(large(Some(&m(&[("a", "project", 0.2501)]))).len(), 1);
}
