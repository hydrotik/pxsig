//! `baseline` and `trim`: write baselines from renders (with the environment plan, the grid
//! policy and the render's text record), and trim a render's padding.

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
    /// Entries whose baseline may be written although its masks changed (`--allow-masks`): None,
    /// no entry; `Some(None)`, every entry; else these ids.
    pub allow_masks: Option<Option<HashSet<String>>>,
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
    // Per entry: its id, why it was not written (None: written) and how its masks changed.
    let results: Vec<(&str, Option<String>, Option<Value>)> = entries
        .par_iter()
        .map(|s| {
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
            // The render's text record, when its capture wrote one, goes into the baseline.
            let boxes = super::boxes::beside(&png);
            let out = o.root.join(&s.sig);
            let changed = match masks_changed(&png, &out) {
                Ok(c) => c,
                Err(e) => return (s.id.as_str(), Some(format!("{e:#}")), None),
            };
            let allowed = o
                .allow_masks
                .as_ref()
                .is_some_and(|ids| ids.as_ref().is_none_or(|ids| ids.contains(&s.id)));
            if let (Some(ch), false) = (&changed, allowed) {
                let why = format!(
                    "masks changed ({}): not written; review the masks, then pass --allow-masks",
                    super::masks::describe(ch)
                );
                return (s.id.as_str(), Some(why), changed);
            }
            match capture_png_policy(
                &png,
                &out,
                max_grid,
                min_cell,
                detail,
                Some(&entry),
                extra.as_ref(),
                boxes.as_deref(),
            ) {
                Ok(_) => (s.id.as_str(), None, changed),
                Err(e) => (s.id.as_str(), Some(format!("{e:#}")), changed),
            }
        })
        .collect();
    let errors: Vec<String> = results
        .iter()
        .filter_map(|(id, e, _)| e.as_ref().map(|e| format!("{id}: {e}")))
        .collect();
    let failed_ids: Vec<&str> = results
        .iter()
        .filter(|r| r.1.is_some())
        .map(|r| r.0)
        .collect();
    // Every entry whose masks changed, written or not, with what changed.
    let masks: Vec<Value> = results
        .iter()
        .filter_map(|(id, e, ch)| {
            let mut c = ch.clone()?;
            c["id"] = json!(id);
            c["written"] = json!(e.is_none());
            Some(c)
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
        "failedIds": failed_ids,
        "masksChanged": masks,
    }))
}

/// How the render's masks differ from those of the baseline already at `out`, as `check` would
/// weigh them; None when they do not, or there is no baseline yet (a new entry is reviewed as new).
fn masks_changed(png: &Path, out: &Path) -> Result<Option<Value>> {
    if !out.is_file() {
        return Ok(None);
    }
    let b = super::load_baseline(out)?;
    let cur = super::masks::record(png)?;
    Ok(super::masks::changes(
        b.masks.as_ref(),
        cur.as_ref(),
        b.image.as_deref(),
    ))
}

/// Grid for a render under the min-cell policy: `ceil(max side / min_cell)`, within 16..=max.
pub fn grid_for(w: usize, h: usize, max_grid: usize, min_cell: Option<usize>) -> usize {
    match min_cell {
        Some(c) if c > 0 => w.max(h).div_ceil(c).clamp(16.min(max_grid), max_grid),
        _ => max_grid,
    }
}

/// One baseline under the grid policy. `boxes`: the render's text record, stored as the `boxes`
/// section of a `.psig` (a `.pxsig.json` has no sections and never reads it).
#[allow(clippy::too_many_arguments)]
pub fn capture_png_policy(
    png: &Path,
    out: &Path,
    max_grid: usize,
    min_cell: Option<usize>,
    detail: bool,
    entry: Option<&Value>,
    extra: Option<&serde_json::Map<String, Value>>,
    boxes: Option<&Path>,
) -> Result<PxsigRecord> {
    let (_, w, h) = io::png_size(png)?;
    let psig = io::is_psig_path(out);
    let sections = if psig {
        super::boxes::sections_for(boxes)?
    } else {
        Vec::new()
    };
    capture_png_with(
        png,
        out,
        grid_for(w, h, max_grid, min_cell),
        detail,
        entry,
        extra,
        &sections,
    )
}

/// Build and write one baseline (optionally with the detail channel). A `.psig` output also
/// carries the render itself, byte for byte, as its baseline image, and the render's masks (the
/// record beside the PNG, `masks.rs`) as its header's `masks`.
pub fn capture_png(
    png: &Path,
    out: &Path,
    grid: usize,
    detail: bool,
    entry: Option<&Value>,
    extra: Option<&serde_json::Map<String, Value>>,
) -> Result<PxsigRecord> {
    capture_png_with(png, out, grid, detail, entry, extra, &[])
}

/// [`capture_png`], with extra sections written after the image (a `.psig` only).
fn capture_png_with(
    png: &Path,
    out: &Path,
    grid: usize,
    detail: bool,
    entry: Option<&Value>,
    extra: Option<&serde_json::Map<String, Value>>,
    sections: &[pxsig_core::psig::Section],
) -> Result<PxsigRecord> {
    // The render's masks go into a `.psig` header as `masks`, none recorded as `[]`; masks no
    // approval may write stop it here, before anything is written (masks.rs).
    let mut extra = extra.cloned();
    if let Some(m) = super::masks::for_baseline(png, io::is_psig_path(out))? {
        extra
            .get_or_insert_with(Default::default)
            .insert("masks".into(), m);
    }
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
    io::write_baseline(out, &record, image, entry, extra.as_ref(), sections)?;
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
