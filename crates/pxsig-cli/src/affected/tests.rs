use super::changes::parse_name_status;
use super::*;

#[test]
fn globs() {
    assert!(glob_match("docs/**", "docs/a/b.md"));
    assert!(glob_match("docs/", "docs/a.md"));
    assert!(glob_match("**/*.md", "README.md"));
    assert!(glob_match("**/*.md", "src/a/B.llm-context.md"));
    assert!(!glob_match("*.md", "src/a.md"));
    assert!(glob_match("*.png", "logo.png"));
    assert!(glob_match("packages/{a,b}/**", "packages/b/x.ts"));
    assert!(!glob_match("packages/{a,b}/**", "packages/c/x.ts"));
    assert!(glob_match(
        "**/{jest,tsdown}.config.*",
        "packages/x/jest.config.cjs"
    ));
    assert!(glob_match("a?c", "abc"));
    assert!(!glob_match("a?c", "a/c"));
    assert!(glob_match("$repo/other/**", "$repo/other/x"));
    assert!(!glob_match("other/**", "$repo/other/x"));
}

#[test]
fn name_status_keeps_both_sides_of_a_rename() {
    let mut out = Vec::new();
    parse_name_status(
        b"R100\0ws/src/a.ts\0ws/src/b.ts\0M\0ws/src/c.ts\0A\0top.txt\0",
        "ws/",
        &mut out,
    );
    let got: Vec<(String, char, Option<String>)> = out
        .into_iter()
        .map(|c| (c.path, c.status, c.from))
        .collect();
    assert_eq!(
        got,
        vec![
            ("src/b.ts".into(), 'R', Some("src/a.ts".into())),
            ("src/a.ts".into(), 'D', None),
            ("src/c.ts".into(), 'M', None),
            ("$repo/top.txt".into(), 'A', None),
        ]
    );
}

#[test]
fn record_diffs() {
    let RecordDiff::Ids { ids, .. } =
        diff_a11y(r#"{"a":["x"],"b":[]}"#, r#"{"a":["x","y"],"c":[]}"#)
    else {
        panic!()
    };
    assert_eq!(ids, vec!["a", "b", "c"]);
    assert!(matches!(diff_a11y("{", "{}"), RecordDiff::All(_)));
    let RecordDiff::Ids { ids, removed } = diff_manifest(
        r#"{"stories":[{"id":"a","sig":"1"},{"id":"b"}]}"#,
        r#"{"stories":[{"id":"a","sig":"2"},{"id":"c"}]}"#,
    ) else {
        panic!()
    };
    assert_eq!(
        (ids, removed),
        (
            vec!["a".to_string(), "c".to_string()],
            vec!["b".to_string()]
        )
    );
    assert!(matches!(
        diff_manifest(r#"{"grid":1,"stories":[]}"#, r#"{"grid":2,"stories":[]}"#),
        RecordDiff::All(_)
    ));
    let RecordDiff::Ids { ids, .. } = diff_log(
        "{\"id\":\"a\"}\n",
        "{\"id\":\"a\"}\n{\"id\":\"b\"}\n{\"id\":\"b\"}\n",
        "approvals.ndjson",
    ) else {
        panic!()
    };
    assert_eq!(ids, vec!["b"]);
    assert!(matches!(
        diff_log("{\"id\":\"a\"}\n", "{\"id\":\"z\"}\n", "approvals.ndjson"),
        RecordDiff::All(_)
    ));
    assert!(matches!(
        diff_log("", "not json\n", "approvals.ndjson"),
        RecordDiff::All(_)
    ));
}
