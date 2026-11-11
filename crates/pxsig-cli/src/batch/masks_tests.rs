//! Masks (`masks.rs`): the record beside a render, the baseline header's `masks`, and `check`:
//! the same masks pass, a mask added, removed, grown, moved or recounted fails as "masks changed",
//! the large-mask warning, the cache. The limits, `--allow-masks` and baselines written before
//! every baseline recorded masks are in masks_limits_tests.rs.

use super::masks::{changes, large, reason, record};
use super::tests::{scratch, write_png};
use super::*;
use serde_json::json;
use std::path::PathBuf;

/// A mask on a 32×32 render: `(selector, source, boxes)`, one element per box.
pub(super) type M<'a> = (&'a str, &'a str, &'a [[u32; 4]]);

/// A masks record beside `png`, as the capture writes it.
pub(super) fn write_masks(png: &Path, masks: &[M]) {
    let list: Vec<Value> = masks
        .iter()
        .map(|(s, src, b)| {
            let px: u32 = b.iter().map(|r| (r[2] - r[0]) * (r[3] - r[1])).sum();
            json!({ "selector": s, "source": src, "count": b.len(), "px": px, "rects": b })
        })
        .collect();
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": list }).to_string(),
    )
    .unwrap();
}

pub(super) fn opts(d: &Path, cache: Option<PathBuf>) -> CheckOpts {
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

pub(super) fn baseline_opts(d: &Path) -> BaselineOpts {
    BaselineOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.to_path_buf(),
        only: None,
        no_detail: true,
        env: None,
        allow_masks: None,
    }
}

/// One entry `a`: its render and, with `masks`, its record; then its baseline from them.
pub(super) fn store(d: &Path, masks: Option<&[M]>) -> PathBuf {
    let png = d.join("png/a.png");
    write_png(&png, 10);
    let m = json!({ "stories": [{ "id": "a", "sig": "s/a.psig" }] });
    fs::write(d.join("m.json"), m.to_string()).unwrap();
    if let Some(list) = masks {
        write_masks(&png, list);
    }
    assert_eq!(
        baseline(&baseline_opts(d)).unwrap()["summary"]["failed"],
        json!(0)
    );
    png
}

pub(super) fn row(d: &Path, cache: Option<PathBuf>) -> Value {
    check(&opts(d, cache)).unwrap()["results"][0].clone()
}

