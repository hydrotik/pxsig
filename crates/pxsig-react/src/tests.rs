//! The answers pinned on real compiles with `oxc_react_compiler` =0.143.0. Two kinds of pin:
//!
//! - the compiled-function detection (collect.rs): a rebuilt body, the memo cache's size, the
//!   opt-out pass. These rest on how the crate builds its output, not on its API, so a bump that
//!   changes it must fail here;
//! - where this compiler answers differently from babel-plugin-react-compiler 1.0.0 (the newest
//!   release): the port follows React's main branch. A bump that changes one of them fails here,
//!   and its pull request says why (with scripts/react-parity.mjs's report).

use super::*;
use serde_json::{json, Value};

/// The `SOURCE` of packages/pxsig/test/react-compile.test.mjs, verbatim (a .txt: no formatter or
/// linter rewrites it, so its lines stay the Babel test's).
const SOURCE: &str = include_str!("../tests/babel-test-source.txt");
const TSX: &[&str] = &["jsx", "typescript"];

fn run(text: &str, parser: &[&str], options: Value) -> FileResult {
    let file = File {
        path: "src/x.tsx".into(),
        text: text.into(),
        parser: parser.iter().map(|s| s.to_string()).collect(),
    };
    compile_file(&file, &options::from_json(&options).unwrap())
}

fn functions(r: FileResult) -> Vec<Function> {
    match r {
        FileResult::Functions { functions } => functions,
        FileResult::Error { error } => panic!("{error}"),
    }
}

/// `name line outcome memo [rule:category:severity:stops|finding:line …]` per function.
fn summary(fns: &[Function]) -> Vec<String> {
    fns.iter()
        .map(|f| {
            let ds: Vec<String> = f
                .diagnostics
                .iter()
                .map(|d| {
                    let how = if d.stops { "stops" } else { "finding" };
                    let sev = d.severity.unwrap_or("-");
                    format!(
                        "{}:{}:{sev}:{how}:{}",
                        d.rule,
                        d.category,
                        d.line.unwrap_or(0)
                    )
                })
                .collect();
            let memo = f.memo_slots.map_or(String::new(), |m| format!(" {m}"));
            format!(
                "{} {} {}{memo} [{}]",
                f.name,
                f.line,
                f.outcome,
                ds.join(" ")
            )
        })
        .collect()
}

fn options_for(lint: bool) -> Value {
    json!({ "compilationMode": "infer", "target": "19", "environment": {}, "lint": lint })
}

#[test]
fn every_outcome_on_the_babel_tests_source() {
    let fns = functions(run(SOURCE, TSX, options_for(true)));
    assert_eq!(
        summary(&fns),
        [
            "Good 2 compiled 2 []",
            "RefBad 3 bailout [refs:Refs:Error:stops:3]",
            "Arrow 4 bailout [refs:Refs:Error:stops:4]",
            // Babel 1.0.0: only no-deriving-state-in-effects.
            "useDerived 5 compiled 3 [set-state-in-effect:EffectSetState:Error:finding:5 \
             no-deriving-state-in-effects:EffectDerivationsOfState:Error:finding:5]",
            "Opt 6 opted-out []",
            // Babel 1.0.0: bailout (rule-suppression). The port validates exhaustive memo
            // dependencies by default, and then an eslint suppression no longer stops a function.
            "Sup 7 compiled 2 []",
            "Tri 11 compiled 1 [error-boundaries:ErrorBoundaries:Error:finding:11]",
            "Fancy 12 bailout [refs:Refs:Error:stops:12]",
            "Effect 13 compiled 4 [set-state-in-effect:EffectSetState:Error:finding:13]",
        ]
    );
    assert_eq!(fns[3].kind, "hook");
    assert!(fns
        .iter()
        .filter(|f| f.name != "useDerived")
        .all(|f| f.kind == "component"));
    assert_eq!(
        fns[1].diagnostics[0].reason,
        "Cannot access refs during render"
    );
}

