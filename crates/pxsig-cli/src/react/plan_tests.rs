//! `react-plan` over fixture repositories: which files, each side, the cache, the notes.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{json, Value};

use super::cache;
use super::plan::{plan, PlanOpts, Select, MAX_FILES};

static N: AtomicUsize = AtomicUsize::new(0);

pub(super) fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "pxsig-react-{}-{}-{name}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn git(dir: &Path, args: &[&str]) {
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

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

fn commit(dir: &Path, msg: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", msg]);
}

/// A repository on `main`: a story importing a component (which imports its styles and a hook),
/// a test, an orphan module, a data file, a Storybook config module, a file to delete and one to
/// rename. Then a branch `work` changes all of them.
fn repo() -> PathBuf {
    let d = tmp("repo");
    git(&d, &["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.email", "test@example.com"),
        ("user.name", "test"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
    ] {
        git(&d, &["config", k, v]);
    }
    write(&d, "src/Button/Button.tsx", "import './Button.css';\nimport { useX } from '../useX';\nexport function Button() { return null; }\n");
    write(&d, "src/Button/Button.css.ts", "export const c = 1;\n");
    write(&d, "src/useX.ts", "export function useX() {}\n");
    write(&d, "src/Was.tsx", "export const W = 1;\n");
    write(&d, "src/Gone.tsx", "export const G = 1;\n");
    write(
        &d,
        "src/Button/Button.stories.tsx",
        "import { Button } from './Button';\nimport { W } from '../Was';\nimport { G } from '../Gone';\n",
    );
    write(
        &d,
        "src/Button/Button.test.tsx",
        "import { Button } from './Button';\n",
    );
    write(&d, "src/orphan.ts", "export const o = 1;\n");
    write(&d, "src/data.json", "{}\n");
    write(&d, ".storybook/preview.tsx", "export default {};\n");
    commit(&d, "base");
    git(&d, &["checkout", "-q", "-b", "work"]);
    write(&d, "src/Button/Button.tsx", "import './Button.css';\nimport { useX } from '../useX';\nimport { N } from '../New';\nexport function Button() { return 1; }\n");
    write(&d, "src/Button/Button.css.ts", "export const c = 2;\n");
    write(&d, "src/useX.ts", "export function useX() { return 1; }\n");
    write(&d, "src/New.tsx", "export const N = 1;\n");
    write(&d, "src/Flow.js", "// @flow\nexport const F = 1;\n");
    write(&d, "src/Button/Button.stories.tsx", "import { Button } from './Button';\nimport { W } from '../Renamed';\nimport { F } from '../Flow';\n");
    write(
        &d,
        "src/Button/Button.test.tsx",
        "import { Button } from './Button';\n// more\n",
    );
    write(&d, "src/orphan.ts", "export const o = 2;\n");
    write(&d, "src/data.json", "{\"a\":1}\n");
    write(&d, ".storybook/preview.tsx", "export default { a: 1 };\n");
    fs::remove_file(d.join("src/Gone.tsx")).unwrap();
    git(&d, &["mv", "src/Was.tsx", "src/Renamed.tsx"]);
    commit(&d, "work");
    write(&d, "pxsig.manifest.json", &manifest().to_string());
    d
}

fn manifest() -> Value {
    json!({
        "srcRoot": "src",
        "affectsAll": [".storybook"],
        "affectsIgnore": ["pxsig.manifest.json"],
        "stories": [
            { "id": "button--primary", "sig": "b1.psig", "importPath": "src/Button/Button.stories.tsx" },
            { "id": "button--small", "sig": "b2.psig", "importPath": "src/Button/Button.stories.tsx" }
        ]
    })
}

fn key() -> Value {
    json!({ "backend": "babel", "compiler": "1.0.0", "babel": "7.29.7", "options": { "compilationMode": "infer", "target": "19", "lint": true } })
}

pub(super) fn run(root: &Path, select: Select, options: Value) -> Value {
    plan(&PlanOpts {
        manifest: root.join("pxsig.manifest.json"),
        root: root.to_path_buf(),
        select,
        cache: root.join(".pxsig/cache/react"),
        options,
    })
    .unwrap()
}

fn file<'a>(p: &'a Value, path: &str) -> &'a Value {
    p["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == path)
        .unwrap_or_else(|| panic!("{path} not in {p:#}"))
}

