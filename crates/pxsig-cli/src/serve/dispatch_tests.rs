//! `pxsig serve`'s methods through `dispatch`, as the dashboard server and the addon call them:
//! capture → compare (a pass, a fail, artifacts on demand), diff, trim, baseline → check, and
//! affected; plus the errors a bad param gives.

use super::*;
use std::fs;
use std::path::Path;

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-serve-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join("png")).unwrap();
    d
}

/// A 32×32 render; `shade` far apart gives a failing compare.
fn png(path: &Path, shade: u8) {
    let px: Vec<u8> = (0..32 * 32)
        .flat_map(|i| [shade, (i % 251) as u8, 40, 255])
        .collect();
    io::encode_png_pub(path, 32, 32, &px).unwrap();
}

fn p(d: &Path, rel: &str) -> String {
    d.join(rel).to_string_lossy().into_owned()
}

#[test]
fn ping_names_the_engine() {
    let r = dispatch("ping", &json!({})).unwrap();
    assert_eq!(r["pong"], true);
    assert_eq!(r["version"], env!("CARGO_PKG_VERSION"));
    assert!(r["threads"].as_u64().unwrap() >= 1);
}

#[test]
fn capture_then_compare_passes_the_same_render_and_fails_a_changed_one() {
    let d = scratch("compare");
    png(&d.join("png/a.png"), 10);
    png(&d.join("png/b.png"), 220);
    let c = dispatch(
        "capture",
        &json!({ "png": p(&d, "png/a.png"), "out": p(&d, "a.psig"), "grid": 4, "env": { "os": "test" } }),
    )
    .unwrap();
    // The grid is clamped to 8..=256; the detail channel is on by default.
    assert_eq!(c["grid"], 8);
    assert_eq!(c["detail"], true);
    assert_eq!(c["sha256"].as_str().unwrap().len(), 64);

    let same = dispatch(
        "compare",
        &json!({ "png": p(&d, "png/a.png"), "sig": p(&d, "a.psig") }),
    )
    .unwrap();
    assert_eq!(same["pass"], true, "{same}");
    assert!(same["metrics"].is_object());
    // No outDir: no artifacts written.
    assert!(!d.join("out").exists());

    let changed = dispatch(
        "compare",
        &json!({ "png": p(&d, "png/b.png"), "sig": p(&d, "a.psig"), "outDir": p(&d, "out") }),
    )
    .unwrap();
    assert_eq!(changed["pass"], false, "{changed}");
    assert!(!changed["reasons"].as_array().unwrap().is_empty());
    // outDir: the diff images the dashboard asks for.
    let written: Vec<String> = fs::read_dir(d.join("out"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        written.iter().any(|f| f.ends_with(".diff.png")),
        "{written:?}"
    );
}

#[test]
fn a_gate_that_is_not_a_gate_is_an_error() {
    let d = scratch("gate");
    png(&d.join("png/a.png"), 10);
    dispatch(
        "capture",
        &json!({ "png": p(&d, "png/a.png"), "out": p(&d, "a.psig") }),
    )
    .unwrap();
    let e = dispatch(
        "compare",
        &json!({ "png": p(&d, "png/a.png"), "sig": p(&d, "a.psig"), "gate": { "threshold": "high" } }),
    )
    .unwrap_err();
    assert!(format!("{e:#}").contains("expected f64"), "{e:#}");
}

#[test]
fn diff_counts_changed_pixels_and_writes_the_mask() {
    let d = scratch("diff");
    png(&d.join("png/a.png"), 10);
    png(&d.join("png/b.png"), 220);
    let none = dispatch(
        "diff",
        &json!({ "a": p(&d, "png/a.png"), "b": p(&d, "png/a.png") }),
    )
    .unwrap();
    assert_eq!(none["changed"], 0);
    let all = dispatch(
        "diff",
        &json!({ "a": p(&d, "png/a.png"), "b": p(&d, "png/b.png"), "mask": p(&d, "mask.png") }),
    )
    .unwrap();
    assert_eq!(all["changed"], 32 * 32);
    assert_eq!(all["width"], 32);
    assert!(d.join("mask.png").is_file());
}

#[test]
fn baseline_then_check_through_the_engine() {
    let d = scratch("batch");
    png(&d.join("png/a.png"), 10);
    png(&d.join("png/b.png"), 20);
    fs::write(
        d.join("m.json"),
        json!({ "stories": [{ "id": "a", "sig": "s/a.psig" }, { "id": "b", "sig": "s/b.psig" }] })
            .to_string(),
    )
    .unwrap();
    let common = json!({ "manifest": p(&d, "m.json"), "pngDir": p(&d, "png"), "root": p(&d, "") });
    let b = dispatch("baseline", &common).unwrap();
    assert_eq!(b["summary"]["failed"], 0, "{b}");
    assert!(d.join("s/a.psig").is_file() && d.join("s/b.psig").is_file());

    let mut only_a = common.clone();
    only_a["only"] = json!(["a"]);
    only_a["artifacts"] = json!("none");
    let c = dispatch("check", &only_a).unwrap();
    assert_eq!(c["summary"]["failed"], 0, "{c}");
    assert_eq!(c["results"].as_array().unwrap().len(), 1, "only: one entry");

    let mut bad = common.clone();
    bad["artifacts"] = json!("some");
    let e = dispatch("check", &bad).unwrap_err();
    assert!(format!("{e:#}").contains("all | failed | none"), "{e:#}");
}

#[test]
fn trim_reports_what_it_read() {
    let d = scratch("trim");
    png(&d.join("png/a.png"), 10);
    let r = dispatch("trim", &json!({ "dir": p(&d, "png") })).unwrap();
    assert_eq!(r["files"], 1, "{r}");
}

#[test]
fn affected_takes_a_file_list_without_git() {
    let d = scratch("affected");
    fs::write(
        d.join("m.json"),
        json!({ "stories": [{ "id": "a", "sig": "s/a.psig", "importPath": "./src/A.stories.tsx" }] })
            .to_string(),
    )
    .unwrap();
    let r = dispatch(
        "affected",
        &json!({ "root": p(&d, ""), "manifest": p(&d, "m.json"), "files": ["notes.txt"] }),
    )
    .unwrap();
    assert!(r["ids"].is_array(), "{r}");
    assert!(r["reason"].is_string(), "{r}");
}

#[test]
fn capture_stores_the_text_record_it_is_given_and_none_without_one() {
    let d = scratch("boxes");
    png(&d.join("png/a.png"), 10);
    let rec = json!({ "v": 1, "runs": [{ "path": "0/#0", "s": "1 ", "st": 0, "boxes": [] }] });
    fs::write(d.join("png/a.boxes.json"), rec.to_string()).unwrap();
    let with = json!({ "png": p(&d, "png/a.png"), "out": p(&d, "a.psig"), "boxes": p(&d, "png/a.boxes.json") });
    dispatch("capture", &with).unwrap();
    let a = pxsig_core::psig::decode(&fs::read(d.join("a.psig")).unwrap()).unwrap();
    assert_eq!(a.sections.len(), 1);
    assert_eq!(a.sections[0].meta["runs"], json!(1));
    // Without `boxes`, the file beside the render is not read: the caller decides.
    dispatch(
        "capture",
        &json!({ "png": p(&d, "png/a.png"), "out": p(&d, "b.psig") }),
    )
    .unwrap();
    let b = pxsig_core::psig::decode(&fs::read(d.join("b.psig")).unwrap()).unwrap();
    assert!(b.sections.is_empty());
    let _ = fs::remove_dir_all(&d);
}

/// A masks record beside `png` (`masks.rs`): `(selector, source, px)` each.
fn masks(png: &Path, list: &[(&str, &str, u32)]) {
    let m: Vec<Value> = list
        .iter()
        .map(|(s, src, px)| json!({ "selector": s, "source": src, "count": 1, "px": px }))
        .collect();
    fs::write(
        png.with_extension("masks.json"),
        json!({ "v": 1, "masks": m }).to_string(),
    )
    .unwrap();
}

#[test]
fn compare_weighs_the_masks_as_check_does() {
    let d = scratch("compare-masks");
    let a = d.join("png/a.png");
    png(&a, 10);
    masks(&a, &[(".clock", "project", 64)]);
    dispatch(
        "capture",
        &json!({ "png": p(&d, "png/a.png"), "out": p(&d, "a.psig") }),
    )
    .unwrap();
    let cmp = || {
        dispatch(
            "compare",
            &json!({ "png": p(&d, "png/a.png"), "sig": p(&d, "a.psig") }),
        )
        .unwrap()
    };
    // The same pixels and masks: a pass, with the render's masks.
    let same = cmp();
    assert_eq!(same["pass"], true, "{same}");
    assert_eq!(same["masks"][0]["area"], json!(0.0625));
    assert!(same["masksChanged"].is_null());

    // The same pixels, one mask grown and one added: "masks changed", as `check` says it.
    masks(
        &a,
        &[
            (".clock", "project", 512),
            ("[data-volatile]", "attribute", 4),
        ],
    );
    let r = cmp();
    assert_eq!(r["pass"], false, "{r}");
    assert_eq!(r["metrics"]["identical"], true, "the pixels are the same");
    assert_eq!(
        r["masksChanged"],
        json!({ "added": ["[data-volatile]"], "removed": [], "grew": [".clock"] })
    );
    assert_eq!(r["reasons"], json!(["masks changed: 1 added, 1 grew"]));
    assert_eq!(
        r["masksBaseline"],
        json!([{ "selector": ".clock", "source": "project", "area": 0.0625 }])
    );
    // A mask over a quarter of the capture: listed, never a verdict of its own.
    assert_eq!(
        r["masksLarge"],
        json!([{ "selector": ".clock", "source": "project", "area": 0.5 }])
    );
    let _ = fs::remove_dir_all(&d);
}
