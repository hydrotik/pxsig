//! `pxsig serve`: a long-lived engine over stdio, one JSON
//! request per line → one JSON response per line. Removes the process start
//! (~30 ms) from every call the dashboard server and the Storybook addon make.
//!
//!   → {"id":1,"method":"compare","params":{"png":"a.png","sig":"a.pxsig.json"}}
//!   ← {"id":1,"result":{"pass":true,"metrics":{…}}}
//!
//! Methods: ping · capture · compare (+ outDir: write artifacts) · check · baseline · trim · diff · affected.
//! Paths are resolved against the process cwd (or `root` where a method takes one).

use std::io::{BufRead, Write};
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

use crate::batch::{self, BaselineOpts, CheckOpts};
use crate::gate::{self, GateSpec};
use crate::{affected, io};

fn s<'a>(p: &'a Value, k: &str) -> Result<&'a str> {
    p[k].as_str()
        .ok_or_else(|| anyhow!("missing string param `{k}`"))
}

fn only(p: &Value) -> Option<std::collections::HashSet<String>> {
    p["only"].as_array().map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect()
    })
}

fn gate_of(p: &Value) -> Result<GateSpec> {
    Ok(if p["gate"].is_object() {
        serde_json::from_value(p["gate"].clone())?
    } else {
        GateSpec::default()
    })
}

fn dispatch(method: &str, p: &Value) -> Result<Value> {
    match method {
        "ping" => Ok(
            json!({ "pong": true, "version": env!("CARGO_PKG_VERSION"), "threads": rayon::current_num_threads() }),
        ),
        "capture" => {
            let grid = (p["grid"].as_u64().unwrap_or(64) as usize).clamp(8, 256);
            let min_cell = p["minCellPx"].as_u64().map(|v| v as usize);
            // `env`: the environment the render was made in, written into the header as is.
            let extra = p["env"]
                .is_object()
                .then(|| serde_json::Map::from_iter([("env".to_string(), p["env"].clone())]));
            let r = batch::capture_png_policy(
                &PathBuf::from(s(p, "png")?),
                &PathBuf::from(s(p, "out")?),
                grid,
                min_cell,
                p["detail"].as_bool().unwrap_or(true),
                p.get("entry"),
                extra.as_ref(),
            )?;
            Ok(json!({ "sha256": r.sha256, "grid": r.config.grid, "detail": r.detail.is_some() }))
        }
        "compare" => {
            let b = batch::load_baseline(&PathBuf::from(s(p, "sig")?))?;
            let g = gate::resolve(None, &gate::env_spec(), &gate_of(p)?, None);
            let sig = PathBuf::from(s(p, "sig")?);
            let r = batch::compare_png(&PathBuf::from(s(p, "png")?), &b, &g)?;
            let metrics = batch::metrics_json(&r, g.threshold);
            // On-demand artifacts: the dashboard asks for a passing entry's diff images.
            if let Some(out) = p["outDir"].as_str() {
                io::write_diff_artifacts(&PathBuf::from(out), &io::stem_of(&sig), &r, &metrics)?;
            }
            Ok(
                json!({ "pass": r.pass, "metrics": metrics, "reasons": r.reasons, "detail": batch::detail_json(&r) }),
            )
        }
        "check" => batch::check(&CheckOpts {
            manifest: s(p, "manifest")?.into(),
            png_dir: s(p, "pngDir")?.into(),
            root: p["root"].as_str().unwrap_or(".").into(),
            out_dir: p["outDir"].as_str().map(PathBuf::from),
            artifacts: match p["artifacts"].as_str() {
                Some(a) => batch::Artifacts::parse(a)?,
                None => batch::Artifacts::Failed,
            },
            only: only(p),
            cache: p["cache"].as_str().map(PathBuf::from),
            history: p["history"].as_str().map(PathBuf::from),
            enforcement: p.get("enforcement").filter(|e| e.is_object()).cloned(),
            base_png_dir: p["basePngDir"].as_str().map(PathBuf::from),
            tolerance: p["tolerance"].as_u64().unwrap_or(16) as u8,
            cli_gate: gate_of(p)?,
            env_gate: gate::env_spec(),
        }),
        "baseline" => batch::baseline(&BaselineOpts {
            manifest: s(p, "manifest")?.into(),
            png_dir: s(p, "pngDir")?.into(),
            root: p["root"].as_str().unwrap_or(".").into(),
            only: only(p),
            no_detail: p["detail"] == json!(false),
            env: if p["env"].is_object() {
                Some(serde_json::from_value(p["env"].clone())?)
            } else {
                None
            },
        }),
        "diff" => {
            let (a, aw, ah) = io::decode_png(&PathBuf::from(s(p, "a")?))?;
            let (b, bw, bh) = io::decode_png(&PathBuf::from(s(p, "b")?))?;
            let d = pxsig_core::pixel_diff(
                &a,
                aw,
                ah,
                &b,
                bw,
                bh,
                p["tolerance"].as_u64().unwrap_or(16) as u8,
            );
            if let Some(mask) = p["mask"].as_str() {
                io::write_mask(&PathBuf::from(mask), &d)?;
            }
            Ok(crate::diff_json(&d))
        }
        "trim" => batch::trim(&batch::TrimOpts {
            dir: s(p, "dir")?.into(),
            only: only(p),
            pad: p["pad"].as_u64().unwrap_or(16) as usize,
            tolerance: p["tolerance"].as_u64().unwrap_or(8) as u8,
        }),
        "affected" => {
            let root = PathBuf::from(p["root"].as_str().unwrap_or("."));
            let m = batch::load_manifest(&PathBuf::from(s(p, "manifest")?))?;
            let ch = match p["files"].as_array() {
                Some(a) => affected::changes_from_files(
                    &root,
                    &a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<_>>(),
                ),
                None => affected::changes_since(&root, p["since"].as_str().unwrap_or("main"))?,
            };
            affected::affected(&root, &m, &ch)
        }
        other => Err(anyhow!("unknown method `{other}`")),
    }
}