#[test]
fn the_record_becomes_the_header_masks_with_its_boxes_and_count() {
    let d = scratch("masks-header");
    store(
        &d,
        Some(&[("[data-volatile]", "attribute", &[[0, 0, 16, 16]])]),
    );
    let h = pxsig_core::psig::header(&fs::read(d.join("s/a.psig")).unwrap()).unwrap();
    assert_eq!(
        h["masks"],
        json!({ "v": 1, "coverage": 0.25, "masks": [{ "selector": "[data-volatile]", "source": "attribute",
            "area": 0.25, "count": 1, "px": 256, "rects": [[0, 0, 16, 16]] }] })
    );
    let b = load_baseline(&d.join("s/a.psig")).unwrap();
    assert_eq!(b.masks, Some(h["masks"].clone()));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn no_record_writes_no_masks_and_a_mask_added_later_is_a_change() {
    // Mask audit 1: a baseline written with no mask recorded nothing, so a story mask added later
    // was never "masks changed". Every baseline now records its masks, `[]` for none.
    let d = scratch("masks-none");
    let png = store(&d, None);
    let h = pxsig_core::psig::header(&fs::read(d.join("s/a.psig")).unwrap()).unwrap();
    assert_eq!(h["masks"], json!({ "v": 1, "masks": [] }), "{h}");
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true), "{r}");
    assert!(r.get("masks").is_none() && r.get("masksChanged").is_none());
    write_masks(&png, &[(".live", "story", &[[0, 0, 4, 4]])]);
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false), "{r}");
    assert_eq!(r["masksChanged"]["added"], json!([".live"]), "{r}");
    assert_eq!(r["masksBaseline"], json!([]));
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
        r#"{ "v": 1, "masks": [{ "selector": "x", "source": "elsewhere", "count": 1, "rects": [] }] }"#,
        r#"{ "v": 1, "masks": [{ "selector": "x", "source": "story", "px": 1, "rects": [] }] }"#,
        r#"{ "v": 1, "masks": [{ "selector": "x", "source": "story", "count": 1, "px": 1 }] }"#,
        r#"{ "v": 1, "masks": [{ "selector": "x", "source": "story", "count": 1, "rects": [], "root": 1 }] }"#,
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
    let png = store(&d, Some(&[(".clock", "project", &[[0, 0, 8, 8]])]));
    assert_eq!(row(&d, None)["pass"], json!(true));
    // The volatile content itself changing is no change: the mask covers it.
    write_masks(&png, &[(".clock", "workspace", &[[0, 0, 8, 8]])]);
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true), "a source is a label: {r}");
    write_masks(
        &png,
        &[
            (".clock", "project", &[[0, 0, 8, 16]]),
            ("[data-volatile]", "attribute", &[[20, 20, 22, 24]]),
        ],
    );
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false));
    assert_eq!(
        r["masksChanged"],
        json!({ "added": ["[data-volatile]"], "removed": [], "grew": [".clock"], "moved": [".clock"], "count": [] })
    );
    assert_eq!(
        r["reasons"],
        json!(["masks changed: 1 added, 1 grew, 1 moved"])
    );
    assert_eq!(r["note"], json!("masks changed: 1 added, 1 grew, 1 moved"));
    // The baseline's masks beside the render's, for the reviewer to compare.
    assert_eq!(r["masksBaseline"][0]["selector"], json!(".clock"));
    assert_eq!(r["masksBaseline"][0]["area"], json!(0.0625));
    fs::remove_file(png.with_extension("masks.json")).unwrap();
    let r = row(&d, None);
    assert_eq!(r["masksChanged"]["removed"], json!([".clock"]), "{r}");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn any_growth_is_a_change() {
    // Mask audit 6: growth up to 0.1% of the capture passed. One more row of pixels is "grew".
    let d = scratch("masks-grew");
    let png = store(&d, Some(&[(".clock", "project", &[[0, 0, 10, 10]])]));
    write_masks(&png, &[(".clock", "project", &[[0, 0, 10, 11]])]);
    let r = row(&d, None);
    assert_eq!(r["masksChanged"]["grew"], json!([".clock"]), "{r}");
    assert_eq!(r["pass"], json!(false));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn another_count_or_a_moved_box_is_a_change_and_a_pixel_of_rounding_is_not() {
    // Mask audit 7: one element becoming three at the same area, or a mask moved onto other
    // content, passed or read as a plain pixel change.
    let d = scratch("masks-boxes");
    let png = store(&d, Some(&[(".id", "project", &[[0, 0, 12, 4]])]));
    write_masks(
        &png,
        &[(
            ".id",
            "project",
            &[[0, 0, 4, 4], [4, 0, 8, 4], [8, 0, 12, 4]],
        )],
    );
    let r = row(&d, None);
    assert_eq!(r["masksChanged"]["count"], json!([".id"]), "{r}");
    assert_eq!(r["masksChanged"]["moved"], json!([]), "{r}");
    assert_eq!(r["reasons"], json!(["masks changed: 1 changed count"]));
    write_masks(&png, &[(".id", "project", &[[16, 16, 28, 20]])]);
    let r = row(&d, None);
    assert_eq!(r["masksChanged"]["moved"], json!([".id"]), "{r}");
    write_masks(&png, &[(".id", "project", &[[1, 0, 13, 4]])]);
    let r = row(&d, None);
    assert!(r.get("masksChanged").is_none(), "within a pixel: {r}");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn masks_over_a_quarter_together_warn_and_one_is_listed() {
    // Mask audit 5: the warning was per mask, so masks that each cover less never warned.
    let d = scratch("masks-large");
    store(
        &d,
        Some(&[
            ("#a", "project", &[[0, 0, 32, 5]]),
            ("#b", "story", &[[0, 8, 32, 13]]),
        ]),
    );
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(true), "{r}");
    assert_eq!(r["masksCoverage"], json!(0.3125));
    assert!(r.get("masksLarge").is_none(), "{r}");
    let d2 = scratch("masks-large-one");
    store(&d2, Some(&[("#all", "project", &[[0, 0, 32, 10]])]));
    let r = row(&d2, None);
    assert_eq!(
        r["masksLarge"],
        json!([{ "selector": "#all", "source": "project", "area": 0.3125 }])
    );
    let _ = fs::remove_dir_all(&d);
    let _ = fs::remove_dir_all(&d2);
}

#[test]
fn the_cache_sees_a_masks_change() {
    let d = scratch("masks-cache");
    let png = store(&d, Some(&[(".clock", "project", &[[0, 0, 8, 8]])]));
    let cache = Some(d.join("cache"));
    assert_eq!(row(&d, cache.clone())["pass"], json!(true));
    let again = row(&d, cache.clone());
    assert_eq!(again["cached"], json!(true));
    write_masks(
        &png,
        &[
            (".clock", "project", &[[0, 0, 8, 8]]),
            (".other", "project", &[[9, 9, 11, 11]]),
        ],
    );
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
            .map(|(s, src, a)| json!({ "selector": s, "source": src, "area": a, "count": 1, "rects": [[0, 0, 1, 1]] }))
            .collect();
        json!({ "v": 1, "masks": list })
    };
    let base = m(&[("a", "project", 0.1)]);
    assert!(changes(Some(&base), Some(&m(&[("a", "story", 0.1)])), None).is_none());
    assert!(changes(Some(&base), Some(&m(&[("a", "story", 0.1001)])), None).is_some());
    assert!(changes(None, None, None).is_none());
    let ch = changes(Some(&base), None, None).unwrap();
    assert_eq!(reason(&ch), "masks changed: 1 removed");
    assert!(changes(Some(&m(&[])), Some(&m(&[("s", "story", 0.1)])), None).is_some());
    // A header mask written before counts and boxes were kept cannot show it is the same.
    let bare = json!({ "v": 1, "masks": [{ "selector": "a", "source": "project", "area": 0.1 }] });
    let ch = changes(Some(&bare), Some(&base), None).unwrap();
    assert_eq!(ch["count"], json!(["a"]), "{ch}");
    assert_eq!(
        large(Some(&m(&[("a", "project", 0.25)]))),
        Vec::<Value>::new()
    );
    assert_eq!(large(Some(&m(&[("a", "project", 0.2501)]))).len(), 1);
}

#[test]
fn the_area_counts_the_boxes_inside_the_trimmed_png() {
    // Captured at 200×100, then trimmed to 32×32: the boxes are counted again inside what is
    // left. Overlapping boxes count once.
    let d = scratch("masks-trimmed");
    let png = d.join("png/a.png");
    write_png(&png, 10);
    write_masks(
        &png,
        &[
            ("#gone", "attribute", &[[100, 50, 140, 62]]),
            ("#corner", "attribute", &[[4, 4, 12, 8], [8, 4, 12, 12]]),
        ],
    );
    let rec = record(&png).unwrap().unwrap();
    let areas: Vec<Value> = rec["masks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["area"].clone())
        .collect();
    assert_eq!(areas, [json!(0.0), json!(0.0469)]);
    assert_eq!(rec["masks"][0]["rects"], json!([]));
    assert_eq!(rec["coverage"], json!(0.0469));
    let _ = fs::remove_dir_all(&d);
}
