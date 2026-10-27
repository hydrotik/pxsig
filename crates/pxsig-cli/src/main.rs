//! `pxsig` — native CLI over `pxsig-core`.
//!
//! `capture` / `compare` work on one PNG and one baseline (`.psig`, or a spec v1 `.pxsig.json`).
//! The batch and tooling commands:
//!
//! - `check` / `baseline` — batch over a manifest on a Rayon pool, with per-story
//!   gates and grids, the detail channel, a content cache and run history;
//! - `diff` — full-resolution pixel diff + change regions between two renders;
//! - `affected` — which entries a change can touch (import graph from git);
//! - `report` — Markdown (PR comment) / JUnit from a check result;
//! - `pack` / `cat` / `attach` — build `.psig` baselines from spec v1 records, print a header
//!   (git's textconv), add a baseline image without touching the signature;
//! - `serve` — the engine as a stdio JSON-RPC daemon;
//! - `detail-sweep` — raw material for calibrating the detail channel.
//!
//! Exit codes: 0 pass · 1 visual regression · 2 usage / IO / validation.

mod affected;
mod batch;
mod gate;
mod io;
mod report;
mod resolve;
mod serve;
mod sweep;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};

use pxsig_core::PixelDiff;

use crate::batch::{BaselineOpts, CheckOpts};
use crate::gate::GateArgs;

