//! The render commands as the CLI runs them: what each returns as its exit code (0 pass, 1 a
//! change or a failed entry, 2 a baseline that could not be written) and the files it writes.

use super::*;
use std::fs;

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-cmd-{}-{name}", std::process::id()));
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

fn batch_args(d: &Path, only: Option<&str>) -> BatchArgs {
    BatchArgs {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: Some(d.to_path_buf()),
        only: only.map(String::from),
    }
}

/// Two entries with renders; `missing` adds one listed with no render.
fn store(d: &Path, missing: bool) {
    png(&d.join("png/a.png"), 10);
    png(&d.join("png/b.png"), 20);
    let mut stories = vec![
        json!({ "id": "a", "sig": "s/a.psig" }),
        json!({ "id": "b", "sig": "s/b.psig" }),
    ];
    if missing {
        stories.push(json!({ "id": "c", "sig": "s/c.psig" }));
    }
    fs::write(d.join("m.json"), json!({ "stories": stories }).to_string()).unwrap();
}

#[test]
fn capture_writes_next_to_the_png_and_compare_exits_by_the_gate() {
    let d = scratch("compare");
    png(&d.join("png/a.png"), 10);
    png(&d.join("png/b.png"), 220);
    assert_eq!(
        cmd_capture(&d.join("png/a.png"), None, 16, true).unwrap(),
        0
    );
    let sig = io::default_sig_path(&d.join("png/a.png"));
    assert!(sig.is_file(), "{}", sig.display());

    let gate = GateArgs::default();
    let out = d.join("out");
    assert_eq!(
        cmd_compare(&d.join("png/a.png"), &sig, Some(out.clone()), true, &gate).unwrap(),
        0
    );
    assert_eq!(
        cmd_compare(&d.join("png/b.png"), &sig, Some(out.clone()), false, &gate).unwrap(),
        1
    );
    let stem = io::stem_of(&sig);
    assert!(out.join(format!("{stem}.diff.png")).is_file());
    assert!(out.join(format!("{stem}.diff.html")).is_file());

    let e = cmd_compare(&d.join("png/none.png"), &sig, None, false, &gate).unwrap_err();
    assert!(e.to_string().starts_with("PNG not found"), "{e}");
}

#[test]
fn baseline_exits_2_when_an_entry_has_no_render_and_check_exits_1_on_a_failed_entry() {
    let d = scratch("batch");
    store(&d, false);
    assert_eq!(
        cmd_baseline(batch_args(&d, None), false, None, false).unwrap(),
        0
    );
    assert_eq!(
        cmd_baseline(batch_args(&d, Some("a")), true, None, true).unwrap(),
        0
    );

    let gate = GateArgs::default();
    for format in ["text", "json", "junit", "markdown"] {
        let code = cmd_check(
            batch_args(&d, None),
            Some(d.join("diff")),
            format,
            batch::Artifacts::None,
            None,
            None,
            None,
            None,
            None,
            16,
            None,
            &gate,
        )
        .unwrap();
        assert_eq!(code, 0, "{format}");
    }

    // A render that changed: the check fails, in every format.
    png(&d.join("png/b.png"), 220);
    let code = cmd_check(
        batch_args(&d, None),
        Some(d.join("diff")),
        "text",
        batch::Artifacts::All,
        None,
        None,
        None,
        None,
        None,
        16,
        None,
        &gate,
    )
    .unwrap();
    assert_eq!(code, 1);
    assert!(d.join("diff/index.html").is_file(), "the gallery");

    let e = d.join("e");
    fs::create_dir_all(e.join("png")).unwrap();
    store(&e, true);
    assert_eq!(
        cmd_baseline(batch_args(&e, None), false, None, false).unwrap(),
        2
    );
}

#[test]
fn diff_exits_1_on_a_change_and_writes_the_mask() {
    let d = scratch("diff");
    png(&d.join("png/a.png"), 10);
    png(&d.join("png/b.png"), 220);
    let a = d.join("png/a.png");
    assert_eq!(cmd_diff(&a, &a, 16, None, false).unwrap(), 0);
    let mask = d.join("mask.png");
    assert_eq!(
        cmd_diff(&a, &d.join("png/b.png"), 16, Some(mask.clone()), true).unwrap(),
        1
    );
    assert!(mask.is_file());
}

#[test]
fn report_writes_markdown_or_junit_and_refuses_another_format() {
    let d = scratch("report");
    store(&d, false);
    cmd_baseline(batch_args(&d, None), false, None, false).unwrap();
    let res = batch::check(&CheckOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.clone(),
        out_dir: None,
        artifacts: batch::Artifacts::None,
        only: None,
        cache: None,
        history: None,
        enforcement: None,
        history_extra: None,
        base_png_dir: None,
        tolerance: 16,
        cli_gate: gate::GateSpec::default(),
        env_gate: gate::GateSpec::default(),
        env: None,
    })
    .unwrap();
    fs::write(d.join("res.json"), res.to_string()).unwrap();
    assert_eq!(
        cmd_report(&d.join("res.json"), "md", None, Some(d.join("s.md"))).unwrap(),
        0
    );
    assert!(fs::read_to_string(d.join("s.md")).unwrap().contains('|'));
    assert_eq!(
        cmd_report(&d.join("res.json"), "junit", None, Some(d.join("j.xml"))).unwrap(),
        0
    );
    assert!(fs::read_to_string(d.join("j.xml"))
        .unwrap()
        .contains("<testsuite"));
    let e = cmd_report(&d.join("res.json"), "html", None, None).unwrap_err();
    assert!(e.to_string().contains("markdown | junit"), "{e}");
    assert!(cmd_report(&d.join("none.json"), "md", None, None).is_err());
}

#[test]
fn trim_and_affected_exit_0() {
    let d = scratch("trim");
    png(&d.join("png/a.png"), 10);
    assert_eq!(cmd_trim(&d.join("png"), None, 16, 8, false).unwrap(), 0);
    assert_eq!(cmd_trim(&d.join("png"), Some("a"), 16, 8, true).unwrap(), 0);

    fs::write(
        d.join("m.json"),
        json!({ "stories": [{ "id": "a", "sig": "s/a.psig", "importPath": "./src/A.stories.tsx" }] })
            .to_string(),
    )
    .unwrap();
    for as_json in [false, true] {
        let code = cmd_affected(
            &d.join("m.json"),
            Some(d.clone()),
            "main",
            Some("notes.txt".into()),
            as_json,
        )
        .unwrap();
        assert_eq!(code, 0);
    }
}
