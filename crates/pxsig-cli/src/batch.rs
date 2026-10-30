//! Batch commands over a manifest: `check` and `baseline`.
//!
//! Manifest v2 (`pxsig manifest` writes the entries; the CLI adds the run settings) expands
//! each story into one entry per mode (theme / colorway / viewport / browser)
//! and interaction state. Every entry is keyed by `id` (`<storyId>[__state][@mode]`),
//! the PNG is `<png-dir>/<id>.png`, and the entry may carry its own `grid`,
//! `gate` and `detail`. Unknown fields (story, mode, globals, viewport, ignore…)
//! are for the capture side and are ignored here.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::Value;

use pxsig_core::{Detail, PxsigRecord, SPEC_VERSION};

use crate::gate::GateSpec;

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
    /// `affects.ignore`: globs (workspace-relative, or `$repo/…`) whose change selects nothing
    /// when nothing traced claims the path.
    #[serde(default)]
    pub affects_ignore: Vec<String>,
    /// `affects.aliases`: specifier prefix → workspace-relative path, for aliases only a bundler knows.
    #[serde(default)]
    pub affects_aliases: std::collections::BTreeMap<String, String>,
    /// `affects.unresolved`: globs of files whose unresolved imports the owner accepts.
    #[serde(default)]
    pub affects_unresolved: Vec<String>,
    /// Where the store's record files are, so `affected` can select by them (absent: older callers).
    #[serde(default)]
    pub store: Option<StoreInfo>,
    pub stories: Vec<Entry>,
}

/// The run manifest's `store` key: workspace-relative paths of the store and its record files.
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoreInfo {
    pub dir: String,
    #[serde(default)]
    pub a11y: Option<String>,
    #[serde(default)]
    pub approvals: Option<String>,
    #[serde(default)]
    pub a11y_decisions: Option<String>,
    /// Suite name (`""` for the main manifest) → manifest path.
    #[serde(default)]
    pub manifests: std::collections::BTreeMap<String, String>,
    /// The suite this run manifest is for (absent: the main manifest).
    #[serde(default)]
    pub suite: Option<String>,
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
    let raw = fs::read_to_string(path)
        .with_context(|| format!("manifest not found: {}", path.display()))?;
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
        Some(file) => {
            fs::read_to_string(file).with_context(|| format!("reading --only file {file}"))?
        }
        None => spec.replace(',', "\n"),
    };
    let ids: HashSet<String> = if text.trim_start().starts_with('[') {
        serde_json::from_str::<Vec<String>>(&text)?
            .into_iter()
            .collect()
    } else {
        text.lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
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
    /// The environment the baseline was rendered in (the header's `env`), when it records one.
    pub env: Option<Value>,
}

/// The `id` of a header's `env`, when it has one.
pub fn env_id(env: Option<&Value>) -> Option<String> {
    env.and_then(|e| e["id"].as_str()).map(String::from)
}

pub fn load_baseline(sig: &Path) -> Result<Baseline> {
    if !sig.is_file() {
        bail!("baseline signature not found: {}", sig.display());
    }
    let raw = fs::read(sig).with_context(|| format!("reading {}", sig.display()))?;
    let (record, image, env) = if pxsig_core::psig::is_psig(&raw) {
        let p = pxsig_core::psig::decode(&raw).map_err(|e| anyhow!("{}: {e}", sig.display()))?;
        let env = p.header.get("env").filter(|e| e.is_object()).cloned();
        (p.record, p.image, env)
    } else {
        let r: PxsigRecord = serde_json::from_slice(&raw)
            .map_err(|e| anyhow!("baseline is not valid JSON ({}): {e}", sig.display()))?;
        (r, None, None)
    };
    if record.version != SPEC_VERSION {
        bail!(
            "spec version mismatch (baseline v{}, tool v{SPEC_VERSION})",
            record.version
        );
    }
    let (grid, base) = record.baseline().map_err(|e| anyhow!(e))?;
    let detail = match &record.detail {
        Some(d) => Some(d.decode().map_err(|e| anyhow!("{}: {e}", sig.display()))?),
        None => None,
    };
    Ok(Baseline {
        record,
        grid,
        sig: base,
        detail,
        image,
        env,
    })
}

mod baseline;
mod check;

pub use baseline::{
    baseline, capture_png, capture_png_policy, parse_enforcement, parse_env_plan, trim,
    BaselineOpts, TrimOpts,
};
pub use check::{check, compare_png, detail_json, metrics_json, Artifacts, CheckOpts};

#[cfg(test)]
mod baseline_tests;
#[cfg(test)]
mod check_tests;
#[cfg(test)]
mod tests;
