//! Masks no approval passes (over half the capture together, or on the story root), the baseline
//! writer's `--allow-masks`, baselines written before every baseline recorded masks, and trim with
//! a mask in the bottom-right corner (`masks.rs`, `trim.rs`).

use super::masks_tests::{baseline_opts, row, store, write_masks};
use super::tests::{scratch, write_png};
use super::*;
use crate::io;
use serde_json::json;
use std::path::PathBuf;

/// Four masks of 7 rows each over a 32×32 render: 22% each, 88% together.
const FOUR: [[u32; 4]; 4] = [
    [0, 0, 32, 7],
    [0, 8, 32, 15],
    [0, 16, 32, 23],
    [0, 24, 32, 31],
];

#[test]
fn masks_over_half_the_capture_together_fail_and_no_baseline_is_written() {
    // Mask audit 5: four masks under a quarter each covered most of the capture with no warning.
    // Over half, together, the entry fails, and no approval writes a baseline from it.
    let d = scratch("masks-limit");
    let png = store(&d, None);
    let before = fs::read(d.join("s/a.psig")).unwrap();
    let four: Vec<(&str, &str, &[[u32; 4]])> = [".a", ".b", ".c", ".d"]
        .iter()
        .zip(&FOUR)
        .map(|(s, b)| (*s, "project", std::slice::from_ref(b)))
        .collect();
    write_masks(&png, &four);
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false), "{r}");
    assert_eq!(r["masksBlocked"], json!({ "coverage": 0.875 }), "{r}");
    assert!(
        r.get("masksLarge").is_none(),
        "no mask is over a quarter: {r}"
    );
    let reasons = r["reasons"].as_array().unwrap();
    assert!(
        reasons.contains(&json!("masks cover 88% of the capture, over 50%")),
        "{r}"
    );
    // Neither the baseline writer, with --allow-masks, nor the server's approval writes it.
    let o = BaselineOpts {
        allow_masks: Some(None),
        ..baseline_opts(&d)
    };
    let res = baseline(&o).unwrap();
    assert_eq!(res["summary"]["failed"], json!(1), "{res}");
    assert_eq!(res["failedIds"], json!(["a"]));
    let err = res["errors"][0].as_str().unwrap();
    assert!(
        err.contains("masks cover 88% of the capture, over 50%")
            && err.contains("no approval writes this baseline"),
        "{err}"
    );
    let e = capture_png_policy(&png, &d.join("s/a.psig"), 64, None, false, None, None, None);
    assert!(format!("{:#}", e.unwrap_err()).contains("over 50%"));
    assert_eq!(fs::read(d.join("s/a.psig")).unwrap(), before, "unchanged");
    // The entry stays failing until the masks are smaller.
    assert_eq!(row(&d, None)["masksBlocked"]["coverage"], json!(0.875));
    write_masks(&png, &four[..1]);
    assert!(row(&d, None).get("masksBlocked").is_none());
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_mask_on_the_story_root_fails_whatever_its_share() {
    // Mask audit 4: `#storybook-root > *` masked everything and was only a warning.
    let d = scratch("masks-root");
    let png = store(&d, None);
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": [{ "selector": "#storybook-root > *", "source": "story", "count": 1,
            "px": 16, "rects": [[0, 0, 4, 4]], "root": true }] })
        .to_string(),
    )
    .unwrap();
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false));
    assert_eq!(
        r["masksBlocked"],
        json!({ "root": ["#storybook-root > *"] })
    );
    assert!(r["reasons"]
        .as_array()
        .unwrap()
        .contains(&json!("a mask covers the story root: #storybook-root > *")));
    // A mask over nearly all of the capture covers the root, whatever the capture recorded.
    write_masks(&png, &[("#all", "project", &[[0, 0, 32, 32]])]);
    let r = row(&d, None);
    assert_eq!(
        r["masksBlocked"],
        json!({ "coverage": 1.0, "root": ["#all"] }),
        "{r}"
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn the_baseline_writer_refuses_a_masks_change_without_allow_masks() {
    // Mask audit 11: `pxsig baseline` (and `check --update` through it) wrote mask changes and
    // never said so.
    let d = scratch("masks-allow");
    let png = store(&d, Some(&[(".clock", "project", &[[0, 0, 8, 8]])]));
    let before = fs::read(d.join("s/a.psig")).unwrap();
    write_masks(
        &png,
        &[
            (".clock", "project", &[[0, 0, 8, 12]]),
            (".id", "attribute", &[[10, 10, 12, 12]]),
        ],
    );
    let res = baseline(&baseline_opts(&d)).unwrap();
    assert_eq!(res["summary"]["failed"], json!(1), "{res}");
    assert_eq!(
        res["errors"],
        json!(["a: masks changed (1 added: .id; 1 grew: .clock; 1 moved: .clock): not written; review the masks, then pass --allow-masks"])
    );
    assert_eq!(res["masksChanged"][0]["written"], json!(false));
    assert_eq!(fs::read(d.join("s/a.psig")).unwrap(), before);
    // Allowed for other entries only: still refused.
    let other = BaselineOpts {
        allow_masks: Some(Some(["b".to_string()].into_iter().collect())),
        ..baseline_opts(&d)
    };
    assert_eq!(baseline(&other).unwrap()["summary"]["failed"], json!(1));
    let named = BaselineOpts {
        allow_masks: Some(Some(["a".to_string()].into_iter().collect())),
        ..baseline_opts(&d)
    };
    let res = baseline(&named).unwrap();
    assert_eq!(res["summary"]["failed"], json!(0), "{res}");
    assert_eq!(res["masksChanged"][0]["id"], json!("a"));
    assert_eq!(res["masksChanged"][0]["added"], json!([".id"]));
    assert_eq!(res["masksChanged"][0]["written"], json!(true));
    assert_eq!(row(&d, None)["pass"], json!(true));
    // The same masks again: nothing to allow.
    assert_eq!(
        baseline(&baseline_opts(&d)).unwrap()["masksChanged"],
        json!([])
    );
    let _ = fs::remove_dir_all(&d);
}

/// A baseline as 0.7.6 and earlier wrote it: no `masks` in the header. `paint`: the boxes its
/// image shows painted over, as the capture paints a mask.
fn old_baseline(d: &Path, paint: &[[usize; 4]]) -> PathBuf {
    let png = d.join("png/a.png");
    write_png(&png, 10);
    let (mut data, w, h) = io::decode_png(&png).unwrap();
    for b in paint {
        for y in b[1]..b[3] {
            for x in b[0]..b[2] {
                data[(y * w + x) * 4..][..3].copy_from_slice(&[255, 0, 255]);
            }
        }
    }
    let base = d.join("base.png");
    io::encode_png_pub(&base, w, h, &data).unwrap();
    let rec = capture_png(&base, &d.join("tmp.pxsig.json"), 64, false, None, None).unwrap();
    let image = fs::read(&base).unwrap();
    let entry = json!({ "id": "a" });
    io::write_baseline(
        &d.join("s/a.psig"),
        &rec,
        Some(&image),
        Some(&entry),
        None,
        &[],
    )
    .unwrap();
    fs::write(
        d.join("m.json"),
        json!({ "stories": [{ "id": "a", "sig": "s/a.psig" }] }).to_string(),
    )
    .unwrap();
    let header = pxsig_core::psig::header(&fs::read(d.join("s/a.psig")).unwrap()).unwrap();
    assert!(header.get("masks").is_none());
    // The render as the capture made it, the same mask painted: what the next check sees.
    io::encode_png_pub(&png, w, h, &data).unwrap();
    png
}

#[test]
fn a_story_mask_against_an_older_baseline_counts_only_where_its_image_shows_it() {
    // Mask audit 1, the rest of it: a baseline without `masks` left every story mask out, so a
    // new one against it was never a change. It is left out only where the baseline image shows
    // it painted (0.7.6 painted story masks the same way); anywhere else it is "added".
    let d = scratch("masks-older");
    let png = old_baseline(&d, &[[4, 4, 12, 10]]);
    write_masks(&png, &[(".live", "story", &[[4, 4, 12, 10]])]);
    let r = row(&d, None);
    assert!(
        r.get("masksChanged").is_none(),
        "painted in the baseline: {r}"
    );
    assert_eq!(r["pass"], json!(true), "{r}");
    // Grown past what the baseline shows, or a second story mask: added.
    write_masks(&png, &[(".live", "story", &[[4, 4, 12, 14]])]);
    assert_eq!(row(&d, None)["masksChanged"]["added"], json!([".live"]));
    write_masks(
        &png,
        &[
            (".live", "story", &[[4, 4, 12, 10]]),
            (".new", "story", &[[20, 20, 28, 28]]),
        ],
    );
    assert_eq!(row(&d, None)["masksChanged"]["added"], json!([".new"]));
    // Attribute and config masks are newer than such a baseline: always added.
    write_masks(&png, &[(".live", "attribute", &[[4, 4, 12, 10]])]);
    assert_eq!(row(&d, None)["masksChanged"]["added"], json!([".live"]));
    let _ = fs::remove_dir_all(&d);
}

/// A 200-wide render: content in rows `0..content`, then a mask painted across its full width in
/// rows `content..h`, recorded beside it.
fn footer(png: &Path, content: usize, h: usize) {
    let w = 200;
    let mut d = vec![20u8; w * h * 4];
    for y in 0..content {
        for x in 0..w {
            d[(y * w + x) * 4] = 200;
        }
    }
    for y in content..h {
        for x in 0..w {
            d[(y * w + x) * 4..][..3].copy_from_slice(&[255, 0, 255]);
        }
    }
    io::encode_png_pub(png, w, h, &d).unwrap();
    let px = (w * (h - content)) as u32;
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": [{ "selector": ".foot", "source": "story", "count": 1, "px": px,
            "rects": [[0, content, w, h]] }] })
        .to_string(),
    )
    .unwrap();
}

