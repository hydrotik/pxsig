//! Fixture repositories built with git in a temp folder, for the git and resolver tests.

use super::*;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

static N: AtomicUsize = AtomicUsize::new(0);

pub(super) fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "pxsig-affected-{}-{}-{name}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

pub(super) fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

pub(super) fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

pub(super) fn init(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "test"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

pub(super) fn commit(dir: &Path, msg: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", msg]);
}

/// A workspace: a story importing a component, a test, a data file, a store with records.
pub(super) fn workspace(ws: &Path) {
    write(ws, "src/Button/Button.tsx", "export const B = 1;\n");
    write(
        ws,
        "src/Button/Button.stories.tsx",
        "import { B } from './Button';\n",
    );
    write(
        ws,
        "src/Button/Button.test.tsx",
        "import { B } from './Button';\n",
    );
    write(ws, "src/Ünïcode/Card.stories.tsx", "export {};\n");
    write(ws, "src/data.json", "{}\n");
    write(ws, ".pxsig/baselines/Button/b.psig", "x");
    write(ws, ".pxsig/a11y.json", "{\"b\":[]}\n");
    write(ws, ".pxsig/approvals.ndjson", "{\"id\":\"b\"}\n");
    write(
        ws,
        ".pxsig/manifest.json",
        "{\"stories\":[{\"id\":\"b\",\"sig\":\".pxsig/baselines/Button/b.psig\"}]}\n",
    );
    write(
        ws,
        ".pxsig/manifest.matrix.json",
        "{\"stories\":[{\"id\":\"b@m\",\"sig\":\".pxsig/baselines/Button/b@m.psig\"}]}\n",
    );
    write(ws, ".pxsig/.gitignore", "renders/\n");
    write(ws, "README.md", "hi\n");
}

pub(super) fn manifest(ignore: &[&str]) -> Manifest {
    serde_json::from_value(json!({
        "srcRoot": "src",
        "affectsAll": ["pxsig.config.json", ".storybook"],
        "affectsIgnore": ignore,
        "store": {
            "dir": ".pxsig", "a11y": ".pxsig/a11y.json", "approvals": ".pxsig/approvals.ndjson",
            "a11yDecisions": ".pxsig/a11y-decisions.ndjson",
            "manifests": { "": ".pxsig/manifest.json", "matrix": ".pxsig/manifest.matrix.json" }
        },
        "stories": [
            { "id": "b", "sig": ".pxsig/baselines/Button/b.psig", "importPath": "src/Button/Button.stories.tsx" },
            { "id": "c", "sig": ".pxsig/baselines/U/c.psig", "importPath": "src/Ünïcode/Card.stories.tsx" }
        ]
    }))
    .unwrap()
}

pub(super) fn class_of(v: &Value, path: &str) -> String {
    v["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == path)
        .map(|f| f["class"].as_str().unwrap().to_string())
        .unwrap_or_else(|| panic!("{path} not in {v}"))
}

pub(super) fn ids(v: &Value, key: &str) -> Vec<String> {
    let mut a: Vec<String> = v[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_string())
        .collect();
    a.sort();
    a
}
