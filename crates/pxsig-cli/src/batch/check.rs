//! `check`: compare each entry's render with its baseline, the content cache, the identical-render
//! warning and the run history.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use pxsig_core::{compare_with_detail, pixel_diff, CompareResult, GateThresholds};

use crate::gate::{self, GateSpec};
use crate::io;

use super::{env_id, load_baseline, load_manifest, Baseline, Entry, Manifest};

pub fn compare_png(png: &Path, b: &Baseline, gate: &GateThresholds) -> Result<CompareResult> {
    let (data, w, h) = io::decode_png(png)?;
    Ok(compare_rgba(&data, w, h, b, gate))
}

pub fn compare_rgba(
    data: &[u8],
    w: usize,
    h: usize,
    b: &Baseline,
    gate: &GateThresholds,
) -> CompareResult {
    let r = &b.record;
    compare_with_detail(
        &b.sig,
        &r.ahash,
        &r.dhash,
        &r.sha256,
        b.grid,
        b.detail.as_ref(),
        data,
        w,
        h,
        gate,
    )
}

/// The spec v1 `metrics` object, key for key (including `matchScore` / `threshold`).
pub fn metrics_json(r: &CompareResult, threshold: f64) -> Value {
    let m = &r.metrics;
    json!({
        "ssim": m.ssim,
        "matchScore": ((m.ssim * 100.0) * 1000.0).round() / 1000.0,
        "colorDiffPct": m.color_diff_pct,
        "edgeDiffPct": m.edge_diff_pct,
        "maxCellDiff": m.max_cell_diff,
        "changedCells": m.changed_cells,
        "changedCellsPct": m.changed_cells_pct,
        "psnr": if m.psnr.is_infinite() { json!("inf") } else { json!(m.psnr) },
        "ahashHamming": m.ahash_hamming,
        "dhashHamming": m.dhash_hamming,
        "identical": m.identical,
        "grid": m.grid,
        "threshold": threshold,
    })
}

pub fn detail_json(r: &CompareResult) -> Value {
    match &r.detail {
        Some(d) => json!({
            "changedTiles": d.changed_tiles,
            "newEdgeTiles": d.new_edge_tiles,
            "maxBlockDelta": d.max_block_delta,
            "tripped": d.tripped,
        }),
        None => Value::Null,
    }
}

/// Which entries get diff artifacts (baseline / current / heat PNGs + diff page).
/// `Failed` is the default: passing entries' artifacts are generated on demand
/// (`pxsig serve` `compare` with `outDir`), which keeps a full check from writing
/// thousands of PNGs nobody opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Artifacts {
    All,
    Failed,
    None,
}

impl Artifacts {
    pub fn parse(s: &str) -> anyhow::Result<Self> {
        Ok(match s {
            "all" => Self::All,
            "failed" => Self::Failed,
            "none" => Self::None,
            other => anyhow::bail!("--artifacts must be all | failed | none (got {other})"),
        })
    }
}

