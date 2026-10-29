use super::test_support::*;
use super::*;

#[test]
fn every_class() {
    let ws = tmp("classes");
    init(&ws);
    workspace(&ws);
    commit(&ws, "base");
    let m = manifest(&["docs/**", "**/*.md"]);
    let run = |files: &[&str]| {
        affected(
            &ws,
            &m,
            &changes_from_files(
                &ws,
                &files.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            ),
        )
        .unwrap()
    };

    let v = run(&["src/Button/Button.tsx"]);
    assert_eq!(
        (
            class_of(&v, "src/Button/Button.tsx"),
            ids(&v, "ids"),
            v["all"].clone()
        ),
        ("graph".into(), vec!["b".to_string()], json!(false))
    );
    let v = run(&["src/Button/Button.test.tsx"]);
    assert_eq!(
        (class_of(&v, "src/Button/Button.test.tsx"), ids(&v, "ids")),
        ("graph-no-entry".into(), vec![])
    );
    let v = run(&["src/Ünïcode/Card.stories.tsx"]);
    assert_eq!(ids(&v, "ids"), vec!["c"]);
    let v = run(&[".pxsig/baselines/Button/b.psig"]);
    assert_eq!(
        (
            class_of(&v, ".pxsig/baselines/Button/b.psig"),
            ids(&v, "ids"),
            ids(&v, "baselines")
        ),
        (
            "baseline".into(),
            vec!["b".to_string()],
            vec!["b".to_string()]
        )
    );
    let v = run(&[
        ".pxsig/baselines/Button/b@m.psig",
        ".pxsig/baselines/Gone/z.psig",
    ]);
    assert_eq!(
        class_of(&v, ".pxsig/baselines/Button/b@m.psig"),
        "baseline-other"
    );
    assert_eq!(v["otherSuites"]["matrix"], 1);
    assert!(v["files"][1]["why"].as_str().unwrap().contains("orphaned"));
    assert_eq!(ids(&v, "ids"), Vec::<String>::new());

    // Unchanged record named explicitly: every entry it names.
    let v = run(&[".pxsig/a11y.json"]);
    assert_eq!(
        (class_of(&v, ".pxsig/a11y.json"), ids(&v, "ids")),
        ("store-record".into(), vec!["b".to_string()])
    );
    let v = run(&[".pxsig/.gitignore"]);
    assert_eq!(
        (class_of(&v, ".pxsig/.gitignore"), v["all"].clone()),
        ("store-other".into(), json!(true))
    );
    assert_eq!(
        v["failSafe"],
        json!([]),
        "a store file is traced all, not the fail-safe"
    );

    // The fail-safe: untraced under srcRoot, outside srcRoot. `traced` leaves it out.
    let v = run(&["src/data.json", "src/Button/Button.tsx"]);
    assert_eq!(
        (
            class_of(&v, "src/data.json"),
            v["all"].clone(),
            ids(&v, "traced")
        ),
        ("untraced".into(), json!(true), vec!["b".to_string()])
    );
    assert_eq!(v["reason"], "src/data.json: nothing imports it");
    let v = run(&["package.json"]);
    assert_eq!(
        (class_of(&v, "package.json"), ids(&v, "ids").len()),
        ("outside".into(), 2)
    );
    let v = run(&[
        "docs/a.txt",
        "README.md",
        "src/Button/Button.llm-context.md",
    ]);
    assert_eq!(
        (v["all"].clone(), ids(&v, "ignored").len()),
        (json!(false), 3)
    );

    // The ignore list never hides a traced path, a baseline, a store file or an affects-all path.
    let m = manifest(&["**"]);
    let v = affected(
        &ws,
        &m,
        &changes_from_files(
            &ws,
            &[
                "src/Button/Button.tsx".into(),
                ".pxsig/baselines/Button/b.psig".into(),
                ".pxsig/.gitignore".into(),
                "pxsig.config.json".into(),
            ],
        ),
    )
    .unwrap();
    assert_eq!(class_of(&v, "src/Button/Button.tsx"), "graph");
    assert_eq!(class_of(&v, ".pxsig/baselines/Button/b.psig"), "baseline");
    assert_eq!(class_of(&v, ".pxsig/.gitignore"), "store-other");
    assert_eq!(class_of(&v, "pxsig.config.json"), "affects-all");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn records_against_the_merge_base() {
    let ws = tmp("records");
    init(&ws);
    workspace(&ws);
    commit(&ws, "base");
    git(&ws, &["checkout", "-q", "-b", "pr"]);
    write(
        &ws,
        ".pxsig/approvals.ndjson",
        "{\"id\":\"b\"}\n{\"id\":\"c\"}\n",
    );
    write(&ws, ".pxsig/a11y.json", "{\"b\":[\"x\"]}\n");
    commit(&ws, "approve");
    let m = manifest(&[]);
    let v = affected(&ws, &m, &changes_since(&ws, "main").unwrap()).unwrap();
    assert_eq!(ids(&v, "ids"), vec!["b", "c"]);
    assert_eq!(v["records"][".pxsig/approvals.ndjson"], json!(["c"]));
    assert_eq!(v["records"][".pxsig/a11y.json"], json!(["b"]));
    assert_eq!(v["all"], false);
    // A rewritten log selects everything.
    write(&ws, ".pxsig/approvals.ndjson", "{\"id\":\"c\"}\n");
    let v = affected(&ws, &m, &changes_since(&ws, "main").unwrap()).unwrap();
    assert_eq!(
        (v["all"].clone(), v["failSafe"].clone()),
        (json!(true), json!([]))
    );
    assert!(
        v["reason"].as_str().unwrap().contains("rewritten"),
        "{}",
        v["reason"]
    );
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn renames_keep_both_paths_and_unicode_names_match() {
    let ws = tmp("rename");
    init(&ws);
    workspace(&ws);
    commit(&ws, "base");
    git(&ws, &["checkout", "-q", "-b", "pr"]);
    git(
        &ws,
        &[
            "mv",
            "src/Ünïcode/Card.stories.tsx",
            "src/Ünïcode/Kärt.stories.tsx",
        ],
    );
    commit(&ws, "rename");
    let ch = changes_since(&ws, "main").unwrap();
    let paths: Vec<&str> = ch.files.iter().map(|c| c.path.as_str()).collect();
    assert!(
        paths.contains(&"src/Ünïcode/Card.stories.tsx")
            && paths.contains(&"src/Ünïcode/Kärt.stories.tsx"),
        "{paths:?}"
    );
    let v = affected(&ws, &manifest(&[]), &ch).unwrap();
    assert_eq!(
        ids(&v, "ids"),
        vec!["c"],
        "the old path is still entry c's importPath"
    );
    let renamed = v["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "src/Ünïcode/Kärt.stories.tsx")
        .unwrap()
        .clone();
    assert_eq!(renamed["from"], "src/Ünïcode/Card.stories.tsx");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn nested_workspace_paths_are_workspace_relative() {
    let repo = tmp("nested");
    init(&repo);
    let ws = repo.join("ws");
    workspace(&ws);
    write(&repo, "top.txt", "x\n");
    commit(&repo, "base");
    git(&repo, &["checkout", "-q", "-b", "pr"]);
    write(&ws, "src/Button/Button.tsx", "export const B = 2;\n");
    write(&repo, "top.txt", "y\n");
    commit(&repo, "edit");
    write(&ws, "src/new.json", "{}\n");
    let ch = changes_since(&ws, "main").unwrap();
    let v = affected(&ws, &manifest(&[]), &ch).unwrap();
    assert_eq!(class_of(&v, "src/Button/Button.tsx"), "graph");
    assert_eq!(class_of(&v, "src/new.json"), "untraced");
    assert_eq!(class_of(&v, "$repo/top.txt"), "outside-workspace");
    let v = affected(&ws, &manifest(&["$repo/top.txt", "src/*.json"]), &ch).unwrap();
    assert_eq!(
        (v["all"].clone(), ids(&v, "ids")),
        (json!(false), vec!["b".to_string()])
    );
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn no_merge_base_selects_everything() {
    let origin = tmp("origin");
    init(&origin);
    workspace(&origin);
    commit(&origin, "c1");
    git(&origin, &["checkout", "-q", "-b", "feature"]);
    write(&origin, "src/Button/Button.tsx", "export const B = 3;\n");
    commit(&origin, "c2");
    git(&origin, &["checkout", "-q", "main"]);
    write(&origin, "README.md", "main\n");
    commit(&origin, "c3");
    let clone = tmp("shallow");
    // file:// so --depth applies (a plain path makes a local, full clone); `C:/…` needs a third slash.
    let path = crate::io::to_slash(&origin);
    let url = if path.starts_with('/') {
        format!("file://{path}")
    } else {
        format!("file:///{path}")
    };
    git(
        &clone,
        &["clone", "-q", "--depth", "1", "--branch", "main", &url, "."],
    );
    git(
        &clone,
        &["fetch", "-q", "--depth", "1", "origin", "feature:feature"],
    );
    let ch = changes_since(&clone, "feature").unwrap();
    assert!(
        ch.fail_all
            .as_deref()
            .is_some_and(|w| w.contains("shallow clone")),
        "{:?}",
        ch.fail_all
    );
    let v = affected(&clone, &manifest(&[]), &ch).unwrap();
    assert_eq!(
        (
            v["all"].clone(),
            ids(&v, "ids").len(),
            v["failSafe"][0]["class"].clone()
        ),
        (json!(true), 2, json!("no-merge-base"))
    );
    assert!(
        changes_since(&clone, "no-such-ref").is_err(),
        "an unknown ref stays an error"
    );
    let _ = fs::remove_dir_all(&origin);
    let _ = fs::remove_dir_all(&clone);
}