#[test]
fn without_lint_the_same_outcomes_and_no_findings() {
    let lint = functions(run(SOURCE, TSX, options_for(true)));
    let plain = functions(run(SOURCE, TSX, options_for(false)));
    let outcomes = |fs: &[Function]| {
        fs.iter()
            .map(|f| (f.name.clone(), f.outcome))
            .collect::<Vec<_>>()
    };
    assert_eq!(outcomes(&plain), outcomes(&lint));
    assert!(plain.iter().all(|f| f.diagnostics.iter().all(|d| d.stops)));
}

#[test]
fn babel_one_zero_s_suppression_rule_with_its_default() {
    let o = json!({ "environment": { "validateExhaustiveMemoizationDependencies": false } });
    let fns = functions(run(SOURCE, TSX, o));
    let sup = fns.iter().find(|f| f.name == "Sup").unwrap();
    assert_eq!(
        summary(std::slice::from_ref(sup)),
        ["Sup 7 bailout [rule-suppression:Suppression:Error:stops:8]"]
    );
}

#[test]
fn a_compiled_function_with_no_memo_cache_is_compiled_with_zero_slots() {
    // The rebuilt body is the signal, not the cache: this hook memoizes nothing (Babel 1.0.0:
    // compiled, memoSlots 0).
    let src = "import { useContext } from 'react';\nexport function useNothing(C) { return useContext(C); }\n";
    let fns = functions(run(src, &["jsx"], json!({})));
    assert_eq!(summary(&fns), ["useNothing 2 compiled 0 []"]);
}

#[test]
fn the_memo_cache_is_found_under_the_name_the_compiler_imports() {
    // `_c` is taken, so the compiler imports the cache under another name.
    let src = "const _c = 1;\nexport function A({ x }) { return <b>{x}{_c}</b>; }\n";
    let fns = functions(run(src, &["jsx"], json!({})));
    assert_eq!(summary(&fns), ["A 2 compiled 2 []"]);
}

#[test]
fn an_opted_out_function_that_would_not_compile_is_a_bailout() {
    let src = "import { useRef } from 'react';\n\
               export function A() { 'use no memo'; const r = useRef(0); return <i>{r.current}</i>; }\n";
    let fns = functions(run(src, &["jsx"], json!({})));
    assert_eq!(summary(&fns), ["A 2 bailout [refs:Refs:Error:stops:2]"]);
}

#[test]
fn an_opt_out_on_a_function_the_compiler_does_not_consider_is_not_listed() {
    let src = "export function helper(x) { 'use no memo'; return x.current; }\n";
    assert!(functions(run(src, &["jsx"], json!({}))).is_empty());
}

#[test]
fn names_as_the_babel_worker_gives_them() {
    let src = "import { memo, forwardRef } from 'react';
export const Wrapped = memo(forwardRef(function (props, ref) { return <i ref={ref}>{props.a}</i>; }));
export default function Named() { return <b />; }
";
    let names: Vec<String> = functions(run(src, &["jsx"], json!({})))
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert_eq!(names, ["Wrapped", "Named"]);
    // An anonymous default export is not considered (Babel 1.0.0 neither).
    let anon = run(
        "export default function () { return <b />; }\n",
        &["jsx"],
        json!({}),
    );
    assert!(functions(anon).is_empty());
}

#[test]
fn parser_plugins_decide_the_syntax_and_a_file_that_does_not_parse_is_a_compiler_error() {
    let ts = "import { useState } from 'react';\nexport function useN<T>(x: T): T { const [s] = useState(x); return s; }\n";
    assert_eq!(
        summary(&functions(run(ts, &["typescript"], json!({})))),
        ["useN 2 compiled 0 []"]
    );
    let failed = FileResult::Error {
        error: "compiler-error",
    };
    assert_eq!(
        run(
            "export function A( { return <a />; }\n",
            &["jsx"],
            json!({})
        ),
        failed
    );
    // JSX in a .ts file does not parse, as with Babel's `typescript` plugin alone.
    assert_eq!(
        run(
            "export const A = () => <a />;\n",
            &["typescript"],
            json!({})
        ),
        failed
    );
}

