//! The command line as `main` parses it, run through `run`: each subcommand's arguments reach
//! its command, a command's exit code comes back unchanged, and an error is exit code 2.

use super::*;
use clap::CommandFactory;
use std::fs;
use std::path::Path;

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-main-{}-{name}", std::process::id()));
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

fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
    Cli::try_parse_from(std::iter::once("pxsig").chain(args.iter().copied()))
}

/// Parse `args` (which must parse) and run the command.
fn run_args(args: &[&str]) -> anyhow::Result<u8> {
    run(parse(args).unwrap_or_else(|e| panic!("{args:?}: {e}")).cmd)
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn the_command_definition_is_consistent() {
    Cli::command().debug_assert();
}

#[test]
fn version_and_help_are_answers_not_commands() {
    let v = parse(&["--version"]).err().unwrap();
    assert_eq!(v.kind(), clap::error::ErrorKind::DisplayVersion);
    assert!(v.to_string().contains(env!("CARGO_PKG_VERSION")), "{v}");
    let h = parse(&["--help"]).err().unwrap();
    assert_eq!(h.kind(), clap::error::ErrorKind::DisplayHelp);
    assert!(h.to_string().contains("detail-sweep"), "{h}");
}

#[test]
fn bad_command_lines_are_refused_before_anything_runs() {
    for args in [
        &[][..],
        &["nope"],
        &["capture"],
        &["compare", "a.png"],
        &["check", "--png-dir", "p"],
        &["capture", "a.png", "--grid", "lots"],
        &["diff", "a.png", "b.png", "--tolerance", "300"],
        &["-j", "many", "serve"],
    ] {
        assert!(parse(args).is_err(), "{args:?} parsed");
    }
}

#[test]
fn global_and_default_options_reach_the_command() {
    let cli = parse(&["-j", "3", "affected", "--manifest", "m.json"]).unwrap();
    assert_eq!(cli.threads, Some(3));
    match cli.cmd {
        Cmd::Affected { since, files, .. } => {
            assert_eq!(since, "main");
            assert_eq!(files, None);
        }
        _ => panic!("not affected"),
    }
    match parse(&["check", "--manifest", "m", "--png-dir", "p"])
        .unwrap()
        .cmd
    {
        Cmd::Check {
            artifacts,
            tolerance,
            no_artifacts,
            ..
        } => {
            assert_eq!(artifacts, "failed");
            assert_eq!(tolerance, 16);
            assert!(!no_artifacts);
        }
        _ => panic!("not check"),
    }
}

#[test]
fn every_command_reports_a_missing_input_as_an_error() {
    let d = scratch("missing");
    let gone = s(&d.join("gone"));
    let g = gone.as_str();
    for args in [
        &["capture", g, "--grid", "16"][..],
        &["compare", g, g],
        &["check", "--manifest", g, "--png-dir", g],
        &["check", "--manifest", g, "--png-dir", g, "--no-artifacts"],
        &["baseline", "--manifest", g, "--png-dir", g],
        &["diff", g, g],
        &["affected", "--manifest", g, "--files", "a.ts"],
        &["report", "--input", g],
        &["cat", g],
        &["pack"],
        &["attach", g, g],
        &["detail-sweep", "--input", g],
    ] {
        assert!(run_args(args).is_err(), "{args:?} succeeded");
    }
    // An unknown artifacts mode fails before the manifest is read.
    let e = run_args(&[
        "check",
        "--manifest",
        g,
        "--png-dir",
        g,
        "--artifacts",
        "some",
    ])
    .unwrap_err();
    assert!(format!("{e:#}").contains("--artifacts must be"), "{e:#}");
}

#[test]
fn exit_codes_pass_through_and_an_error_is_2() {
    assert_eq!(exit_code(Ok(0)), ExitCode::from(0));
    assert_eq!(exit_code(Ok(1)), ExitCode::from(1));
    assert_eq!(exit_code(Err(anyhow::anyhow!("boom"))), ExitCode::from(2));
}

#[test]
fn a_render_goes_through_capture_cat_compare_diff_trim_and_report() {
    let d = scratch("flow");
    let (a, b) = (d.join("png/a.png"), d.join("png/b.png"));
    png(&a, 10);
    png(&b, 220);
    let sig = d.join("a.psig");
    assert_eq!(
        run_args(&["capture", &s(&a), "--out", &s(&sig), "--grid", "16"]).unwrap(),
        0
    );
    assert!(sig.is_file());
    assert_eq!(run_args(&["cat", &s(&sig)]).unwrap(), 0);
    assert_eq!(
        run_args(&["compare", &s(&a), &s(&sig), "--json"]).unwrap(),
        0
    );
    let out = d.join("out");
    assert_eq!(
        run_args(&["compare", &s(&b), &s(&sig), "--out-dir", &s(&out)]).unwrap(),
        1
    );
    let mask = d.join("mask.png");
    assert_eq!(
        run_args(&["diff", &s(&a), &s(&b), "--mask", &s(&mask), "--json"]).unwrap(),
        1
    );
    assert_eq!(run_args(&["diff", &s(&a), &s(&a)]).unwrap(), 0);
    assert!(mask.is_file());
    assert_eq!(
        run_args(&["trim", &s(&d.join("png")), "--only", "a", "--json"]).unwrap(),
        0
    );

    let input = d.join("result.json");
    fs::write(&input, r#"{"results":[]}"#).unwrap();
    let md = d.join("r.md");
    assert_eq!(
        run_args(&["report", "--input", &s(&input), "--out", &s(&md)]).unwrap(),
        0
    );
    assert!(md.is_file());
    let e = run_args(&["report", "--input", &s(&input), "--format", "pdf"]).unwrap_err();
    assert!(format!("{e}").contains("unknown report format"), "{e}");
}

#[test]
fn baseline_then_check_through_the_command_line() {
    let d = scratch("batch");
    png(&d.join("png/a.png"), 10);
    fs::write(
        d.join("m.json"),
        r#"{"stories":[{"id":"a","sig":"s/a.psig"}]}"#,
    )
    .unwrap();
    let (m, p, r) = (s(&d.join("m.json")), s(&d.join("png")), s(&d));
    let batch = ["--manifest", &m, "--png-dir", &p, "--root", &r];
    let mut args = vec!["baseline", "--json"];
    args.extend(batch);
    assert_eq!(run_args(&args).unwrap(), 0);
    assert!(d.join("s/a.psig").is_file());
    let mut args = vec!["check", "--format", "json", "--artifacts", "none"];
    args.extend(batch);
    assert_eq!(run_args(&args).unwrap(), 0);
}

#[test]
fn detail_sweep_reads_its_input_file() {
    let d = scratch("sweep");
    let (a, b) = (d.join("png/a.png"), d.join("png/b.png"));
    png(&a, 10);
    png(&b, 200);
    let input = d.join("sweep.json");
    fs::write(
        &input,
        serde_json::json!({
            "pairs": [{ "key": "k", "base": a, "cur": b }],
            "builds": [{ "tile": 16, "block": 4, "selEnergy": 0 }],
        })
        .to_string(),
    )
    .unwrap();
    assert_eq!(
        run_args(&["detail-sweep", "--input", &s(&input)]).unwrap(),
        0
    );
    fs::write(&input, "{}").unwrap();
    let e = run_args(&["detail-sweep", "--input", &s(&input)]).unwrap_err();
    assert!(format!("{e:#}").contains("sweep input"), "{e:#}");
}

#[test]
fn react_plan_then_diff_from_the_command_line() {
    let d = scratch("react");
    fs::create_dir_all(d.join("src")).unwrap();
    fs::write(d.join("src/A.tsx"), "export function A() {}\n").unwrap();
    fs::write(d.join("src/A.stories.tsx"), "import { A } from './A';\n").unwrap();
    fs::write(
        d.join("m.json"),
        r#"{"srcRoot":"src","stories":[{"id":"a","sig":"a.psig","importPath":"src/A.stories.tsx"}]}"#,
    )
    .unwrap();
    fs::write(d.join("opts.json"), r#"{"key":{"backend":"babel"}}"#).unwrap();
    fs::write(d.join("results.json"), r#"{"results":{}}"#).unwrap();
    let (m, root, cache) = (s(&d.join("m.json")), s(&d), s(&d.join("cache")));
    let (opts, plan) = (
        format!("@{}", s(&d.join("opts.json"))),
        s(&d.join("plan.json")),
    );
    let plan_args = [
        "react-plan",
        "--manifest",
        &m,
        "--root",
        &root,
        "--all",
        "--cache",
        &cache,
        "--options",
        &opts,
        "--out",
        &plan,
    ];
    assert_eq!(run_args(&plan_args).unwrap(), 0);
    let out = s(&d.join("react.json"));
    let diff_args = [
        "react-diff",
        "--plan",
        &plan,
        "--results",
        &s(&d.join("results.json")),
        "--cache",
        &cache,
        "--out",
        &out,
    ];
    assert_eq!(run_args(&diff_args).unwrap(), 0);
    let r: serde_json::Value = serde_json::from_str(&fs::read_to_string(&out).unwrap()).unwrap();
    assert_eq!(r["files"][0]["path"], "src/A.tsx");
    // Nothing compiled it: reported as missing, never an exit code.
    assert_eq!(r["files"][0]["head"], "missing");
    // One selection at most; the cache and options are required.
    for args in [
        &[
            "react-plan",
            "--manifest",
            "m",
            "--cache",
            "c",
            "--options",
            "{}",
            "--all",
            "--since",
            "main",
        ][..],
        &[
            "react-plan",
            "--manifest",
            "m",
            "--cache",
            "c",
            "--options",
            "{}",
            "--all",
            "--files",
            "a",
        ],
        &["react-plan", "--manifest", "m", "--options", "{}"],
        &["react-plan", "--manifest", "m", "--cache", "c"],
        &[
            "react-diff",
            "--plan",
            "p",
            "--results",
            "r",
            "--cache",
            "c",
        ],
    ] {
        assert!(parse(args).is_err(), "{args:?}");
    }
    // Options that are not JSON: an error, exit 2.
    assert!(run_args(&[
        "react-plan",
        "--manifest",
        &m,
        "--all",
        "--cache",
        &cache,
        "--options",
        "{nope"
    ])
    .is_err());
}
