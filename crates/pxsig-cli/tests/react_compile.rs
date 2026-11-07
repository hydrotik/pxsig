//! `pxsig react-compile` as a process: results in order, the compiler's name and version, warnings,
//! a file that crashes the compiler isolated as `compiler-error` while the others still compile, and
//! the exit code 2 for a bad request or an engine built without the compiler.

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn react_compile(body: &Value) -> (i32, Value, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_pxsig"))
        .arg("react-compile")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(body.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let v = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    (
        out.status.code().unwrap_or(-1),
        v,
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn file(path: &str, text: &str) -> Value {
    json!({ "path": path, "text": text, "parser": ["jsx"] })
}

const GOOD: &str = "export function A({ x }) { return <b>{x}</b>; }\n";
/// oxc_react_compiler 0.143.0 panics on this name (crates/pxsig-react/src/tests.rs pins it).
const CRASH: &str = "import { useRef } from 'react';\n\
    export function B() { const 한글Ref = useRef(0); \
    return <i onClick={() => { 한글Ref.current += 1; }} />; }\n";

#[cfg(feature = "react-oxc")]
#[test]
fn a_batch_answers_each_file_in_order() {
    let body = json!({
        "options": { "lint": true, "environment": { "customHooks": {} } },
        "files": [file("a.jsx", GOOD), file("b.jsx", "export function ( {"), file("c.jsx", GOOD)],
    });
    let (code, v, _) = react_compile(&body);
    assert_eq!(code, 0);
    assert_eq!(
        v["compiler"],
        json!({ "name": "oxc_react_compiler", "version": "0.143.0" })
    );
    assert_eq!(
        v["warnings"],
        json!(["environment.customHooks is not supported by the built-in compiler: left out"])
    );
    let results = v["results"].as_array().unwrap();
    assert_eq!(results.len(), 3);
    assert_eq!(results[0]["functions"][0]["outcome"], "compiled");
    assert_eq!(results[1], json!({ "error": "compiler-error" }));
    assert_eq!(results[2]["functions"][0]["memoSlots"], 2);
}

#[cfg(feature = "react-oxc")]
#[test]
fn a_file_that_crashes_the_compiler_is_a_compiler_error_and_the_others_compile() {
    let files: Vec<Value> = (0..6)
        .map(|i| file(&format!("f{i}.jsx"), if i == 3 { CRASH } else { GOOD }))
        .collect();
    let (code, v, stderr) = react_compile(&json!({ "files": files }));
    assert_eq!(code, 0);
    let results = v["results"].as_array().unwrap();
    for (i, r) in results.iter().enumerate() {
        if i == 3 {
            assert_eq!(r, &json!({ "error": "compiler-error" }));
        } else {
            assert_eq!(r["functions"][0]["outcome"], "compiled", "file {i}");
        }
    }
    // The child's panic message (local paths) does not come through.
    assert!(!stderr.contains("panicked"), "{stderr}");
}

#[cfg(feature = "react-oxc")]
#[test]
fn a_bad_request_is_exit_code_2() {
    let (code, _, stderr) = react_compile(&json!({ "options": { "target": "20" }, "files": [] }));
    assert_eq!(code, 2);
    assert!(stderr.contains("target must be"), "{stderr}");
    let (code, _, _) = react_compile(&json!("not a request"));
    assert_eq!(code, 2);
    let (code, v, _) = react_compile(&json!({ "files": [] }));
    assert_eq!((code, &v["results"]), (0, &json!([])));
}

#[cfg(not(feature = "react-oxc"))]
#[test]
fn without_the_feature_it_says_so() {
    let (code, _, stderr) = react_compile(&json!({ "files": [file("a.jsx", GOOD)] }));
    assert_eq!(code, 2);
    assert!(stderr.contains("cargo feature react-oxc"), "{stderr}");
    let _ = CRASH;
}
