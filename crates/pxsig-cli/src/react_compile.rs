//! `pxsig react-compile`: the built-in React Compiler (`oxc_react_compiler`, crates/pxsig-react)
//! over a batch of file sides, answering each as lib/react/worker.mjs does.
//!
//! In: `{ "options": { compilationMode?, target?, environment?, lint? }, "files": [{ path, text,
//! parser }] }` on stdin. Out: `{ "compiler": { name, version }, "warnings": [..], "results": [..] }`
//! on stdout, one result per file in order: `{ functions }` or `{ error: "compiler-error" }`.
//!
//! The compiler can panic on input it does not handle, and the release build aborts on a panic. So
//! the batch runs in a child process (`react-compile --worker`), which prints each file's result
//! as it finishes. If the child dies, the files it did not answer are compiled again one at a time,
//! each in a child of its own; a file whose child dies too is `compiler-error`. The child's stderr
//! is dropped: a panic message names local paths.
//!
//! Built without the `react-oxc` feature, the command exits 2 and says so.

#[cfg(not(feature = "react-oxc"))]
pub fn run(_worker: bool) -> anyhow::Result<u8> {
    anyhow::bail!("this engine is built without the React Compiler (cargo feature react-oxc)")
}

#[cfg(feature = "react-oxc")]
pub use imp::run;

#[cfg(feature = "react-oxc")]
mod imp {
    use anyhow::{Context, Result};
    use rayon::prelude::*;
    use serde::Deserialize;
    use serde_json::{json, Value};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::process::{Command, Stdio};
    use std::sync::Mutex;

    #[derive(Deserialize)]
    struct Request<F> {
        #[serde(default)]
        options: Value,
        files: Vec<F>,
    }

    fn stdin_text() -> Result<String> {
        let mut s = String::new();
        std::io::stdin()
            .read_to_string(&mut s)
            .context("reading the request on stdin")?;
        Ok(s)
    }

    pub fn run(worker: bool) -> Result<u8> {
        let text = stdin_text()?;
        if worker {
            return work(&text);
        }
        let req: Request<Value> = serde_json::from_str(&text).context("the request is not JSON")?;
        let options = pxsig_react::options::from_json(&req.options).map_err(anyhow::Error::msg)?;
        let exe = std::env::current_exe().context("finding this engine")?;
        let all: Vec<usize> = (0..req.files.len()).collect();
        let mut results = batch(&exe, &req, &all);
        if results.iter().any(Option::is_none) {
            for i in all {
                if results[i].is_none() {
                    results[i] = batch(&exe, &req, &[i]).pop().flatten();
                }
            }
        }
        let failed = json!({ "error": "compiler-error" });
        let out = json!({
            "compiler": { "name": pxsig_react::COMPILER, "version": pxsig_react::COMPILER_VERSION },
            "warnings": options.warnings,
            "results": results.into_iter().map(|r| r.unwrap_or_else(|| failed.clone())).collect::<Vec<_>>(),
        });
        let mut stdout = std::io::stdout().lock();
        serde_json::to_writer(&mut stdout, &out)?;
        writeln!(stdout)?;
        Ok(0)
    }

    /// Compile `which` of the request's files in a child; `None` for each one it did not answer.
    fn batch(exe: &std::path::Path, req: &Request<Value>, which: &[usize]) -> Vec<Option<Value>> {
        let mut results = vec![None; which.len()];
        let body = json!({
            "options": req.options,
            "files": which.iter().map(|&i| &req.files[i]).collect::<Vec<_>>(),
        });
        let spawned = Command::new(exe)
            .args(["react-compile", "--worker"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = spawned else {
            return results;
        };
        // The request goes in from its own thread, so a child answering as it reads never blocks.
        let input = child.stdin.take();
        let writer = std::thread::spawn(move || {
            if let Some(mut w) = input {
                let _ = serde_json::to_writer(&mut w, &body);
            }
        });
        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let (Some(i), Some(r)) = (v["i"].as_u64(), v.get("result")) {
                    if let Some(slot) = results.get_mut(i as usize) {
                        *slot = Some(r.clone());
                    }
                }
            }
        }
        let _ = writer.join();
        // A child that died answered some files first: those results stand (each line is whole),
        // and the caller compiles the rest again.
        let _ = child.wait();
        results
    }

    /// The child: compile each file and print `{ "i", "result" }` per line as it finishes.
    fn work(text: &str) -> Result<u8> {
        let req: Request<pxsig_react::File> =
            serde_json::from_str(text).context("the request is not JSON")?;
        let options = pxsig_react::options::from_json(&req.options).map_err(anyhow::Error::msg)?;
        let stdout = Mutex::new(std::io::stdout());
        req.files.par_iter().enumerate().for_each(|(i, f)| {
            let line = json!({ "i": i, "result": pxsig_react::compile_file(f, &options) });
            let mut out = stdout.lock().unwrap_or_else(|e| e.into_inner());
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
        });
        Ok(0)
    }
}
