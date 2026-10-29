//! The render commands: `capture` / `compare` on one PNG, the `check` / `baseline` batch, and
//! `diff`, `affected`, `report`, `trim`, `detail-sweep`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use pxsig_core::PixelDiff;

use crate::batch::{BaselineOpts, CheckOpts};
use crate::gate::GateArgs;
use crate::{affected, batch, gate, io, report, sweep, BatchArgs};

// --- capture / compare (drop-in) ----------------------------------------------------

pub(super) fn cmd_capture(
    png: &Path,
    out: Option<PathBuf>,
    grid: usize,
    detail: bool,
) -> Result<u8> {
    let grid = grid.clamp(8, 256);
    let out = out.unwrap_or_else(|| io::default_sig_path(png));
    let r = batch::capture_png(png, &out, grid, detail, None, None)?;
    let bytes = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    println!(
        "[pxsig] wrote {}  ({grid}×{grid} RGB, {:.1} KB)",
        out.display(),
        bytes as f64 / 1024.0
    );
    println!(
        "        ahash={} dhash={} sha256={}…",
        r.ahash,
        r.dhash,
        &r.sha256[..12]
    );
    Ok(0)
}

pub(super) fn cmd_compare(
    png: &Path,
    sig: &Path,
    out_dir: Option<PathBuf>,
    as_json: bool,
    args: &GateArgs,
) -> Result<u8> {
    if !png.is_file() {
        bail!("PNG not found: {}", png.display());
    }
    let gate = gate::resolve(None, &gate::env_spec(), &args.spec(), None);
    let b = batch::load_baseline(sig)?;
    let r = batch::compare_png(png, &b, &gate)?;
    let out_dir = out_dir.unwrap_or_else(|| {
        png.canonicalize()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_default()
    });
    let metrics = batch::metrics_json(&r, gate.threshold);
    let stem = io::stem_of(sig);
    let (diff_html, diff_png) = io::write_diff_artifacts(&out_dir, &stem, &r, &metrics)?;

    if as_json {
        let mut out = json!({
            "pass": r.pass,
            "metrics": metrics,
            "reasons": r.reasons,
            "artifacts": { "diffHtml": diff_html, "diffPng": diff_png },
        });
        if r.detail.is_some() {
            out["detail"] = batch::detail_json(&r);
        }
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        println!(
            "[pxsig] compare {} vs {}",
            io::file_name(png),
            io::file_name(sig)
        );
        for (k, v) in metrics.as_object().unwrap() {
            println!("  {k:<16} {v}");
        }
        if let Some(d) = &r.detail {
            println!(
                "  {:<16} {} kept · {} new edges · max Δ {}",
                "detail", d.changed_tiles, d.new_edge_tiles, d.max_block_delta
            );
        }
        println!(
            "        wrote {stem}.diff.html + {stem}.diff.png in {}",
            out_dir.display()
        );
    }
    if !r.pass {
        eprintln!("[pxsig] FAIL: {}", r.reasons.join("; "));
        return Ok(1);
    }
    if !as_json {
        println!("[pxsig] PASS");
    }
    Ok(0)
}

// --- batch ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub(super) fn cmd_check(
    b: BatchArgs,
    out_dir: Option<PathBuf>,
    format: &str,
    artifacts: batch::Artifacts,
    cache: Option<PathBuf>,
    history: Option<PathBuf>,
    enforcement: Option<String>,
    base_png_dir: Option<PathBuf>,
    tolerance: u8,
    gate: &GateArgs,
) -> Result<u8> {
    let out_dir = out_dir.unwrap_or_else(|| PathBuf::from("pxsig-diff"));
    let res = batch::check(&CheckOpts {
        manifest: b.manifest,
        png_dir: b.png_dir,
        root: b.root.unwrap_or_else(|| PathBuf::from(".")),
        out_dir: Some(out_dir.clone()),
        artifacts,
        only: batch::parse_only(b.only.as_deref())?,
        cache,
        history,
        enforcement: batch::parse_enforcement(enforcement.as_deref())?,
        base_png_dir,
        tolerance,
        cli_gate: gate.spec(),
        env_gate: gate::env_spec(),
    })?;
    let failed = res["summary"]["failed"].as_u64().unwrap_or(0);
    match format {
        "json" => println!("{}", serde_json::to_string_pretty(&res)?),
        "junit" => print!("{}", report::junit(&res)),
        "markdown" => print!("{}", report::markdown(&res, None)),
        _ => {
            for r in res["results"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| r["pass"] != json!(true))
            {
                println!(
                    "  FAIL {:<56} {}",
                    r["id"].as_str().unwrap_or(""),
                    r["note"].as_str().unwrap_or("")
                );
            }
            let s = &res["summary"];
            println!(
                "[pxsig] check — {} entries, {failed} failed, {} cached  ({:.1} ms on {} threads)",
                s["stories"],
                s["cached"],
                s["elapsedMs"].as_f64().unwrap_or(0.0),
                s["threads"]
            );
            if artifacts != batch::Artifacts::None {
                println!("[pxsig] gallery: {}", out_dir.join("index.html").display());
            }
        }
    }
    Ok(if failed > 0 { 1 } else { 0 })
}

