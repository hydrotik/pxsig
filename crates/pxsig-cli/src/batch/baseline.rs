//! `baseline` and `trim`: write baselines from renders (with the environment plan and the grid
//! policy), and trim a render's padding.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};

use pxsig_core::{detail_of, signature_of, DetailParams, PxsigRecord};

use crate::io;

use super::{load_manifest, Entry};

pub struct BaselineOpts {
    pub manifest: PathBuf,
    pub png_dir: PathBuf,
    pub root: PathBuf,
    pub only: Option<HashSet<String>>,
    pub no_detail: bool,
    /// The environment each render was made in: written into its baseline's header as `env`.
    pub env: Option<EnvPlan>,
}

/// `pxsig baseline --env @file`: `{ envs: { <envId>: env }, byId: { <entryId>: <envId> } }`.
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvPlan {
    #[serde(default)]
    pub envs: serde_json::Map<String, Value>,
    #[serde(default)]
    pub by_id: std::collections::HashMap<String, String>,
}

impl EnvPlan {
    /// The header keys for one entry: `{ env }` when the plan names an environment for it.
    pub fn extra_for(&self, entry: &str) -> Option<serde_json::Map<String, Value>> {
        let env = self.by_id.get(entry).and_then(|id| self.envs.get(id))?;
        let mut m = serde_json::Map::new();
        m.insert("env".into(), env.clone());
        Some(m)
    }
}

/// Read `--enforcement @file` (or inline JSON).
pub fn parse_enforcement(spec: Option<&str>) -> Result<Option<Value>> {
    let Some(spec) = spec else { return Ok(None) };
    let text = match spec.strip_prefix('@') {
        Some(file) => fs::read_to_string(file)
            .with_context(|| format!("reading --enforcement file {file}"))?,
        None => spec.to_string(),
    };
    Ok(Some(serde_json::from_str(&text).context(
        "--enforcement is not JSON ({ gates, a11yNew })",
    )?))
}

/// Read `--env @file` (or inline JSON).
pub fn parse_env_plan(spec: Option<&str>) -> Result<Option<EnvPlan>> {
    let Some(spec) = spec else { return Ok(None) };
    let text = match spec.strip_prefix('@') {
        Some(file) => {
            fs::read_to_string(file).with_context(|| format!("reading --env file {file}"))?
        }
        None => spec.to_string(),
    };
    Ok(Some(
        serde_json::from_str(&text).context("--env is not an env plan ({ envs, byId })")?,
    ))
}

/// Write a baseline for every (selected) entry. Returns `{ summary, errors }`.
pub fn baseline(o: &BaselineOpts) -> Result<Value> {
    let m = load_manifest(&o.manifest)?;
    let t0 = Instant::now();
    let entries: Vec<&Entry> = m
        .stories
        .iter()
        .filter(|s| o.only.as_ref().is_none_or(|only| only.contains(&s.id)))
        .collect();
    let errors: Vec<String> = entries
        .par_iter()
        .filter_map(|s| {
            let max_grid = s.grid.or(m.grid).unwrap_or(64).clamp(8, 256);
            let detail = !o.no_detail && s.detail.or(m.detail).unwrap_or(true);
            let png = o.png_dir.join(format!("{}.png", s.id));
            // An explicit story grid wins; otherwise the manifest's min-cell policy applies.
            let min_cell = if s.grid.is_some() {
                None
            } else {
                m.min_cell_px
            };
            let entry = json!({ "id": s.id, "story": s.story, "mode": s.mode, "state": s.state });
            let extra = o.env.as_ref().and_then(|p| p.extra_for(&s.id));
            capture_png_policy(
                &png,
                &o.root.join(&s.sig),
                max_grid,
                min_cell,
                detail,
                Some(&entry),
                extra.as_ref(),
            )
            .err()
            .map(|e| format!("{}: {e:#}", s.id))
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

pub fn capture_png_policy(
    png: &Path,
    out: &Path,
    max_grid: usize,
    min_cell: Option<usize>,
    detail: bool,
    entry: Option<&Value>,
    extra: Option<&serde_json::Map<String, Value>>,
) -> Result<PxsigRecord> {
    let (_, w, h) = io::png_size(png)?;
    capture_png(
        png,
        out,
        grid_for(w, h, max_grid, min_cell),
        detail,
        entry,
        extra,
    )
}

/// Build and write one baseline (optionally with the detail channel). A `.psig` output also
/// carries the render itself, byte for byte, as its baseline image.
pub fn capture_png(
    png: &Path,
    out: &Path,
    grid: usize,
    detail: bool,
    entry: Option<&Value>,
    extra: Option<&serde_json::Map<String, Value>>,
) -> Result<PxsigRecord> {
    let bytes = fs::read(png).with_context(|| format!("PNG not found: {}", png.display()))?;
    let (data, w, h) = io::decode_png_bytes(&bytes, png)?;
    let s = signature_of(&data, w, h, grid);
    let source = png
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut record = PxsigRecord::from_signature(&s, &source, &io::iso_now());
    if detail {
        record.detail = Some(detail_of(&data, w, h, DetailParams::default()).to_record());
    }
    let image = io::is_psig_path(out).then_some(bytes.as_slice());
    io::write_baseline(out, &record, image, entry, extra)?;
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
        Some(ids) => ids
            .iter()
            .map(|id| o.dir.join(format!("{id}.png")))
            .filter(|p| p.is_file())
            .collect(),
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
