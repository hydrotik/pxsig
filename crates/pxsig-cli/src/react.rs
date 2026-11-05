//! React analysis, the engine's half (alert mode: nothing here changes an exit code).
//!
//! `react-plan` picks the changed module files, hashes each side and looks it up in the cache;
//! Node compiles the misses with the project's React Compiler; `react-diff` compares each
//! function's result at the merge base and now, writes the cache and `reports/react.json`. The
//! plan and the results pass as files, so long lists never hit a command-line limit. `pxsig serve`
//! answers the same two methods with the same parameters.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

pub mod cache;
pub mod diff;
#[cfg(test)]
mod diff_tests;
pub mod plan;
#[cfg(test)]
mod plan_tests;

pub use plan::{PlanOpts, Select};

/// A JSON argument: inline, or `@file`.
pub fn json_arg(s: &str) -> Result<Value> {
    let text = match s.strip_prefix('@') {
        Some(p) => fs::read_to_string(p).with_context(|| format!("reading {p}"))?,
        None => s.to_string(),
    };
    serde_json::from_str(&text).context("parsing JSON")
}

fn read_json(p: &Path) -> Result<Value> {
    serde_json::from_str(
        &fs::read_to_string(p).with_context(|| format!("reading {}", p.display()))?,
    )
    .with_context(|| format!("parsing {}", p.display()))
}

/// Write `v` to `out` through a temporary name, so a reader never sees half of it.
fn write_json(out: &Path, v: &Value) -> Result<()> {
    if let Some(d) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(d)?;
    }
    let tmp = out.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, serde_json::to_string_pretty(v)? + "\n")
        .with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, out).with_context(|| format!("writing {}", out.display()))
}

/// What a plan run answers: the plan itself, or with `out`, where it went and how much is left
/// to compile.
fn plan_answer(plan: Value, out: Option<&Path>) -> Result<Value> {
    let Some(out) = out else { return Ok(plan) };
    write_json(out, &plan)?;
    let files = plan["files"].as_array().cloned().unwrap_or_default();
    let misses = files
        .iter()
        .flat_map(|f| [&f["head"], &f["base"]])
        .filter(|s| s["hit"] == false)
        .count();
    Ok(
        json!({ "files": files.len(), "misses": misses, "skipped": plan["skipped"], "notes": plan["notes"] }),
    )
}

/// `react-diff`: compare, write the cache (unless `read_only`) and `out`; answers
/// `{ summary, alerts }`.
fn diff_answer(
    plan: &Path,
    results: &Path,
    cache: &Path,
    out: &Path,
    read_only: bool,
) -> Result<Value> {
    let report = diff::diff(&read_json(plan)?, &read_json(results)?, cache, !read_only)?;
    write_json(out, &report)?;
    Ok(
        json!({ "summary": report["summary"], "alerts": report["alerts"], "notes": report["notes"] }),
    )
}

pub fn cmd_plan(o: &PlanOpts, out: Option<PathBuf>) -> Result<u8> {
    let v = plan_answer(plan::plan(o)?, out.as_deref())?;
    println!("{}", serde_json::to_string_pretty(&v)?);
    Ok(0)
}

pub fn cmd_diff(
    plan: &Path,
    results: &Path,
    cache: &Path,
    out: &Path,
    read_only: bool,
) -> Result<u8> {
    println!(
        "{}",
        serde_json::to_string_pretty(&diff_answer(plan, results, cache, out, read_only)?)?
    );
    Ok(0)
}

/// The selection from `since` / `files` / `all` (at most one; none: `since` main).
pub fn select(since: Option<String>, files: Option<Vec<String>>, all: bool) -> Result<Select> {
    match (since, files, all) {
        (None, None, true) => Ok(Select::All),
        (None, Some(f), false) => Ok(Select::Files(f)),
        (s, None, false) => Ok(Select::Since(s.unwrap_or_else(|| "main".into()))),
        _ => Err(anyhow!("pass one of since, files, all")),
    }
}

fn param<'a>(p: &'a Value, k: &str) -> Result<&'a str> {
    p[k].as_str()
        .ok_or_else(|| anyhow!("missing string param `{k}`"))
}

/// The daemon's `react-plan`: `{ manifest, root?, since? | files? | all?, cache, options, out? }`.
pub fn serve_plan(p: &Value) -> Result<Value> {
    let files = p["files"].as_array().map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect()
    });
    let o = PlanOpts {
        manifest: param(p, "manifest")?.into(),
        root: p["root"].as_str().unwrap_or(".").into(),
        select: select(
            p["since"].as_str().map(String::from),
            files,
            p["all"] == true,
        )?,
        cache: param(p, "cache")?.into(),
        options: p["options"].clone(),
    };
    plan_answer(plan::plan(&o)?, p["out"].as_str().map(Path::new))
}

/// The daemon's `react-diff`: `{ plan, results, cache, out, readOnly? }` (paths).
pub fn serve_diff(p: &Value) -> Result<Value> {
    diff_answer(
        Path::new(param(p, "plan")?),
        Path::new(param(p, "results")?),
        Path::new(param(p, "cache")?),
        Path::new(param(p, "out")?),
        p["readOnly"] == true,
    )
}
