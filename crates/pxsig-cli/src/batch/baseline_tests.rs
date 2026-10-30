//! `baseline`: the write (atomic, over an old baseline), the grid policy, and the renders it
//! cannot read (missing, corrupt), which are reported per entry and leave the baseline as it was.

use super::baseline::grid_for;
use super::tests::{scratch, write_png};
use super::*;
use crate::io;
use serde_json::json;
use std::path::PathBuf;

/// A `w`×`h` render with a gradient (so the signature depends on the pixels).
fn write_png_sized(path: &Path, w: usize, h: usize) {
    let px: Vec<u8> = (0..w * h)
        .flat_map(|i| [(i % 253) as u8, (i / w % 251) as u8, 90, 255])
        .collect();
    io::encode_png_pub(path, w, h, &px).unwrap();
}

fn opts(d: &Path) -> BaselineOpts {
    BaselineOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.to_path_buf(),
        only: None,
        no_detail: false,
        env: None,
    }
}

fn manifest(d: &Path, m: Value) {
    fs::write(d.join("m.json"), m.to_string()).unwrap();
}

/// The files in a folder, by name, sorted.
fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn a_baseline_replaces_the_old_one_and_leaves_no_temp_file() {
    let d = scratch("atomic");
    write_png(&d.join("png/a.png"), 10);
    manifest(
        &d,
        json!({ "stories": [{ "id": "a", "sig": "store/a.psig" }] }),
    );
    assert_eq!(baseline(&opts(&d)).unwrap()["summary"]["failed"], json!(0));
    let first = fs::read(d.join("store/a.psig")).unwrap();
    write_png(&d.join("png/a.png"), 200);
    assert_eq!(baseline(&opts(&d)).unwrap()["summary"]["failed"], json!(0));
    let second = fs::read(d.join("store/a.psig")).unwrap();
    assert_ne!(
        first, second,
        "the new render's baseline replaces the old one"
    );
    assert_eq!(names(&d.join("store")), ["a.psig"], "no temp file is left");
    let b = load_baseline(&d.join("store/a.psig")).unwrap();
    assert_eq!(
        b.image.as_deref(),
        Some(fs::read(d.join("png/a.png")).unwrap().as_slice()),
        "a .psig carries the render byte for byte"
    );
    assert!(
        b.detail.is_some(),
        "the detail channel is written by default"
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_pxsig_json_baseline_has_no_image_and_no_detail_when_turned_off() {
    let d = scratch("json");
    write_png(&d.join("png/a.png"), 10);
    manifest(
        &d,
        json!({ "detail": false, "stories": [{ "id": "a", "sig": "store/a.pxsig.json" }] }),
    );
    assert_eq!(baseline(&opts(&d)).unwrap()["summary"]["failed"], json!(0));
    let b = load_baseline(&d.join("store/a.pxsig.json")).unwrap();
    assert!(b.image.is_none());
    assert!(b.detail.is_none(), "the manifest's detail: false");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn the_grid_policy_sizes_cells_and_clamps_the_grid() {
    // No policy (or a zero cell): the maximum grid.
    assert_eq!(grid_for(800, 600, 64, None), 64);
    assert_eq!(grid_for(800, 600, 64, Some(0)), 64);
    // ceil(longest side / cell), within 16..=max.
    assert_eq!(grid_for(800, 600, 64, Some(25)), 32);
    assert_eq!(grid_for(100, 40, 64, Some(25)), 16, "never below 16");
    assert_eq!(
        grid_for(4000, 10, 64, Some(25)),
        64,
        "never above the maximum"
    );
    assert_eq!(
        grid_for(4000, 10, 8, Some(25)),
        8,
        "a maximum under 16 is the grid"
    );
}

#[test]
fn a_story_grid_wins_over_the_min_cell_policy_and_is_clamped() {
    let d = scratch("grid");
    for id in ["policy", "own", "tiny"] {
        write_png_sized(&d.join(format!("png/{id}.png")), 96, 48);
    }
    manifest(
        &d,
        json!({ "grid": 64, "minCellPx": 4, "stories": [
            { "id": "policy", "sig": "s/policy.psig" },
            { "id": "own", "sig": "s/own.psig", "grid": 48 },
            { "id": "tiny", "sig": "s/tiny.psig", "grid": 2 },
        ] }),
    );
    assert_eq!(baseline(&opts(&d)).unwrap()["errors"], json!([]));
    let grid = |id: &str| load_baseline(&d.join(format!("s/{id}.psig"))).unwrap().grid;
    assert_eq!(grid("policy"), 24, "ceil(96 / 4)");
    assert_eq!(grid("own"), 48, "an explicit grid ignores minCellPx");
    assert_eq!(grid("tiny"), 8, "a grid is at least 8");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_missing_or_corrupt_render_is_an_error_for_its_entry_only() {
    let d = scratch("bad-render");
    write_png(&d.join("png/ok.png"), 10);
    write_png(&d.join("png/corrupt.png"), 10);
    manifest(
        &d,
        json!({ "stories": [
            { "id": "ok", "sig": "s/ok.psig" },
            { "id": "missing", "sig": "s/missing.psig" },
            { "id": "corrupt", "sig": "s/corrupt.psig" },
        ] }),
    );
    // The first run writes `ok` and `corrupt` (its render is still a PNG); `missing` has none.
    assert_eq!(baseline(&opts(&d)).unwrap()["summary"]["failed"], json!(1));
    let old = fs::read(d.join("s/corrupt.psig")).unwrap();
    fs::write(d.join("png/corrupt.png"), b"not a png").unwrap();
    let res = baseline(&opts(&d)).unwrap();
    assert_eq!(res["summary"]["stories"], json!(3));
    assert_eq!(res["summary"]["failed"], json!(2));
    let mut errors: Vec<String> = res["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e.as_str().unwrap().to_string())
        .collect();
    errors.sort();
    assert!(errors[0].starts_with("corrupt: reading "), "{}", errors[0]);
    assert!(
        errors[1].starts_with("missing: PNG not found: "),
        "{}",
        errors[1]
    );
    assert_eq!(
        fs::read(d.join("s/corrupt.psig")).unwrap(),
        old,
        "a render that does not decode leaves the baseline as it was"
    );
    assert!(!d.join("s/missing.psig").exists());
    assert_eq!(names(&d.join("s")), ["corrupt.psig", "ok.psig"]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn only_writes_the_selected_entries() {
    let d = scratch("only");
    write_png(&d.join("png/a.png"), 10);
    write_png(&d.join("png/b.png"), 20);
    manifest(
        &d,
        json!({ "stories": [{ "id": "a", "sig": "s/a.psig" }, { "id": "b", "sig": "s/b.psig" }] }),
    );
    let o = BaselineOpts {
        only: Some(["b".to_string()].into_iter().collect()),
        ..opts(&d)
    };
    assert_eq!(baseline(&o).unwrap()["summary"]["stories"], json!(1));
    assert_eq!(names(&d.join("s")), ["b.psig"]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn a_manifest_that_does_not_load_writes_nothing() {
    let d = scratch("bad-manifest-baseline");
    write_png(&d.join("png/a.png"), 10);
    let err = |o: &BaselineOpts| format!("{:#}", baseline(o).err().unwrap());
    assert!(err(&opts(&d)).starts_with("manifest not found: "));
    fs::write(d.join("m.json"), "{ not json").unwrap();
    assert!(err(&opts(&d)).starts_with("manifest is not valid JSON"));
    manifest(&d, json!({ "stories": [] }));
    assert_eq!(err(&opts(&d)), "manifest has no stories");
    assert_eq!(names(&d), ["m.json", "png"]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn the_env_plan_and_enforcement_parse_inline_or_from_a_file() {
    let d = scratch("parse");
    let f: PathBuf = d.join("env.json");
    fs::write(
        &f,
        r#"{ "envs": { "e": { "id": "e" } }, "byId": { "a": "e" } }"#,
    )
    .unwrap();
    let plan = parse_env_plan(Some(&format!("@{}", f.display())))
        .unwrap()
        .unwrap();
    assert_eq!(plan.extra_for("a").unwrap()["env"]["id"], json!("e"));
    assert!(plan.extra_for("b").is_none());
    assert!(parse_env_plan(None).unwrap().is_none());
    let bad = parse_env_plan(Some("[1]")).err().unwrap();
    assert!(format!("{bad:#}").starts_with("--env is not an env plan"));
    assert!(format!(
        "{:#}",
        parse_env_plan(Some("@/no/such/file")).err().unwrap()
    )
    .starts_with("reading --env file /no/such/file"));
    let e = parse_enforcement(Some(r#"{ "gates": ["visual"] }"#))
        .unwrap()
        .unwrap();
    assert_eq!(e["gates"], json!(["visual"]));
    assert!(
        format!("{:#}", parse_enforcement(Some("nope")).err().unwrap())
            .starts_with("--enforcement is not JSON")
    );
    let _ = fs::remove_dir_all(&d);
}