pub struct CheckOpts {
    pub manifest: PathBuf,
    pub png_dir: PathBuf,
    pub root: PathBuf,
    pub out_dir: Option<PathBuf>,
    pub artifacts: Artifacts,
    pub only: Option<HashSet<String>>,
    /// Content cache: sha256(png, baseline, gate) → result.
    pub cache: Option<PathBuf>,
    /// Append one line per run (ndjson) for history / trends.
    pub history: Option<PathBuf>,
    /// Warn mode (`--enforcement @file`, `{ gates, a11yNew }`): the history line records the gates
    /// and whether the run would have failed. Absent: the line is as before.
    pub enforcement: Option<Value>,
    /// Base renders: when set, failing entries also get a full-resolution pixel diff.
    pub base_png_dir: Option<PathBuf>,
    pub tolerance: u8,
    /// Gate flags given on the command line (above the environment, below a story's own gate).
    pub cli_gate: GateSpec,
    /// Gate values from `PXSIG_*` variables (above the manifest, below the flags).
    pub env_gate: GateSpec,
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn cache_key(png: &[u8], sig: &[u8], gate: &Value) -> String {
    let mut h = Sha256::new();
    h.update(b"pxsig-check-v3\0"); // v3: rows carry `baselineEnv`
    h.update(png);
    h.update(sig);
    h.update(gate.to_string().as_bytes());
    hex(&h.finalize())
}

fn cached_pass(dir: &Path, key: &str) -> bool {
    fs::read_to_string(dir.join(format!("{key}.json")))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .is_some_and(|v| v["pass"] == json!(true))
}

fn pixels_json(base: &[u8], cur: &Path, tolerance: u8) -> Result<Value> {
    let (a, aw, ah) = io::decode_png_bytes(base, Path::new("baseline image"))?;
    let (b, bw, bh) = io::decode_png(cur)?;
    let d = pixel_diff(&a, aw, ah, &b, bw, bh, tolerance);
    Ok(json!({
        "width": d.width, "height": d.height, "changed": d.changed, "maxDelta": d.max_delta,
        "tolerance": tolerance,
        "regions": d.regions.iter().take(20).map(|r| json!({"x": r.x, "y": r.y, "w": r.w, "h": r.h, "px": r.px})).collect::<Vec<_>>(),
        "regionCount": d.regions.len(),
    }))
}

/// Check every (selected) manifest entry. Returns `{ summary, results }`.
pub fn check(o: &CheckOpts) -> Result<Value> {
    let m = load_manifest(&o.manifest)?;
    let out_dir = o
        .out_dir
        .clone()
        .unwrap_or_else(|| PathBuf::from("pxsig-diff"));
    if o.artifacts != Artifacts::None {
        fs::create_dir_all(&out_dir)?;
    }
    if let Some(c) = &o.cache {
        fs::create_dir_all(c)?;
    }
    let t0 = Instant::now();
    let entries: Vec<&Entry> = m
        .stories
        .iter()
        .filter(|s| o.only.as_ref().is_none_or(|only| only.contains(&s.id)))
        .collect();

    let rows: Vec<Value> = entries
        .par_iter()
        .map(|s| {
            let gate = gate::resolve(m.gate.as_ref(), &o.env_gate, &o.cli_gate, s.gate.as_ref());
            let gate_json = gate::to_json(&gate);
            let png = o.png_dir.join(format!("{}.png", s.id));
            let sig = o.root.join(&s.sig);
            let base = json!({ "id": s.id, "story": s.story, "mode": s.mode, "state": s.state, "gate": gate_json });
            let fail = |note: String| {
                let mut v = base.clone();
                v["pass"] = json!(false);
                v["error"] = json!(note.clone());
                v["note"] = json!(note);
                v
            };
            if !sig.is_file() {
                return fail(format!("no baseline sig (run baseline first): {}", s.sig));
            }
            let run = || -> Result<Value> {
                let png_bytes = fs::read(&png).with_context(|| format!("PNG not found: {}", png.display()))?;
                let sig_bytes = fs::read(&sig)?;
                let render = hex(&Sha256::digest(&png_bytes));
                let key = o.cache.as_ref().map(|_| cache_key(&png_bytes, &sig_bytes, &gate_json));
                let stem = io::stem_of(&sig);
                if let (Some(c), Some(k)) = (&o.cache, &key) {
                    let hit = c.join(format!("{k}.json"));
                    // A cached failure still needs its artifacts on disk; a cached pass does not.
                    let artifacts_ok = o.artifacts == Artifacts::None || out_dir.join(format!("{stem}.diff.png")).is_file() || (o.artifacts == Artifacts::Failed && cached_pass(c, k));
                    if artifacts_ok {
                        if let Ok(v) = fs::read_to_string(&hit).map_err(anyhow::Error::from).and_then(|t| Ok(serde_json::from_str::<Value>(&t)?)) {
                            let mut v = v;
                            v["cached"] = json!(true);
                            v["render"] = json!(render);
                            return Ok(v);
                        }
                    }
                }
                let b = load_baseline(&sig)?;
                let r = compare_png(&png, &b, &gate)?;
                let metrics = metrics_json(&r, gate.threshold);
                if o.artifacts == Artifacts::All || (o.artifacts == Artifacts::Failed && !r.pass) {
                    io::write_diff_artifacts(&out_dir, &stem, &r, &metrics)?;
                }
                let mut v = base.clone();
                v["pass"] = json!(r.pass);
                v["baselineEnv"] = json!(env_id(b.env.as_ref()));
                v["metrics"] = metrics;
                v["reasons"] = json!(r.reasons);
                v["detail"] = detail_json(&r);
                v["note"] = json!(if r.pass { "pass".to_string() } else { r.reasons.join("; ") });
                if !r.pass {
                    // The baseline image: inside a `.psig`, else `<base-png-dir>/<id>.png`.
                    let base_img = b.image.clone().or_else(|| {
                        o.base_png_dir.as_ref().and_then(|bd| fs::read(bd.join(format!("{}.png", s.id))).ok())
                    });
                    if let Some(img) = base_img {
                        v["pixels"] = pixels_json(&img, &png, o.tolerance).unwrap_or(Value::Null);
                    }
                }
                if let (Some(c), Some(k)) = (&o.cache, &key) {
                    let _ = fs::write(c.join(format!("{k}.json")), v.to_string());
                }
                v["cached"] = json!(false);
                v["render"] = json!(render);
                Ok(v)
            };
            run().unwrap_or_else(|e| fail(format!("{e:#}")))
        })
        .collect();
    let mut rows = rows;
    let identical = flag_identical_renders(&mut rows);
    let baseline_envs = baseline_envs(&m, &o.root, &rows);

    let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
    let failed = rows.iter().filter(|r| r["pass"] != json!(true)).count();
    let cached = rows.iter().filter(|r| r["cached"] == json!(true)).count();
    if o.artifacts != Artifacts::None {
        let gallery: Vec<io::GalleryRow> = rows
            .iter()
            .map(|r| io::GalleryRow {
                id: r["id"].as_str().unwrap_or_default().to_string(),
                ok: r["pass"] == json!(true),
                ssim: r["metrics"]["ssim"].as_f64(),
                changed_pct: r["metrics"]["changedCellsPct"].as_f64(),
                edge_pct: r["metrics"]["edgeDiffPct"].as_f64(),
                note: r["note"].as_str().unwrap_or_default().to_string(),
            })
            .collect();
        io::write_gallery(&out_dir, &gallery)?;
    }
    let summary = json!({
        "stories": rows.len(),
        "failed": failed,
        "cached": cached,
        "threads": rayon::current_num_threads(),
        "elapsedMs": elapsed,
        "identicalRenders": identical,
    });
    if let Some(h) = &o.history {
        append_history(h, &summary, &rows, o.enforcement.as_ref())?;
    }
    Ok(json!({ "summary": summary, "results": rows, "baselineEnvs": baseline_envs }))
}

/// Every distinct baseline environment the rows name (`baselineEnv` id → the header's `env`), so a
/// caller can say which fields differ without reading every header itself. One header per id is
/// read, from the first entry that names it.
fn baseline_envs(m: &Manifest, root: &Path, rows: &[Value]) -> serde_json::Map<String, Value> {
    let sigs: std::collections::HashMap<&str, &str> = m
        .stories
        .iter()
        .map(|s| (s.id.as_str(), s.sig.as_str()))
        .collect();
    let mut out = serde_json::Map::new();
    for r in rows {
        let (Some(id), Some(entry)) = (r["baselineEnv"].as_str(), r["id"].as_str()) else {
            continue;
        };
        if out.contains_key(id) {
            continue;
        }
        let Some(sig) = sigs.get(entry) else { continue };
        let env = fs::read(root.join(sig))
            .ok()
            .and_then(|b| pxsig_core::psig::header(&b).ok())
            .and_then(|h| h.get("env").cloned());
        if let Some(e) = env.filter(|e| e["id"].as_str() == Some(id)) {
            out.insert(id.to_string(), e);
        }
    }
    out
}

/// Fewest failing entries sharing one render before it counts as the environment.
const IDENTICAL_MIN: usize = 5;

/// Failing entries whose renders are byte-identical: one image standing in for many stories is the
/// environment (an error overlay, a blank or half-loaded preview), not that many design changes.
/// Each such row becomes an error, which nothing approves. A group needs `IDENTICAL_MIN` entries
/// and a tenth of the rows checked. Returns the groups, largest first, for the summary.
pub fn flag_identical_renders(rows: &mut [Value]) -> Vec<Value> {
    let mut groups: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        if r["pass"] != json!(true) && r["error"].is_null() {
            if let Some(h) = r["render"].as_str() {
                groups.entry(h.to_string()).or_default().push(i);
            }
        }
    }
    let floor = IDENTICAL_MIN.max(rows.len().div_ceil(10));
    let mut out: Vec<(usize, Value)> = Vec::new();
    for (render, idx) in groups {
        if idx.len() < floor {
            continue;
        }
        let note = format!(
            "identical render to {} other failing entries: the environment (an error overlay, a blank preview), not a design change",
            idx.len() - 1
        );
        for &i in &idx {
            rows[i]["error"] = json!(note);
            rows[i]["note"] = json!(note);
        }
        let ids: Vec<Value> = idx
            .iter()
            .take(10)
            .map(|&i| rows[i]["id"].clone())
            .collect();
        out.push((
            idx.len(),
            json!({ "render": render, "count": idx.len(), "ids": ids }),
        ));
    }
    out.sort_by_key(|a| std::cmp::Reverse(a.0));
    out.into_iter().map(|(_, v)| v).collect()
}

fn append_history(
    path: &Path,
    summary: &Value,
    rows: &[Value],
    enforcement: Option<&Value>,
) -> Result<()> {
    if let Some(d) = path.parent() {
        fs::create_dir_all(d)?;
    }
    // Compact per-entry trail: [pass, ssim, changedCells, detail tiles].
    let per: serde_json::Map<String, Value> = rows
        .iter()
        .map(|r| {
            let tiles = r["detail"]["changedTiles"].as_u64().unwrap_or(0)
                + r["detail"]["newEdgeTiles"].as_u64().unwrap_or(0);
            (
                r["id"].as_str().unwrap_or_default().to_string(),
                json!([
                    u8::from(r["pass"] == json!(true)),
                    r["metrics"]["ssim"],
                    r["metrics"]["changedCells"],
                    tiles
                ]),
            )
        })
        .collect();
    let mut line = json!({ "at": io::iso_now(), "summary": summary, "rows": per });
    if let Some(e) = enforcement {
        let would =
            summary["failed"].as_u64().unwrap_or(0) > 0 || e["a11yNew"].as_u64().unwrap_or(0) > 0;
        line["enforcement"] = e["gates"].clone();
        line["wouldFail"] = json!(would);
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{line}")?;
    Ok(())
}