fn paths(p: &Value) -> Vec<&str> {
    p["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect()
}

#[test]
fn since_picks_changed_modules_that_reach_an_entry_and_skips_the_rest() {
    let d = repo();
    let p = run(&d, Select::Since("main".into()), json!({ "key": key() }));
    // Not the stories, test or styles (excluded), the orphan (no entry), the data file (not a
    // module), the deleted file; the Flow file is skipped with a reason.
    assert_eq!(
        paths(&p),
        [
            ".storybook/preview.tsx",
            "src/Button/Button.tsx",
            "src/New.tsx",
            "src/Renamed.tsx",
            "src/useX.ts"
        ]
    );
    assert_eq!(
        p["skipped"],
        json!([{ "path": "src/Flow.js", "why": "a Flow file" }])
    );
    assert_eq!(p["base"]["since"], "main");
    assert_eq!(p["base"]["commit"].as_str().unwrap().len(), 7);

    let b = file(&p, "src/Button/Button.tsx");
    assert_eq!(b["entries"], json!(["button--primary", "button--small"]));
    assert_eq!(b["all"], false);
    assert_eq!(b["compare"], true);
    assert_eq!(b["parser"], json!(["jsx", "typescript"]));
    assert_eq!(b["head"]["hit"], false);
    assert!(b["head"]["text"].as_str().unwrap().contains("return 1"));
    assert!(b["base"]["text"].as_str().unwrap().contains("return null"));
    assert_ne!(b["head"]["sha"], b["base"]["sha"]);
    // A new file: compared (everything in it is new), no base side.
    let n = file(&p, "src/New.tsx");
    assert_eq!(
        (n["compare"].clone(), n["base"].clone()),
        (json!(true), Value::Null)
    );
    // A rename reads its base from the old path.
    let r = file(&p, "src/Renamed.tsx");
    assert_eq!(r["from"], "src/Was.tsx");
    assert!(r["base"]["text"].as_str().unwrap().contains("W = 1"));
    // A Storybook config module reaches every entry.
    assert_eq!(file(&p, ".storybook/preview.tsx")["all"], true);
    assert_eq!(file(&p, "src/useX.ts")["parser"], json!(["typescript"]));
}

#[test]
fn a_cached_side_is_a_hit_without_text_and_any_key_change_misses() {
    let d = repo();
    let p = run(&d, Select::Since("main".into()), json!({ "key": key() }));
    let b = file(&p, "src/Button/Button.tsx");
    let cache_dir = d.join(".pxsig/cache/react");
    cache::write(
        &cache_dir,
        b["head"]["sha"].as_str().unwrap(),
        &json!({ "functions": [] }),
    )
    .unwrap();
    let again = run(&d, Select::Since("main".into()), json!({ "key": key() }));
    let h = &file(&again, "src/Button/Button.tsx")["head"];
    assert_eq!(h["hit"], true);
    assert!(h.get("text").is_none());
    for change in [
        json!({ "compiler": "1.0.1" }),
        json!({ "babel": "8.1.0" }),
        json!({ "backend": "oxc" }),
        json!({ "options": { "compilationMode": "all", "target": "19", "lint": true } }),
        json!({ "options": { "compilationMode": "infer", "target": "18", "lint": true } }),
        json!({ "options": { "compilationMode": "infer", "target": "19", "lint": false } }),
    ] {
        let mut k = key();
        for (name, v) in change.as_object().unwrap() {
            k[name] = v.clone();
        }
        let p = run(&d, Select::Since("main".into()), json!({ "key": k }));
        assert_eq!(
            file(&p, "src/Button/Button.tsx")["head"]["hit"],
            false,
            "{change}"
        );
    }
    // The same key with its fields in another order is the same key.
    let reordered = json!({ "options": { "lint": true, "target": "19", "compilationMode": "infer" }, "babel": "7.29.7", "compiler": "1.0.0", "backend": "babel" });
    let p = run(
        &d,
        Select::Since("main".into()),
        json!({ "key": reordered }),
    );
    assert_eq!(file(&p, "src/Button/Button.tsx")["head"]["hit"], true);
}

#[test]
fn cache_key_has_no_path_and_a_corrupt_entry_is_a_miss() {
    let k = key();
    let a = cache::key(&k, &["jsx", "typescript"], b"export function A() {}");
    // Same bytes, anywhere: same key (a moved file is a hit). Other parser plugins or bytes: not.
    assert_eq!(
        a,
        cache::key(&k, &["jsx", "typescript"], b"export function A() {}")
    );
    assert_ne!(
        a,
        cache::key(&k, &["typescript"], b"export function A() {}")
    );
    assert_ne!(
        a,
        cache::key(&k, &["jsx", "typescript"], b"export function A() {}\r\n")
    );
    let d = tmp("cache");
    cache::write(&d, &a, &json!({ "functions": [{ "name": "A" }] })).unwrap();
    assert_eq!(cache::read(&d, &a).unwrap()["functions"][0]["name"], "A");
    let file = d.join(&a[..2]).join(format!("{a}.json"));
    fs::write(&file, "{ not json").unwrap();
    assert!(cache::read(&d, &a).is_none());
    fs::write(&file, r#"{"v":1,"result":{"functions":"no"}}"#).unwrap();
    assert!(cache::read(&d, &a).is_none());
}

#[test]
fn exclude_replaces_the_default_list() {
    let d = repo();
    let p = run(
        &d,
        Select::Since("main".into()),
        json!({ "key": key(), "exclude": ["src/useX.ts"] }),
    );
    let ps = paths(&p);
    assert!(ps.contains(&"src/Button/Button.css.ts"), "{ps:?}");
    assert!(!ps.contains(&"src/useX.ts"), "{ps:?}");
}

#[test]
fn files_compare_with_head_and_take_windows_separators() {
    let d = repo();
    write(
        &d,
        "src/Button/Button.tsx",
        "export function Button() { return 2; }\n",
    );
    let p = run(
        &d,
        Select::Files(vec!["src\\Button\\Button.tsx".into()]),
        json!({ "key": key() }),
    );
    assert_eq!(paths(&p), ["src/Button/Button.tsx"]);
    assert_eq!(p["base"]["since"], "HEAD");
    assert!(file(&p, "src/Button/Button.tsx")["base"]["text"]
        .as_str()
        .unwrap()
        .contains("return 1"));
    // An untracked file named with --files has no base to read: not compared, with a note.
    write(&d, "src/Extra.tsx", "export const E = 1;\n");
    write(
        &d,
        "src/Button/Button.stories.tsx",
        "import { E } from '../Extra';\n",
    );
    let p = run(
        &d,
        Select::Files(vec!["src/Extra.tsx".into()]),
        json!({ "key": key() }),
    );
    assert_eq!(file(&p, "src/Extra.tsx")["compare"], false);
    assert_eq!(
        p["notes"],
        json!(["react: src/Extra.tsx: the base side cannot be read, so it is not compared"])
    );
}

#[test]
fn all_lists_every_module_reaching_an_entry_with_no_comparison() {
    let d = repo();
    let p = run(&d, Select::All, json!({ "key": key() }));
    assert_eq!(p["base"], Value::Null);
    assert_eq!(
        paths(&p),
        [
            "src/Button/Button.tsx",
            "src/New.tsx",
            "src/Renamed.tsx",
            "src/useX.ts"
        ]
    );
    assert_eq!(
        p["skipped"],
        json!([{ "path": "src/Flow.js", "why": "a Flow file" }])
    );
    for f in p["files"].as_array().unwrap() {
        assert_eq!(f["compare"], false);
        assert_eq!(f["base"], Value::Null);
        assert_eq!(f["entries"], json!(["button--primary", "button--small"]));
    }
}

#[test]
fn no_merge_base_compares_nothing_and_says_so() {
    let d = repo();
    git(&d, &["checkout", "-q", "--orphan", "lone"]);
    commit(&d, "lone");
    let p = run(&d, Select::Since("main".into()), json!({ "key": key() }));
    assert_eq!(p["base"], Value::Null);
    assert!(
        p["notes"][0]
            .as_str()
            .unwrap()
            .starts_with("react: no merge base"),
        "{p:#}"
    );
    for f in p["files"].as_array().unwrap() {
        assert_eq!(f["compare"], false, "{f}");
    }
}

#[test]
fn at_most_max_files_by_path_and_a_note() {
    let d = repo();
    let mut story = String::new();
    for i in 0..=MAX_FILES {
        write(
            &d,
            &format!("src/many/M{i:03}.tsx"),
            "export const M = 1;\n",
        );
        story.push_str(&format!("import '../many/M{i:03}';\n"));
    }
    write(&d, "src/Button/Button.stories.tsx", &story);
    let p = run(
        &d,
        Select::Since("main".into()),
        json!({ "key": key(), "exclude": [] }),
    );
    assert_eq!(p["files"].as_array().unwrap().len(), MAX_FILES);
    let beyond: Vec<&Value> = p["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["why"] == "beyond the first 300 files")
        .collect();
    assert!(!beyond.is_empty());
    assert!(
        p["notes"].as_array().unwrap().iter().any(|n| n
            .as_str()
            .unwrap()
            .ends_with("files beyond the first 300 not analysed")),
        "{:#}",
        p["notes"]
    );
}

#[test]
fn the_key_is_required() {
    let d = repo();
    let e = plan(&PlanOpts {
        manifest: d.join("pxsig.manifest.json"),
        root: d.clone(),
        select: Select::All,
        cache: d.join("c"),
        options: json!({}),
    })
    .unwrap_err();
    assert!(e.to_string().contains("options.key"), "{e}");
}
