use super::baseline::EnvPlan;
use super::check::flag_identical_renders;
use super::*;
use crate::io;
use serde_json::json;
use std::path::PathBuf;

pub(super) fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-batch-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join("png")).unwrap();
    d
}

pub(super) fn write_png(path: &Path, shade: u8) {
    let px: Vec<u8> = (0..32 * 32)
        .flat_map(|i| [shade, (i % 251) as u8, 40, 255])
        .collect();
    io::encode_png_pub(path, 32, 32, &px).unwrap();
}

#[test]
fn baseline_env_plan_writes_env_and_check_returns_its_id() {
    let d = scratch("env");
    write_png(&d.join("png/a.png"), 10);
    write_png(&d.join("png/b.png"), 20);
    let manifest = json!({ "stories": [
        { "id": "a", "sig": "store/a.psig" },
        { "id": "b", "sig": "store/b.psig" },
    ] });
    fs::write(d.join("m.json"), manifest.to_string()).unwrap();
    let env = json!({ "v": 1, "id": "aaaabbbbccccdddd", "browser": { "name": "chromium" } });
    let plan: EnvPlan = serde_json::from_value(
        json!({ "envs": { "aaaabbbbccccdddd": env }, "byId": { "a": "aaaabbbbccccdddd" } }),
    )
    .unwrap();
    let o = BaselineOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.clone(),
        only: None,
        no_detail: true,
        env: Some(plan),
    };
    assert_eq!(baseline(&o).unwrap()["summary"]["failed"], json!(0));
    let ha = pxsig_core::psig::header(&fs::read(d.join("store/a.psig")).unwrap()).unwrap();
    assert_eq!(ha["env"]["browser"]["name"], json!("chromium"));
    let hb = pxsig_core::psig::header(&fs::read(d.join("store/b.psig")).unwrap()).unwrap();
    assert!(
        hb.get("env").is_none(),
        "an entry the plan does not name gets no env"
    );

    let res = check(&CheckOpts {
        manifest: d.join("m.json"),
        png_dir: d.join("png"),
        root: d.clone(),
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
    })
    .unwrap();
    let row = |id: &str| {
        res["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == json!(id))
            .unwrap()
            .clone()
    };
    assert_eq!(row("a")["baselineEnv"], json!("aaaabbbbccccdddd"));
    assert_eq!(row("b")["baselineEnv"], Value::Null);
    assert_eq!(
        res["baselineEnvs"]["aaaabbbbccccdddd"]["browser"]["name"],
        json!("chromium")
    );
    let _ = fs::remove_dir_all(&d);
}

fn row(id: &str, pass: bool, render: &str) -> Value {
    json!({ "id": id, "pass": pass, "render": render, "error": null })
}

#[test]
fn identical_failing_renders_become_errors() {
    let mut rows: Vec<Value> = (0..6)
        .map(|i| row(&format!("a--{i}"), false, "same"))
        .collect();
    rows.push(row("b--x", false, "other"));
    rows.push(row("c--y", true, "same"));
    let groups = flag_identical_renders(&mut rows);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0]["count"], json!(6));
    assert!(rows[0]["error"]
        .as_str()
        .unwrap()
        .contains("5 other failing entries"));
    assert!(
        rows[6]["error"].is_null(),
        "a failure with its own render stays a change"
    );
    assert!(rows[7]["error"].is_null(), "a passing row is never flagged");
}

#[test]
fn a_few_identical_renders_are_not_the_environment() {
    let mut rows: Vec<Value> = (0..4)
        .map(|i| row(&format!("a--{i}"), false, "same"))
        .collect();
    assert!(flag_identical_renders(&mut rows).is_empty());
    assert!(rows.iter().all(|r| r["error"].is_null()));
}

#[test]
fn the_floor_scales_with_the_run() {
    // 100 rows: a group needs 10, so 6 identical failures are left as changes.
    let mut rows: Vec<Value> = (0..100)
        .map(|i| row(&format!("p--{i}"), true, &format!("r{i}")))
        .collect();
    for r in rows.iter_mut().take(6) {
        r["pass"] = json!(false);
        r["render"] = json!("same");
    }
    assert!(flag_identical_renders(&mut rows).is_empty());
    for r in rows.iter_mut().take(10) {
        r["pass"] = json!(false);
        r["render"] = json!("same");
    }
    assert_eq!(flag_identical_renders(&mut rows)[0]["count"], json!(10));
}