#[test]
fn using_declarations_are_declined_with_no_diagnostic() {
    // Babel 1.0.0 compiles this component; the port's lowering declines it and says nothing.
    let src = "export function A() { using r = open(); return <i />; }\n";
    assert!(functions(run(src, &["jsx"], json!({}))).is_empty());
}

#[test]
fn a_non_ascii_ref_like_name_panics_in_the_compiler() {
    // oxc_react_compiler 0.143.0 slices the name by byte (infer_types.rs). The engine's release
    // build aborts on a panic, which is why `pxsig react-compile` runs it in its own process and
    // retries file by file. When a bump fixes it, this test fails: keep the retry, drop this pin.
    let src = "import { useRef } from 'react';\n\
               export function A() { const 한글Ref = useRef(0); \
               return <i onClick={() => { 한글Ref.current += 1; }} />; }\n";
    let file = File {
        path: "a.jsx".into(),
        text: src.into(),
        parser: vec!["jsx".into()],
    };
    let o = options::from_json(&json!({})).unwrap();
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let r = std::panic::catch_unwind(|| compile_file(&file, &o));
    std::panic::set_hook(hook);
    assert!(r.is_err());
}

#[test]
fn options() {
    let o = options::from_json(&json!({ "compilationMode": "all", "target": "18", "lint": true }))
        .unwrap();
    assert!(o.lint && o.warnings.is_empty());
    assert!(options::from_json(&json!({ "compilationMode": "everything" })).is_err());
    assert!(options::from_json(&json!({ "target": 19 })).is_err());
    let o = options::from_json(&json!({ "environment": {
        "validateNoCapitalizedCalls": ["Foo"], "customHooks": {}, "validateHooksUsage": "yes"
    } }))
    .unwrap();
    assert_eq!(
        o.plugin.environment.validate_no_capitalized_calls,
        Some(vec!["Foo".to_string()])
    );
    assert_eq!(o.warnings.len(), 2);
    let mut env = o.plugin.environment.clone();
    for name in options::LINT {
        assert!(options::set_flag(&mut env, name, true), "{name}");
    }
}

#[test]
fn the_rule_table_has_every_category_the_compiler_reports() {
    // oxc_react_compiler 0.143.0's ErrorCategory (diagnostics.rs), which it does not export.
    for c in [
        "Hooks",
        "CapitalizedCalls",
        "StaticComponents",
        "UseMemo",
        "VoidUseMemo",
        "PreserveManualMemo",
        "MemoDependencies",
        "IncompatibleLibrary",
        "Immutability",
        "Globals",
        "Refs",
        "EffectExhaustiveDependencies",
        "EffectSetState",
        "EffectDerivationsOfState",
        "ErrorBoundaries",
        "Purity",
        "RenderSetState",
        "Invariant",
        "Todo",
        "Syntax",
        "UnsupportedSyntax",
        "Config",
        "Gating",
        "Suppression",
    ] {
        assert_ne!(rules::rule_of(c).0, "", "{c}");
    }
    assert_eq!(rules::rule_of("Todo"), ("todo", Some("Hint")));
    assert_eq!(rules::rule_of("Nope"), ("", None));
}

#[test]
fn the_answer_has_the_babel_worker_s_json_shape() {
    let src = "export function A({ x }) { return <b>{x}</b>; }\n";
    let v = serde_json::to_value(run(src, &["jsx"], json!({}))).unwrap();
    assert_eq!(
        v,
        json!({ "functions": [{
            "name": "A", "kind": "component", "line": 1, "endLine": 1, "outcome": "compiled",
            "memoSlots": 2, "diagnostics": []
        }] })
    );
    assert_eq!(
        serde_json::to_value(FAILED).unwrap(),
        json!({ "error": "compiler-error" })
    );
}
