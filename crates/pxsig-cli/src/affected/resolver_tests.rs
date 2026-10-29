use super::test_support::*;
use super::*;

/// A workspace for the resolver: one story per kind of import, each reaching one file.
fn resolver_workspace(ws: &Path) {
    let story = |name: &str, body: &str| write(ws, &format!("src/{name}/{name}.stories.tsx"), body);
    write(ws, "src/data/a.json", "{}");
    story("Json", "import a from '../data/a.json';\n");
    write(ws, "src/icons/x.svg", "<svg/>");
    write(ws, "src/icons/y.svg", "<svg/>");
    story("Raw", "import t from '../docs/a.md?raw';\n");
    write(ws, "src/docs/a.md", "# a\n");
    write(
        ws,
        "src/styles/base.css",
        "@import './tokens.css';\n.a { background: url(img/bg.png); }\n",
    );
    write(ws, "src/styles/tokens.css", ":root {}\n");
    write(ws, "src/styles/img/bg.png", "png");
    story("Css", "import '../styles/base.css';\n");
    story(
        "Worker",
        "const w = new URL('../work/w.js', import.meta.url);\n",
    );
    write(ws, "src/work/w.js", "x\n");
    story("Glob", "const g = import.meta.glob('../icons/*.svg');\n");
    story(
        "Ctx",
        "const c = require.context('../locales', true, /json$/);\n",
    );
    write(ws, "src/locales/en/a.json", "{}");
    story("Tpl", "const i = (n) => import(`../flags/${n}.svg`);\n");
    write(ws, "src/flags/de.svg", "<svg/>");
    story("Esm", "import { e } from '../esm/e.js';\n");
    write(ws, "src/esm/e.ts", "export const e = 1;\n");
    story(
        "Font",
        "const face = { src: \"url('../fonts/a.woff2')\" };\n",
    );
    write(ws, "src/fonts/a.woff2", "font");
    // Bare specifiers: tsconfig paths, `#` imports, an alias, a self-import through `exports`
    // (dist mapped back to src), a workspace package, built-ins and an npm package.
    write(
        ws,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"./src/lib/*\"] } }, // comment\n }",
    );
    write(ws, "src/lib/l.ts", "export const l = 1;\n");
    story("Paths", "import { l } from '@lib/l';\n");
    write(ws, "package.json", "{ \"name\": \"me\", \"imports\": { \"#h/*\": \"./src/h/*.ts\" }, \"exports\": { \"./widgets/*\": { \"types\": \"./dist/widgets/*.d.ts\", \"import\": \"./dist/widgets/*.mjs\" } } }");
    write(ws, "src/h/h.ts", "export const h = 1;\n");
    story("Hash", "import { h } from '#h/h';\n");
    write(ws, "src/al/al.ts", "export const al = 1;\n");
    story("Alias", "import { al } from '~al/al';\n");
    write(ws, "src/widgets/w.tsx", "export const w = 1;\n");
    story("Self", "import { w } from 'me/widgets/w';\nimport fs from 'node:fs';\nimport p from 'path';\nimport r from 'react';\n");
    write(
        ws,
        "node_modules/react/package.json",
        "{ \"name\": \"react\" }",
    );
    write(
        ws,
        "packages/kit/package.json",
        "{ \"name\": \"kit\", \"main\": \"./dist/index.js\" }",
    );
    write(ws, "packages/kit/src/index.ts", "export const k = 1;\n");
    story("Virtual", "import s from 'virtual:status';\n");
    story("Accepted", "import s from 'virtual:other';\n");
    write(
        ws,
        ".storybook/preview.tsx",
        "import '../src/global.css.ts';\n",
    );
    write(ws, "src/global.css.ts", "export {};\n");
}

fn resolver_manifest() -> Manifest {
    let names = [
        "Json", "Raw", "Css", "Worker", "Glob", "Ctx", "Tpl", "Esm", "Font", "Paths", "Hash",
        "Alias", "Self", "Virtual", "Accepted", "Kit",
    ];
    let stories: Vec<Value> = names.iter().map(|n| json!({ "id": n.to_lowercase(), "sig": format!(".pxsig/baselines/{n}.psig"), "importPath": format!("src/{n}/{n}.stories.tsx") })).collect();
    serde_json::from_value(json!({
        "srcRoot": "src",
        "affectsAll": [".storybook"],
        "affectsAliases": { "~al": "src/al" },
        "affectsUnresolved": ["src/Accepted/**"],
        "stories": stories
    }))
    .unwrap()
}