pub fn run() -> Result<u8> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    serve_lines(stdin.lock(), &mut stdout)?;
    Ok(0)
}

/// The loop: one answer per non-blank request line, until `input` ends. A request that fails
/// (bad JSON, an unknown method, a missing param) answers `{error}` and the loop goes on.
fn serve_lines(input: impl BufRead, out: &mut impl Write) -> Result<()> {
    for line in input.lines() {
        let line = line.context("reading stdin")?;
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<Value>(&line) {
            Ok(req) => {
                let id = req["id"].clone();
                let t = std::time::Instant::now();
                match dispatch(req["method"].as_str().unwrap_or(""), &req["params"]) {
                    Ok(result) => {
                        json!({ "id": id, "result": result, "ms": t.elapsed().as_secs_f64() * 1000.0 })
                    }
                    Err(e) => json!({ "id": id, "error": format!("{e:#}") }),
                }
            }
            Err(e) => json!({ "id": null, "error": format!("bad request: {e}") }),
        };
        writeln!(out, "{resp}")?;
        out.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed `lines` to the loop; every answer, parsed.
    fn answers(lines: &[&str]) -> Vec<Value> {
        let mut out = Vec::new();
        serve_lines(lines.join("\n").as_bytes(), &mut out).unwrap();
        String::from_utf8(out)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn a_bad_request_answers_an_error_and_the_loop_keeps_running() {
        let a = answers(&[
            r#"{"id":1,"method":"nope","params":{}}"#,
            r#"{"id":2,"method":"compare","params":{}}"#,
            r#"{"id":3,"method":"trim"}"#,
            "{not json",
            "",
            "   ",
            r#"{"id":4,"params":{}}"#,
            r#"{"id":5,"method":"ping"}"#,
        ]);
        // Blank lines get no answer; every other line gets exactly one, in order.
        assert_eq!(a.len(), 6, "{a:?}");
        assert_eq!(a[0], json!({ "id": 1, "error": "unknown method `nope`" }));
        assert_eq!(
            a[1],
            json!({ "id": 2, "error": "missing string param `sig`" })
        );
        assert_eq!(
            a[2],
            json!({ "id": 3, "error": "missing string param `dir`" })
        );
        assert_eq!(a[3]["id"], Value::Null);
        assert!(
            a[3]["error"].as_str().unwrap().starts_with("bad request: "),
            "{}",
            a[3]
        );
        assert_eq!(a[4], json!({ "id": 4, "error": "unknown method ``" }));
        // After all of that, the loop still answers.
        assert_eq!(a[5]["id"], 5);
        assert_eq!(a[5]["result"]["pong"], true);
        assert!(a[5]["error"].is_null());
    }
}
