use super::config::{exports_target, strip_suffix};
use super::*;

fn specs(src: &str) -> Vec<Ref> {
    scan_code(src).into_iter().map(|f| f.r).collect()
}

#[test]
fn reads_every_form() {
    let src = r#"
        import React from 'react';
        import { Button } from '../Button';
        export * from "./Card.css";
        const L = React.lazy(() => import('./Lazy'));
        const x = require('./legacy');
        import raw from './a.md?raw';
        const u = new URL('./worker.js', import.meta.url);
        const g = import.meta.glob(['./icons/*.svg', '!./icons/x.svg']);
        const ctx = require.context('./locales', true, /\.json$/);
        const i = import(`./icons/${name}.svg`);
        const font = { src: "url('./fonts/a.woff2') format('woff2')" };
        // taken from 'the dashboard' — prose, not a specifier
    "#;
    assert_eq!(
        specs(src),
        vec![
            Ref::Spec("react".into()),
            Ref::Spec("../Button".into()),
            Ref::Spec("./Card.css".into()),
            Ref::Spec("./Lazy".into()),
            Ref::Spec("./legacy".into()),
            Ref::Spec("./a.md?raw".into()),
            Ref::Spec("./worker.js".into()),
            Ref::Glob(vec!["./icons/*.svg".into()]),
            Ref::Context("./locales".into()),
            Ref::Template {
                prefix: "./icons/".into(),
                suffix: ".svg".into()
            },
            Ref::Url("./fonts/a.woff2".into()),
        ]
    );
    assert_eq!(
        scan_code("a\nb\nimport './x';").first().map(|f| f.line),
        Some(3)
    );
}

#[test]
fn reads_style_sheets() {
    let src = "@import 'base.css';\n@use \"sass:math\";\n@forward './tokens';\n.a { background: url(img/a.png); composes: b from './b.css'; }\n.c { background: url(\"https://x.test/a.png\"); mask: url(#m); }";
    let got: Vec<Ref> = scan_style(src).into_iter().map(|f| f.r).collect();
    assert_eq!(
        got,
        vec![
            Ref::Spec("base.css".into()),
            Ref::Spec("sass:math".into()),
            Ref::Spec("./tokens".into()),
            Ref::Url("img/a.png".into()),
            Ref::Spec("./b.css".into()),
            Ref::Url("https://x.test/a.png".into()),
            Ref::Url("#m".into()),
        ]
    );
}

#[test]
fn jsonc_and_patterns() {
    let v =
        parse_jsonc("{ // c\n \"a\": [1, 2,], /* b */ \"s\": \"x // not a comment\", }").unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "a": [1, 2], "s": "x // not a comment" })
    );
    let ex = serde_json::json!({ ".": { "types": "./d.ts", "import": "./dist/index.mjs" }, "./icons/*": "./dist/icons/*.js", "./x": null });
    assert_eq!(exports_target(&ex, "."), Some("./dist/index.mjs".into()));
    assert_eq!(
        exports_target(&ex, "./icons/a"),
        Some("./dist/icons/a.js".into())
    );
    assert_eq!(exports_target(&ex, "./x"), None);
    assert_eq!(exports_target(&ex, "./nope"), None);
    assert_eq!(
        exports_target(
            &serde_json::json!({ "source": "./src/i.ts", "default": "./dist/i.js" }),
            "."
        ),
        Some("./src/i.ts".into())
    );
    assert_eq!(split_package("@a/b/c/d"), ("@a/b".into(), "./c/d".into()));
    assert_eq!(split_package("lodash"), ("lodash".into(), ".".into()));
    assert_eq!(strip_suffix("./a.svg?url#x"), "./a.svg");
    assert_eq!(strip_suffix("#internal/a"), "#internal/a");
}
