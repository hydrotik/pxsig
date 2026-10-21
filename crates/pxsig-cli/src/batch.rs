//! Batch commands over a manifest: `check` and `baseline`.
//!
//! Manifest v2 (`pxsig manifest` writes the entries; the CLI adds the run settings) expands
//! each story into one entry per mode (theme / colorway / viewport / browser)
//! and interaction state. Every entry is keyed by `id` (`<storyId>[__state][@mode]`),
//! the PNG is `<png-dir>/<id>.png`, and the entry may carry its own `grid`,
//! `gate` and `detail`. Unknown fields (story, mode, globals, viewport, ignore…)
//! are for the capture side and are ignored here.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use pxsig_core::{
    compare_with_detail, detail_of, pixel_diff, signature_of, CompareResult, Detail, DetailParams, GateThresholds,
    PxsigRecord, SPEC_VERSION,
};

use crate::gate::{self, GateSpec};
use crate::io;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default)]
    pub grid: Option<usize>,
    /// Write the detail channel into baselines (default true).
    #[serde(default)]
    pub detail: Option<bool>,
    #[serde(default)]
    pub gate: Option<GateSpec>,
    /// Adaptive grid: cells at least this many pixels, capped by `grid` (trimmed
    /// renders of small components would otherwise get pixel-sized cells).
    #[serde(default)]
    pub min_cell_px: Option<usize>,
    #[serde(default)]
    pub src_root: Option<String>,
    /// Path prefixes (repo-relative) whose change affects every story.
    #[serde(default)]
    pub affects_all: Vec<String>,
    pub stories: Vec<Entry>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub sig: String,
    #[serde(default)]
    pub story: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub grid: Option<usize>,
    #[serde(default)]
    pub gate: Option<GateSpec>,
    #[serde(default)]
    pub detail: Option<bool>,
    #[serde(default)]
    pub import_path: Option<String>,
}

pub fn load_manifest(path: &Path) -> Result<Manifest> {
    let raw = fs::read_to_string(path).with_context(|| format!("manifest not found: {}", path.display()))?;
    let m: Manifest = serde_json::from_str(&raw).context("manifest is not valid JSON")?;
    if m.stories.is_empty() {
        bail!("manifest has no stories");
    }
    Ok(m)
}

/// `--only a,b` or `--only @file` (one id per line, or a JSON array).
pub fn parse_only(spec: Option<&str>) -> Result<Option<HashSet<String>>> {
    let Some(spec) = spec else { return Ok(None) };
    let text = match spec.strip_prefix('@') {
        Some(file) => fs::read_to_string(file).with_context(|| format!("reading --only file {file}"))?,
        None => spec.replace(',', "\n"),
    };
    let ids: HashSet<String> = if text.trim_start().starts_with('[') {
        serde_json::from_str::<Vec<String>>(&text)?.into_iter().collect()
    } else {
        text.lines().map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
    };
    Ok(Some(ids))
}

pub struct Baseline {
    pub record: PxsigRecord,
    pub grid: usize,
    pub sig: Vec<u8>,
    pub detail: Option<Detail>,
    /// The baseline image, when the baseline is a `.psig` that carries one.
    pub image: Option<Vec<u8>>,
}

pub fn load_baseline(sig: &Path) -> Result<Baseline> {
    if !sig.is_file() {
        bail!("baseline signature not found: {}", sig.display());
    }
    let raw = fs::read(sig).with_context(|| format!("reading {}", sig.display()))?;
    let (record, image) = if pxsig_core::psig::is_psig(&raw) {
        let p = pxsig_core::psig::decode(&raw).map_err(|e| anyhow!("{}: {e}", sig.display()))?;
        (p.record, p.image)
    } else {
        let r: PxsigRecord =
            serde_json::from_slice(&raw).map_err(|e| anyhow!("baseline is not valid JSON ({}): {e}", sig.display()))?;
        (r, None)
    };
    if record.version != SPEC_VERSION {
        bail!("spec version mismatch (baseline v{}, tool v{SPEC_VERSION})", record.version);
    }
    let (grid, base) = record.baseline().map_err(|e| anyhow!(e))?;
    let detail = match &record.detail {
        Some(d) => Some(d.decode().map_err(|e| anyhow!("{}: {e}", sig.display()))?),
        None => None,
    };
    Ok(Baseline { record, grid, sig: base, detail, image })
}

pub fn compare_png(png: &Path, b: &Baseline, gate: &GateThresholds) -> Result<CompareResult> {
    let (data, w, h) = io::decode_png(png)?;
    Ok(compare_rgba(&data, w, h, b, gate))
}