#[test]
fn the_resolver_follows_every_kind_of_import() {
    let ws = tmp("resolver");
    resolver_workspace(&ws);
    #[cfg(unix)]
    {
        fs::create_dir_all(ws.join("node_modules")).unwrap();
        std::os::unix::fs::symlink(ws.join("packages/kit"), ws.join("node_modules/kit")).unwrap();
        write(&ws, "src/Kit/Kit.stories.tsx", "import { k } from 'kit';\n");
    }
    let m = resolver_manifest();
    let run = |f: &str| affected(&ws, &m, &changes_from_files(&ws, &[f.to_string()])).unwrap();
    for (file, id) in [
        ("src/data/a.json", "json"),
        ("src/docs/a.md", "raw"),
        ("src/styles/tokens.css", "css"),
        ("src/styles/img/bg.png", "css"),
        ("src/work/w.js", "worker"),
        ("src/icons/y.svg", "glob"),
        ("src/locales/en/a.json", "ctx"),
        ("src/flags/de.svg", "tpl"),
        ("src/esm/e.ts", "esm"),
        ("src/fonts/a.woff2", "font"),
        ("src/lib/l.ts", "paths"),
        ("src/h/h.ts", "hash"),
        ("src/al/al.ts", "alias"),
        ("src/widgets/w.tsx", "self"),
    ] {
        let v = run(file);
        assert_eq!(
            (class_of(&v, file), ids(&v, "traced")),
            ("graph".to_string(), vec![id.to_string()]),
            "{file}: {}",
            v["reason"]
        );
        // The unresolved `virtual:status` adds its story to every run; the accepted one adds nothing.
        assert_eq!(
            ids(&v, "ids"),
            {
                let mut x = vec![id.to_string(), "virtual".to_string()];
                x.sort();
                x
            },
            "{file}"
        );
    }
    #[cfg(unix)]
    {
        let v = run("packages/kit/src/index.ts");
        assert_eq!(
            ids(&v, "traced"),
            vec!["kit"],
            "a workspace package's dist maps to its source: {}",
            v["reason"]
        );
    }
    let v = run("src/global.css.ts");
    assert_eq!(
        (v["all"].clone(), v["failSafe"].clone()),
        (json!(true), json!([])),
        "imported by an affects-all file: a traced all"
    );
    let v = run("src/Css/Css.stories.tsx");
    let u: Vec<(String, bool, String)> = v["unresolved"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| {
            (
                u["spec"].as_str().unwrap().to_string(),
                u["accepted"].as_bool().unwrap(),
                u["selects"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert!(
        u.contains(&("virtual:status".into(), false, "entries".into()))
            && u.contains(&("virtual:other".into(), true, "none".into())),
        "{u:?}"
    );
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn an_unresolved_import_in_an_affects_all_file_selects_all() {
    let ws = tmp("unresolved-all");
    write(&ws, "src/A/A.stories.tsx", "export {};\n");
    write(
        &ws,
        ".storybook/main.ts",
        "const s = import(`${dir}/status.mjs`);\n",
    );
    let mut m: Manifest = serde_json::from_value(json!({ "srcRoot": "src", "affectsAll": [".storybook"], "stories": [{ "id": "a", "sig": "a.psig", "importPath": "src/A/A.stories.tsx" }] })).unwrap();
    let v = affected(&ws, &m, &changes_from_files(&ws, &[])).unwrap();
    assert_eq!(
        (v["all"].clone(), v["failSafe"][0]["class"].clone()),
        (json!(true), json!("unresolved"))
    );
    m.affects_unresolved = vec![".storybook/main.ts".into()];
    let v = affected(&ws, &m, &changes_from_files(&ws, &[])).unwrap();
    assert_eq!(
        (v["all"].clone(), ids(&v, "ids")),
        (json!(false), Vec::<String>::new())
    );
    let _ = fs::remove_dir_all(&ws);
}