#[derive(Parser)]
#[command(
    name = "pxsig",
    version,
    about = "Pixel-fingerprint visual regression (spec v1)"
)]
struct Cli {
    /// Rayon worker count for batch commands (default: logical CPUs).
    #[arg(short = 'j', long, global = true, env = "PXSIG_THREADS")]
    threads: Option<usize>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Write a baseline signature from one rendered PNG.
    Capture {
        png: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long, default_value_t = 64, env = "PXSIG_GRID")]
        grid: usize,
        /// Also store the detail channel (off by default: keeps the record plain spec v1).
        #[arg(long)]
        detail: bool,
    },
    /// Diff one rendered PNG against a committed signature.
    Compare {
        png: PathBuf,
        sig: PathBuf,
        #[arg(long)]
        out_dir: Option<PathBuf>,
        #[arg(long)]
        json: bool,
        #[command(flatten)]
        gate: GateArgs,
    },
    /// Batch diff: every manifest entry's `<png-dir>/<id>.png` against its baseline.
    Check {
        #[command(flatten)]
        batch: BatchArgs,
        #[arg(long)]
        out_dir: Option<PathBuf>,
        #[arg(long)]
        json: bool,
        /// human (default) · json · junit · markdown
        #[arg(long)]
        format: Option<String>,
        /// Skip the diff PNGs + html entirely (same as --artifacts none).
        #[arg(long)]
        no_artifacts: bool,
        /// Diff artifacts for: all · failed (default) · none.
        #[arg(long, default_value = "failed")]
        artifacts: String,
        /// Content cache directory: unchanged render + baseline + gate → reuse the result.
        #[arg(long)]
        cache: Option<PathBuf>,
        /// Append this run to an ndjson history file.
        #[arg(long)]
        history: Option<PathBuf>,
        /// Warn mode for the history line: `@file` (or inline JSON) `{ "gates": {…}, "a11yNew": n }`.
        #[arg(long)]
        enforcement: Option<String>,
        /// Base renders; failing entries also get a pixel diff with change regions.
        #[arg(long)]
        base_png_dir: Option<PathBuf>,
        #[arg(long, default_value_t = 16)]
        tolerance: u8,
        #[command(flatten)]
        gate: GateArgs,
    },
    /// Batch capture: write a baseline for every manifest entry from `<png-dir>/<id>.png`.
    Baseline {
        #[command(flatten)]
        batch: BatchArgs,
        /// Leave the detail channel out of the records.
        #[arg(long)]
        no_detail: bool,
        /// The environment each render was made in, written into its `.psig` header as `env`:
        /// `@file` (or inline JSON) holding `{ "envs": { <envId>: env }, "byId": { <entryId>: <envId> } }`.
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Pixel diff two renders: changed pixels, change regions, optional mask PNG.
    Diff {
        a: PathBuf,
        b: PathBuf,
        #[arg(long, default_value_t = 16)]
        tolerance: u8,
        #[arg(long)]
        mask: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Entries a change can affect (import graph over the manifest's srcRoot).
    Affected {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long, env = "PXSIG_ROOT")]
        root: Option<PathBuf>,
        /// Git ref to diff against (merge-base with HEAD), plus uncommitted work.
        #[arg(long, default_value = "main")]
        since: String,
        /// Explicit changed files (workspace-relative, absolute or `$repo/…`, comma-separated) instead of git.
        #[arg(long)]
        files: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Render a check result as Markdown or JUnit.
    Report {
        #[arg(long)]
        input: PathBuf,
        /// markdown · junit
        #[arg(long, default_value = "markdown")]
        format: String,
        /// Dashboard URL; story names link to `<link-base>#inspect=<id>`.
        #[arg(long)]
        link_base: Option<String>,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Crop renders to their content (right/bottom only, origin kept), in place.
    Trim {
        dir: PathBuf,
        #[arg(long)]
        only: Option<String>,
        #[arg(long, default_value_t = 16)]
        pad: usize,
        #[arg(long, default_value_t = 8)]
        tolerance: u8,
        #[arg(long)]
        json: bool,
    },
    /// Print a baseline's header (a `.psig` header, or a `.pxsig.json` without its signature
    /// bytes); `--image` writes a `.psig`'s baseline image. Git's textconv for `*.psig`.
    Cat {
        file: PathBuf,
        #[arg(long)]
        image: Option<PathBuf>,
    },
    /// Pack spec v1 records (+ their images) into `.psig` files, byte for byte.
    /// `pack <sig.pxsig.json> --out x.psig [--image base.png] [--entry '{json}']`, or
    /// `pack --plan plan.json` with `[{ sig, out, image?, entry? }]` (parallel).
    Pack {
        sig: Option<PathBuf>,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long)]
        image: Option<PathBuf>,
        #[arg(long)]
        entry: Option<String>,
        #[arg(long)]
        plan: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Add a baseline image to a `.psig` that has none. The record and signature bytes stay
    /// exactly as they were; a `.psig` that already has an image is refused (never overwritten).
    /// Callers prove the render passes the gate first (`doctor --repair` does).
    Attach {
        psig: PathBuf,
        png: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Long-lived engine: JSON requests on stdin, one JSON response per line.
    Serve,
    /// Detail-channel calibration data over base/current render pairs.
    DetailSweep {
        #[arg(long)]
        input: PathBuf,
    },
}

#[derive(Args)]
struct BatchArgs {
    /// Run manifest: the entries plus the resolved settings (`<store>/reports/.run/manifest.json`).
    #[arg(long)]
    manifest: PathBuf,
    /// Directory holding `<id>.png` renders.
    #[arg(long)]
    png_dir: PathBuf,
    /// Root that the manifest's `sig` paths are relative to (default: cwd).
    #[arg(long, env = "PXSIG_ROOT")]
    root: Option<PathBuf>,
    /// Only these entries: `a,b` or `@file` (lines or a JSON array).
    #[arg(long)]
    only: Option<String>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    if let Some(n) = cli.threads {
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .build_global();
    }
    let res = match cli.cmd {
        Cmd::Capture {
            png,
            out,
            grid,
            detail,
        } => cmd_capture(&png, out, grid, detail),
        Cmd::Compare {
            png,
            sig,
            out_dir,
            json,
            gate,
        } => cmd_compare(&png, &sig, out_dir, json, &gate),
        Cmd::Check {
            batch,
            out_dir,
            json,
            format,
            no_artifacts,
            artifacts,
            cache,
            history,
            enforcement,
            base_png_dir,
            tolerance,
            gate,
        } => {
            let format =
                format.unwrap_or_else(|| if json { "json".into() } else { "human".into() });
            let artifacts = if no_artifacts {
                Ok(batch::Artifacts::None)
            } else {
                batch::Artifacts::parse(&artifacts)
            };
            artifacts.and_then(|a| {
                cmd_check(
                    batch,
                    out_dir,
                    &format,
                    a,
                    cache,
                    history,
                    enforcement,
                    base_png_dir,
                    tolerance,
                    &gate,
                )
            })
        }
        Cmd::Trim {
            dir,
            only,
            pad,
            tolerance,
            json,
        } => cmd_trim(&dir, only.as_deref(), pad, tolerance, json),
        Cmd::Baseline {
            batch,
            no_detail,
            env,
            json,
        } => cmd_baseline(batch, no_detail, env, json),
        Cmd::Diff {
            a,
            b,
            tolerance,
            mask,
            json,
        } => cmd_diff(&a, &b, tolerance, mask, json),
        Cmd::Affected {
            manifest,
            root,
            since,
            files,
            json,
        } => cmd_affected(&manifest, root, &since, files, json),
        Cmd::Report {
            input,
            format,
            link_base,
            out,
        } => cmd_report(&input, &format, link_base.as_deref(), out),
        Cmd::Cat { file, image } => cmd_cat(&file, image),
        Cmd::Pack {
            sig,
            out,
            image,
            entry,
            plan,
            json,
        } => cmd_pack(sig, out, image, entry, plan, json),
        Cmd::Attach { psig, png, json } => cmd_attach(&psig, &png, json),
        Cmd::Serve => serve::run(),
        Cmd::DetailSweep { input } => cmd_sweep(&input),
    };
    match res {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            eprintln!("[pxsig] {e:#}");
            ExitCode::from(2)
        }
    }
}

// --- .psig: cat / pack -----------------------------------------------------------

fn cmd_cat(file: &Path, image: Option<PathBuf>) -> Result<u8> {
    let bytes = std::fs::read(file).with_context(|| format!("reading {}", file.display()))?;
    let header = if pxsig_core::psig::is_psig(&bytes) {
        let p = pxsig_core::psig::decode(&bytes)
            .map_err(|e| anyhow::anyhow!("{}: {e}", file.display()))?;
        if let Some(out) = image {
            let img = p
                .image
                .as_ref()
                .with_context(|| format!("{} has no baseline image", file.display()))?;
            std::fs::write(&out, img).with_context(|| format!("writing {}", out.display()))?;
        }
        p.header
    } else {
        if image.is_some() {
            bail!(
                "{} is a .pxsig.json: it has no baseline image",
                file.display()
            );
        }
        let mut v: Value = serde_json::from_slice(&bytes)
            .with_context(|| format!("{} is not a baseline", file.display()))?;
        if let Value::Object(o) = &mut v {
            o.remove("sig");
        }
        v
    };
    println!("{}", serde_json::to_string_pretty(&header)?);
    Ok(0)
}

#[derive(serde::Deserialize)]
struct PackItem {
    sig: PathBuf,
    out: PathBuf,
    #[serde(default)]
    image: Option<PathBuf>,
    #[serde(default)]
    entry: Option<Value>,
}

fn pack_one(it: &PackItem) -> Result<Value> {
    let raw = std::fs::read(&it.sig).with_context(|| format!("reading {}", it.sig.display()))?;
    let record: pxsig_core::PxsigRecord = serde_json::from_slice(&raw)
        .with_context(|| format!("{} is not a spec v1 record", it.sig.display()))?;
    let image = match &it.image {
        Some(p) => Some(std::fs::read(p).with_context(|| format!("reading {}", p.display()))?),
        None => None,
    };
    io::write_baseline(&it.out, &record, image.as_deref(), it.entry.as_ref(), None)?;
    // Read it back: the packed record and image must equal their sources exactly.
    let back =
        pxsig_core::psig::decode(&std::fs::read(&it.out)?).map_err(|e| anyhow::anyhow!(e))?;
    if serde_json::to_string(&back.record)? != serde_json::to_string(&record)?
        || back.image != image
    {
        bail!("{}: read-back differs from its sources", it.out.display());
    }
    Ok(
        json!({ "out": it.out, "bytes": std::fs::metadata(&it.out)?.len(), "image": image.is_some() }),
    )
}

fn cmd_pack(
    sig: Option<PathBuf>,
    out: Option<PathBuf>,
    image: Option<PathBuf>,
    entry: Option<String>,
    plan: Option<PathBuf>,
    as_json: bool,
) -> Result<u8> {
    use rayon::prelude::*;
    let items: Vec<PackItem> = match (plan, sig) {
        (Some(p), None) => serde_json::from_slice(
            &std::fs::read(&p).with_context(|| format!("reading {}", p.display()))?,
        )?,
        (None, Some(sig)) => {
            let out = out.context("--out is required")?;
            let entry = entry
                .map(|e| serde_json::from_str(&e))
                .transpose()
                .context("--entry is not JSON")?;
            vec![PackItem {
                sig,
                out,
                image,
                entry,
            }]
        }
        _ => bail!("give a record and --out, or --plan"),
    };
    let t0 = std::time::Instant::now();
    let res: Vec<(usize, Result<Value>)> = items
        .par_iter()
        .enumerate()
        .map(|(i, it)| (i, pack_one(it)))
        .collect();
    let errors: Vec<String> = res
        .iter()
        .filter_map(|(i, r)| {
            r.as_ref()
                .err()
                .map(|e| format!("{}: {e:#}", items[*i].sig.display()))
        })
        .collect();
    let bytes: u64 = res
        .iter()
        .filter_map(|(_, r)| r.as_ref().ok())
        .map(|v| v["bytes"].as_u64().unwrap_or(0))
        .sum();
    let summary = json!({ "packed": items.len() - errors.len(), "failed": errors.len(), "bytes": bytes, "elapsedMs": t0.elapsed().as_secs_f64() * 1000.0 });
    if as_json {
        println!("{}", json!({ "summary": summary, "errors": errors }));
    } else {
        println!(
            "[pxsig] packed {} of {} ({} bytes)",
            items.len() - errors.len(),
            items.len(),
            bytes
        );
        for e in &errors {
            eprintln!("  {e}");
        }
    }
    Ok(if errors.is_empty() { 0 } else { 2 })
}

fn cmd_attach(psig: &Path, png: &Path, as_json: bool) -> Result<u8> {
    let p = pxsig_core::psig::decode(
        &std::fs::read(psig).with_context(|| format!("reading {}", psig.display()))?,
    )
    .map_err(|e| anyhow::anyhow!("{}: {e}", psig.display()))?;
    if p.image.is_some() {
        bail!(
            "{} already has a baseline image: refusing to replace it",
            psig.display()
        );
    }
    let img = std::fs::read(png).with_context(|| format!("reading {}", png.display()))?;
    io::decode_png_bytes(&img, png)?; // must be a readable PNG
                                      // Every top-level key this version does not own (`env`, or one a later version added) is kept.
    let extra = pxsig_core::psig::extras(&p.header);
    io::write_baseline(
        psig,
        &p.record,
        Some(&img),
        p.header.get("entry"),
        Some(&extra),
    )?;
    let back = pxsig_core::psig::decode(&std::fs::read(psig)?).map_err(|e| anyhow::anyhow!(e))?;
    if back.sig != p.sig
        || serde_json::to_string(&back.record)? != serde_json::to_string(&p.record)?
    {
        bail!("{}: signature changed on attach", psig.display());
    }
    if pxsig_core::psig::extras(&back.header) != extra {
        bail!("{}: header keys changed on attach", psig.display());
    }
    if as_json {
        println!("{}", json!({ "attached": psig, "bytes": img.len() }));
    } else {
        println!(
            "[pxsig] attached {} ({} bytes) to {}",
            png.display(),
            img.len(),
            psig.display()
        );
    }
    Ok(0)
}

// --- capture / compare (drop-in) ----------------------------------------------------

fn cmd_capture(png: &Path, out: Option<PathBuf>, grid: usize, detail: bool) -> Result<u8> {
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

fn cmd_compare(
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
fn cmd_check(
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

fn cmd_baseline(b: BatchArgs, no_detail: bool, env: Option<String>, as_json: bool) -> Result<u8> {
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

fn cmd_diff(a: &Path, b: &Path, tolerance: u8, mask: Option<PathBuf>, as_json: bool) -> Result<u8> {
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

fn cmd_affected(
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

fn cmd_report(
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

fn cmd_trim(
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

fn cmd_sweep(input: &Path) -> Result<u8> {
    let inp: sweep::SweepInput =
        serde_json::from_str(&std::fs::read_to_string(input)?).context("sweep input")?;
    println!("{}", serde_json::to_string(&sweep::run(&inp)?)?);
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attach_keeps_every_header_key_it_does_not_own() {
        let d = std::env::temp_dir().join(format!("pxsig-attach-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let png = d.join("a.png");
        let px: Vec<u8> = (0..16 * 16)
            .flat_map(|i| [(i % 251) as u8, 30, 90, 255])
            .collect();
        io::encode_png_pub(&png, 16, 16, &px).unwrap();
        // A signature-only baseline that records an environment and a key from a later version.
        let sig = d.join("a.psig");
        let mut extra = serde_json::Map::new();
        extra.insert("env".into(), json!({ "v": 1, "id": "1111222233334444" }));
        extra.insert("later".into(), json!(true));
        let rec =
            batch::capture_png(&png, &d.join("tmp.pxsig.json"), 16, false, None, None).unwrap();
        io::write_baseline(&sig, &rec, None, Some(&json!({ "id": "a" })), Some(&extra)).unwrap();
        cmd_attach(&sig, &png, true).unwrap();
        let h = pxsig_core::psig::header(&std::fs::read(&sig).unwrap()).unwrap();
        assert_eq!(h["env"]["id"], json!("1111222233334444"));
        assert_eq!(h["later"], json!(true));
        assert_eq!(h["entry"]["id"], json!("a"));
        assert!(h["sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == json!("image")));
        let _ = std::fs::remove_dir_all(&d);
    }
}