pub fn compare_rgba(data: &[u8], w: usize, h: usize, b: &Baseline, gate: &GateThresholds) -> CompareResult {
    let r = &b.record;
    compare_with_detail(&b.sig, &r.ahash, &r.dhash, &r.sha256, b.grid, b.detail.as_ref(), data, w, h, gate)
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
    h.update(b"pxsig-check-v2\0");
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
    let out_dir = o.out_dir.clone().unwrap_or_else(|| PathBuf::from("pxsig-diff"));
    if o.artifacts != Artifacts::None {
        fs::create_dir_all(&out_dir)?;
    }
    if let Some(c) = &o.cache {
        fs::create_dir_all(c)?;
    }
    let t0 = Instant::now();
    let entries: Vec<&Entry> =
        m.stories.iter().filter(|s| o.only.as_ref().is_none_or(|only| only.contains(&s.id))).collect();

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
        append_history(h, &summary, &rows)?;
    }
    Ok(json!({ "summary": summary, "results": rows }))
}

/// Fewest failing entries sharing one render before it counts as the environment.
const IDENTICAL_MIN: usize = 5;

/// Failing entries whose renders are byte-identical: one image standing in for many stories is the
/// environment (an error overlay, a blank or half-loaded preview), not that many design changes.
/// Each such row becomes an error, which nothing approves. A group needs `IDENTICAL_MIN` entries
/// and a tenth of the rows checked. Returns the groups, largest first, for the summary.
pub fn flag_identical_renders(rows: &mut [Value]) -> Vec<Value> {
    let mut groups: std::collections::HashMap<String, Vec<usize>> = std::collections::HashMap::new();
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
        let ids: Vec<Value> = idx.iter().take(10).map(|&i| rows[i]["id"].clone()).collect();
        out.push((idx.len(), json!({ "render": render, "count": idx.len(), "ids": ids })));
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().map(|(_, v)| v).collect()
}

fn append_history(path: &Path, summary: &Value, rows: &[Value]) -> Result<()> {
    if let Some(d) = path.parent() {
        fs::create_dir_all(d)?;
    }
    // Compact per-entry trail: [pass, ssim, changedCells, detail tiles].
    let per: serde_json::Map<String, Value> = rows
        .iter()
        .map(|r| {
            let tiles = r["detail"]["changedTiles"].as_u64().unwrap_or(0) + r["detail"]["newEdgeTiles"].as_u64().unwrap_or(0);
            (
                r["id"].as_str().unwrap_or_default().to_string(),
                json!([u8::from(r["pass"] == json!(true)), r["metrics"]["ssim"], r["metrics"]["changedCells"], tiles]),
            )
        })
        .collect();
    let line = json!({ "at": io::iso_now(), "summary": summary, "rows": per });
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{line}")?;
    Ok(())
}

pub struct BaselineOpts {
    pub manifest: PathBuf,
    pub png_dir: PathBuf,
    pub root: PathBuf,
    pub only: Option<HashSet<String>>,
    pub no_detail: bool,
}

/// Write a baseline for every (selected) entry. Returns `{ summary, errors }`.
pub fn baseline(o: &BaselineOpts) -> Result<Value> {
    let m = load_manifest(&o.manifest)?;
    let t0 = Instant::now();
    let entries: Vec<&Entry> =
        m.stories.iter().filter(|s| o.only.as_ref().is_none_or(|only| only.contains(&s.id))).collect();
    let errors: Vec<String> = entries
        .par_iter()
        .filter_map(|s| {
            let max_grid = s.grid.or(m.grid).unwrap_or(64).clamp(8, 256);
            let detail = !o.no_detail && s.detail.or(m.detail).unwrap_or(true);
            let png = o.png_dir.join(format!("{}.png", s.id));
            // An explicit story grid wins; otherwise the manifest's min-cell policy applies.
            let min_cell = if s.grid.is_some() { None } else { m.min_cell_px };
            let entry = json!({ "id": s.id, "story": s.story, "mode": s.mode, "state": s.state });
            capture_png_policy(&png, &o.root.join(&s.sig), max_grid, min_cell, detail, Some(&entry)).err().map(|e| format!("{}: {e:#}", s.id))
        })
        .collect();
    Ok(json!({
        "summary": {
            "stories": entries.len(),
            "failed": errors.len(),
            "threads": rayon::current_num_threads(),
            "elapsedMs": t0.elapsed().as_secs_f64() * 1000.0,
        },
        "errors": errors,
    }))
}

/// Grid for a render under the min-cell policy: `ceil(max side / min_cell)`, within 16..=max.
pub fn grid_for(w: usize, h: usize, max_grid: usize, min_cell: Option<usize>) -> usize {
    match min_cell {
        Some(c) if c > 0 => w.max(h).div_ceil(c).clamp(16.min(max_grid), max_grid),
        _ => max_grid,
    }
}