#[test]
fn growth_under_a_mask_in_the_bottom_right_corner_fails() {
    // Mask audit 3: trim took the footer mask for the background and cropped it, so the component
    // growing under it (100 to 140 px tall) trimmed both renders to the same size and passed.
    let d = scratch("masks-trim");
    let png = d.join("png/a.png");
    let trim_all = || {
        let o = TrimOpts {
            dir: d.join("png"),
            only: None,
            pad: 16,
            tolerance: 8,
        };
        trim(&o).unwrap();
        io::png_size(&png).unwrap()
    };
    footer(&png, 80, 100);
    assert_eq!(trim_all().2, 100, "the mask is kept");
    fs::write(
        d.join("m.json"),
        json!({ "stories": [{ "id": "a", "sig": "s/a.psig" }] }).to_string(),
    )
    .unwrap();
    assert_eq!(
        baseline(&baseline_opts(&d)).unwrap()["summary"]["failed"],
        json!(0)
    );
    footer(&png, 120, 140);
    assert_eq!(trim_all().2, 140);
    // The trimmed sizes differ, and the mask moved down with the content: a change to review.
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false), "{r}");
    assert_eq!(r["masksChanged"]["moved"], json!([".foot"]), "{r}");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_mask_the_capture_may_not_apply_fails_and_no_baseline_is_written() {
    // Decision 3 and mask audit 15: the capture reports a `data-volatile` container, one with no
    // reason, and an element matched but not measured; the engine fails the entry with each, and
    // writes no baseline from it.
    let d = scratch("masks-problems");
    let png = store(&d, None);
    let problems = json!([
        { "kind": "container", "element": "div.card [data-volatile=\"x\"]: element children div" },
        { "kind": "reason", "element": "span.id [data-volatile]" },
        { "kind": "unmeasured", "element": ".late: 3 matched, 2 measured" },
    ]);
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": [], "problems": problems }).to_string(),
    )
    .unwrap();
    let r = row(&d, None);
    assert_eq!(r["pass"], json!(false), "{r}");
    assert_eq!(r["masksBlocked"]["problems"], problems);
    assert_eq!(
        r["reasons"],
        json!([
            "mask on a container: div.card [data-volatile=\"x\"]: element children div",
            "mask needs a reason: span.id [data-volatile]",
            "mask not measured: .late: 3 matched, 2 measured",
        ])
    );
    let o = BaselineOpts {
        allow_masks: Some(None),
        ..baseline_opts(&d)
    };
    let res = baseline(&o).unwrap();
    assert_eq!(res["summary"]["failed"], json!(1), "{res}");
    assert!(res["errors"][0]
        .as_str()
        .unwrap()
        .contains("mask on a container"));
    // A problem that does not read is an error, never ignored.
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": [], "problems": [{ "kind": "other", "element": "x" }] })
            .to_string(),
    )
    .unwrap();
    assert!(row(&d, None)["error"]
        .as_str()
        .unwrap()
        .contains("each problem needs a known kind"));
    let _ = fs::remove_dir_all(&d);
}
