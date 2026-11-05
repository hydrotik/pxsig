//! `react-plan` / `react-diff` through `dispatch`: the same answers as the commands.

use super::*;
use std::fs;

#[test]
fn react_methods_answer_what_the_commands_compute() {
    let d = std::env::temp_dir().join(format!("pxsig-serve-react-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join("src")).unwrap();
    fs::write(
        d.join("src/A.tsx"),
        "export function A() { return null; }\n",
    )
    .unwrap();
    fs::write(d.join("src/A.stories.tsx"), "import { A } from './A';\n").unwrap();
    let m = json!({ "srcRoot": "src", "stories": [{ "id": "a--one", "sig": "a.psig", "importPath": "src/A.stories.tsx" }] });
    fs::write(d.join("m.json"), m.to_string()).unwrap();
    let p = |rel: &str| d.join(rel).to_string_lossy().into_owned();
    let options = json!({ "key": { "backend": "babel", "compiler": "1.0.0" } });
    let o = crate::react::PlanOpts {
        manifest: d.join("m.json"),
        root: d.clone(),
        select: crate::react::Select::All,
        cache: d.join("cache"),
        options: options.clone(),
    };
    let direct = crate::react::plan::plan(&o).unwrap();
    let params = json!({ "manifest": p("m.json"), "root": p(""), "all": true, "cache": p("cache"), "options": options });
    assert_eq!(dispatch("react-plan", &params).unwrap(), direct);
    assert_eq!(direct["files"][0]["path"], "src/A.tsx");

    // With `out`: the plan goes to the file; the answer is its counts.
    let mut with_out = params.clone();
    with_out["out"] = json!(p("run/plan.json"));
    let a = dispatch("react-plan", &with_out).unwrap();
    assert_eq!(
        (a["files"].as_u64(), a["misses"].as_u64()),
        (Some(1), Some(1))
    );
    let written: Value =
        serde_json::from_str(&fs::read_to_string(d.join("run/plan.json")).unwrap()).unwrap();
    assert_eq!(written, direct);

    let sha = direct["files"][0]["head"]["sha"].as_str().unwrap();
    let results = json!({ "results": { sha: { "functions": [{ "name": "A", "line": 1, "outcome": "compiled", "diagnostics": [] }] } } });
    fs::write(d.join("run/results.json"), results.to_string()).unwrap();
    let a = dispatch(
        "react-diff",
        &json!({ "plan": p("run/plan.json"), "results": p("run/results.json"), "cache": p("cache"), "out": p("reports/react.json") }),
    )
    .unwrap();
    assert_eq!(a["summary"]["compiled"], 1);
    assert_eq!(a["alerts"], json!([]));
    let report: Value =
        serde_json::from_str(&fs::read_to_string(d.join("reports/react.json")).unwrap()).unwrap();
    assert_eq!(report["summary"], a["summary"]);
    assert_eq!(report["functions"][0]["id"], "src/A.tsx#A");
    // The result is now cached: the next plan finds it.
    assert_eq!(
        dispatch("react-plan", &params).unwrap()["files"][0]["head"]["hit"],
        true
    );

    assert_eq!(
        dispatch("react-plan", &json!({ "cache": "c" }))
            .unwrap_err()
            .to_string(),
        "missing string param `manifest`"
    );
    let both = json!({ "manifest": p("m.json"), "all": true, "since": "main", "cache": p("cache"), "options": options });
    assert!(dispatch("react-plan", &both)
        .unwrap_err()
        .to_string()
        .contains("one of since, files, all"));
    assert_eq!(
        dispatch("react-diff", &json!({})).unwrap_err().to_string(),
        "missing string param `plan`"
    );
}