pub fn capture_png_policy(png: &Path, out: &Path, max_grid: usize, min_cell: Option<usize>, detail: bool, entry: Option<&Value>) -> Result<PxsigRecord> {
    let (_, w, h) = io::png_size(png)?;
    capture_png(png, out, grid_for(w, h, max_grid, min_cell), detail, entry)
}

/// Build and write one baseline (optionally with the detail channel). A `.psig` output also
/// carries the render itself, byte for byte, as its baseline image.
pub fn capture_png(png: &Path, out: &Path, grid: usize, detail: bool, entry: Option<&Value>) -> Result<PxsigRecord> {
    let bytes = fs::read(png).with_context(|| format!("PNG not found: {}", png.display()))?;
    let (data, w, h) = io::decode_png_bytes(&bytes, png)?;
    let s = signature_of(&data, w, h, grid);
    let source = png.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut record = PxsigRecord::from_signature(&s, &source, &io::iso_now());
    if detail {
        record.detail = Some(detail_of(&data, w, h, DetailParams::default()).to_record());
    }
    let image = io::is_psig_path(out).then_some(bytes.as_slice());
    io::write_baseline(out, &record, image, entry)?;
    Ok(record)
}

pub struct TrimOpts {
    pub dir: PathBuf,
    pub only: Option<HashSet<String>>,
    pub pad: usize,
    pub tolerance: u8,
}

/// Crop every `<dir>/*.png` (or the `only` ids) to its content, in place, in parallel.
pub fn trim(o: &TrimOpts) -> Result<Value> {
    let t0 = Instant::now();
    let files: Vec<PathBuf> = match &o.only {
        Some(ids) => ids.iter().map(|id| o.dir.join(format!("{id}.png"))).filter(|p| p.is_file()).collect(),
        None => fs::read_dir(&o.dir)?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "png"))
            .collect(),
    };
    let stats: Vec<(usize, usize, bool)> = files
        .par_iter()
        .map(|p| -> Result<(usize, usize, bool)> {
            let (data, w, h) = io::decode_png(p)?;
            let b = pxsig_core::content_box(&data, w, h, o.tolerance, o.pad);
            if b.width == w && b.height == h {
                return Ok((w * h, w * h, false));
            }
            io::encode_png_pub(p, b.width, b.height, &pxsig_core::crop(&data, w, b))?;
            Ok((w * h, b.width * b.height, true))
        })
        .collect::<Result<_>>()?;
    let before: usize = stats.iter().map(|s| s.0).sum();
    let after: usize = stats.iter().map(|s| s.1).sum();
    Ok(json!({
        "files": stats.len(),
        "trimmed": stats.iter().filter(|s| s.2).count(),
        "pixelsBefore": before,
        "pixelsAfter": after,
        "elapsedMs": t0.elapsed().as_secs_f64() * 1000.0,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, pass: bool, render: &str) -> Value {
        json!({ "id": id, "pass": pass, "render": render, "error": null })
    }

    #[test]
    fn identical_failing_renders_become_errors() {
        let mut rows: Vec<Value> = (0..6).map(|i| row(&format!("a--{i}"), false, "same")).collect();
        rows.push(row("b--x", false, "other"));
        rows.push(row("c--y", true, "same"));
        let groups = flag_identical_renders(&mut rows);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0]["count"], json!(6));
        assert!(rows[0]["error"].as_str().unwrap().contains("5 other failing entries"));
        assert!(rows[6]["error"].is_null(), "a failure with its own render stays a change");
        assert!(rows[7]["error"].is_null(), "a passing row is never flagged");
    }

    #[test]
    fn a_few_identical_renders_are_not_the_environment() {
        let mut rows: Vec<Value> = (0..4).map(|i| row(&format!("a--{i}"), false, "same")).collect();
        assert!(flag_identical_renders(&mut rows).is_empty());
        assert!(rows.iter().all(|r| r["error"].is_null()));
    }

    #[test]
    fn the_floor_scales_with_the_run() {
        // 100 rows: a group needs 10, so 6 identical failures are left as changes.
        let mut rows: Vec<Value> = (0..100).map(|i| row(&format!("p--{i}"), true, &format!("r{i}"))).collect();
        for r in rows.iter_mut().take(6) {
            r["pass"] = json!(false);
            r["render"] = json!("same");
        }
        assert!(flag_identical_renders(&mut rows).is_empty());
        for r in rows.iter_mut().take(10) {
            r["pass"] = json!(false);
            r["render"] = json!("same");
        }
        assert_eq!(flag_identical_renders(&mut rows)[0]["count"], json!(10));
    }
}