pub(super) fn cmd_baseline(
    b: BatchArgs,
    no_detail: bool,
    env: Option<String>,
    as_json: bool,
) -> Result<u8> {
    let res = batch::baseline(&BaselineOpts {
        manifest: b.manifest,
        png_dir: b.png_dir,
        root: b.root.unwrap_or_else(|| PathBuf::from(".")),
        only: batch::parse_only(b.only.as_deref())?,
        no_detail,
        env: batch::parse_env_plan(env.as_deref())?,
    })?;
    let failed = res["summary"]["failed"].as_u64().unwrap_or(0);
    if as_json {
        println!("{}", serde_json::to_string_pretty(&res)?);
    } else {
        for e in res["errors"].as_array().into_iter().flatten() {
            eprintln!("  FAIL {}", e.as_str().unwrap_or(""));
        }
        let s = &res["summary"];
        println!(
            "[pxsig] baseline — {} entries, {failed} failed  ({:.1} ms on {} threads)",
            s["stories"],
            s["elapsedMs"].as_f64().unwrap_or(0.0),
            s["threads"]
        );
    }
    Ok(if failed == 0 { 0 } else { 2 })
}

// --- diff / affected / report / sweep ---------------------------------------------------

pub fn diff_json(d: &PixelDiff) -> Value {
    json!({
        "width": d.width,
        "height": d.height,
        "changed": d.changed,
        "changedPct": if d.width * d.height > 0 { d.changed as f64 * 100.0 / (d.width * d.height) as f64 } else { 0.0 },
        "maxDelta": d.max_delta,
        "regions": d.regions.iter().map(|r| json!({"x": r.x, "y": r.y, "w": r.w, "h": r.h, "px": r.px})).collect::<Vec<_>>(),
    })
}

pub(super) fn cmd_diff(
    a: &Path,
    b: &Path,
    tolerance: u8,
    mask: Option<PathBuf>,
    as_json: bool,
) -> Result<u8> {
    let (da, aw, ah) = io::decode_png(a)?;
    let (db, bw, bh) = io::decode_png(b)?;
    let d = pxsig_core::pixel_diff(&da, aw, ah, &db, bw, bh, tolerance);
    if let Some(m) = &mask {
        io::write_mask(m, &d)?;
    }
    if as_json {
        println!("{}", serde_json::to_string_pretty(&diff_json(&d))?);
    } else {
        println!(
            "[pxsig] diff {}×{} · {} px changed (Δ > {tolerance}) · max Δ {} · {} regions",
            d.width,
            d.height,
            d.changed,
            d.max_delta,
            d.regions.len()
        );
        for r in d.regions.iter().take(10) {
            println!("  {}×{} @ {},{}  ({} px)", r.w, r.h, r.x, r.y, r.px);
        }
    }
    Ok(if d.changed > 0 { 1 } else { 0 })
}

pub(super) fn cmd_affected(
    manifest: &Path,
    root: Option<PathBuf>,
    since: &str,
    files: Option<String>,
    as_json: bool,
) -> Result<u8> {
    let root = root.unwrap_or_else(|| PathBuf::from("."));
    let m = batch::load_manifest(manifest)?;
    let ch = match files {
        Some(f) => {
            affected::changes_from_files(&root, &f.split(',').map(String::from).collect::<Vec<_>>())
        }
        None => affected::changes_since(&root, since)?,
    };
    let res = affected::affected(&root, &m, &ch)?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&res)?);
    } else {
        println!(
            "[pxsig] affected — {} changed files → {} of {} entries ({})",
            ch.files.len(),
            res["ids"].as_array().map_or(0, Vec::len),
            m.stories.len(),
            res["reason"].as_str().unwrap_or("")
        );
        // Every fail-safe path: each one is a candidate for `affects.ignore` (or a gap to report).
        let fs = res["failSafe"].as_array().cloned().unwrap_or_default();
        for f in fs.iter().take(10) {
            println!(
                "  all: {} ({})",
                f["why"].as_str().unwrap_or(""),
                f["class"].as_str().unwrap_or("")
            );
        }
        if fs.len() > 10 {
            println!("  … {} more in --json", fs.len() - 10);
        }
    }
    Ok(0)
}

pub(super) fn cmd_report(
    input: &Path,
    format: &str,
    link_base: Option<&str>,
    out: Option<PathBuf>,
) -> Result<u8> {
    let v: Value = serde_json::from_str(
        &std::fs::read_to_string(input).with_context(|| format!("reading {}", input.display()))?,
    )?;
    let text = match format {
        "markdown" | "md" => report::markdown(&v, link_base),
        "junit" | "xml" => report::junit(&v),
        other => bail!("unknown report format `{other}` (markdown | junit)"),
    };
    match out {
        Some(p) => std::fs::write(&p, text).with_context(|| format!("writing {}", p.display()))?,
        None => print!("{text}"),
    }
    Ok(0)
}

pub(super) fn cmd_trim(
    dir: &Path,
    only: Option<&str>,
    pad: usize,
    tolerance: u8,
    as_json: bool,
) -> Result<u8> {
    let res = batch::trim(&batch::TrimOpts {
        dir: dir.to_path_buf(),
        only: batch::parse_only(only)?,
        pad,
        tolerance,
    })?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&res)?);
    } else {
        let (b, a) = (
            res["pixelsBefore"].as_f64().unwrap_or(0.0),
            res["pixelsAfter"].as_f64().unwrap_or(0.0),
        );
        println!(
            "[pxsig] trim — {} of {} renders cropped · {:.0}% of the pixels kept ({:.1} ms)",
            res["trimmed"],
            res["files"],
            if b > 0.0 { a * 100.0 / b } else { 100.0 },
            res["elapsedMs"].as_f64().unwrap_or(0.0)
        );
    }
    Ok(0)
}

pub(super) fn cmd_sweep(input: &Path) -> Result<u8> {
    let inp: sweep::SweepInput =
        serde_json::from_str(&std::fs::read_to_string(input)?).context("sweep input")?;
    println!("{}", serde_json::to_string(&sweep::run(&inp)?)?);
    Ok(0)
}
