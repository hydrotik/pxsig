//! Gate resolution, last layer wins:
//!
//!   built-in defaults < manifest `gate` (the project config) < `PXSIG_*` environment
//!   < explicit CLI flags < the story's own `parameters.pxsig.gate`
//!
//! A story's gate is written next to the story it judges, so nothing run-wide (a flag, an
//! environment variable) overrides it. The manifest carries it per entry (`pxsig manifest` reads
//! it from the CSF file), so CI, the dashboard and the Storybook addon all apply the same rule.

use clap::Args;
use serde::{Deserialize, Serialize};

use pxsig_core::{DetailGate, GateThresholds};

/// The JSON gate shape used in manifests (`gate`) and `parameters.pxsig.gate`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GateSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_ssim: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_changed_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_edge_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_cells: Option<usize>,
    /// `false` turns the detail channel off; an object tunes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<DetailSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DetailSpec {
    Enabled(bool),
    Tuned(DetailTune),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailTune {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_delta: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_delta: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_tiles: Option<usize>,
}

impl GateSpec {
    /// Layer `self` over `base` (fields set here win).
    pub fn over(&self, base: &GateThresholds) -> GateThresholds {
        let mut g = base.clone();
        if let Some(v) = self.threshold {
            g.threshold = v;
        }
        if let Some(v) = self.min_ssim {
            g.min_ssim = v;
        }
        if let Some(v) = self.max_changed_pct {
            g.max_changed_pct = v;
        }
        if let Some(v) = self.max_edge_pct {
            g.max_edge_pct = v;
        }
        if let Some(v) = self.min_cells {
            g.min_cells = v;
        }
        match &self.detail {
            Some(DetailSpec::Enabled(false)) => g.detail = None,
            Some(DetailSpec::Enabled(true)) => g.detail = Some(g.detail.unwrap_or_default()),
            Some(DetailSpec::Tuned(t)) => {
                let mut d = g.detail.unwrap_or_default();
                if let Some(v) = t.block_delta {
                    d.block_delta = v;
                }
                if let Some(v) = t.energy_delta {
                    d.energy_delta = v;
                }
                if let Some(v) = t.min_tiles {
                    d.min_tiles = v;
                }
                g.detail = Some(d);
            }
            None => {}
        }
        g
    }
}

/// The built-in gate: today's v1 rule plus the detail channel (used only when a
/// baseline carries detail).
pub fn builtin() -> GateThresholds {
    GateThresholds { detail: Some(DetailGate::default()), ..GateThresholds::default() }
}

/// Explicit CLI gate flags. Every field is optional so an unset flag never
/// overrides a manifest gate. The `PXSIG_*` gate variables are read separately
/// ([`env_spec`]) because they sit one layer below the flags.
#[derive(Args, Debug, Clone, Default)]
pub struct GateArgs {
    #[arg(long)]
    pub threshold: Option<f64>,
    #[arg(long)]
    pub min_ssim: Option<f64>,
    #[arg(long)]
    pub max_changed_pct: Option<f64>,
    /// Sobel edge gate (off unless set).
    #[arg(long)]
    pub max_edge_pct: Option<f64>,
    /// Fail when at least N cells are off by more than --threshold.
    #[arg(long)]
    pub min_cells: Option<usize>,
    /// Ignore the detail channel even when the baseline has one.
    #[arg(long)]
    pub no_detail: bool,
}

impl GateArgs {
    pub fn spec(&self) -> GateSpec {
        GateSpec {
            threshold: self.threshold,
            min_ssim: self.min_ssim,
            max_changed_pct: self.max_changed_pct,
            max_edge_pct: self.max_edge_pct,
            min_cells: self.min_cells,
            detail: if self.no_detail { Some(DetailSpec::Enabled(false)) } else { None },
        }
    }
}

/// The gate layer from `PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`, `PXSIG_MAX_CHANGED_PCT`,
/// `PXSIG_MAX_EDGE_PCT` and `PXSIG_MIN_CELLS` (unset or unparsable variables are ignored).
pub fn env_spec() -> GateSpec {
    env_spec_from(|k| std::env::var(k).ok())
}

/// [`env_spec`] over any lookup (tests pass a map instead of the process environment).
pub fn env_spec_from(get: impl Fn(&str) -> Option<String>) -> GateSpec {
    let f = |k: &str| get(k).and_then(|v| v.trim().parse::<f64>().ok());
    GateSpec {
        threshold: f("PXSIG_THRESHOLD"),
        min_ssim: f("PXSIG_MIN_SSIM"),
        max_changed_pct: f("PXSIG_MAX_CHANGED_PCT"),
        max_edge_pct: f("PXSIG_MAX_EDGE_PCT"),
        min_cells: get("PXSIG_MIN_CELLS").and_then(|v| v.trim().parse::<usize>().ok()),
        detail: None,
    }
}

/// Resolve the gate for one story: defaults < manifest < env < CLI < story.
pub fn resolve(manifest: Option<&GateSpec>, env: &GateSpec, cli: &GateSpec, story: Option<&GateSpec>) -> GateThresholds {
    let mut g = builtin();
    for layer in [manifest, Some(env), Some(cli), story].into_iter().flatten() {
        g = layer.over(&g);
    }
    g
}

/// The resolved gate as JSON (recorded per row so a verdict can be explained).
pub fn to_json(g: &GateThresholds) -> serde_json::Value {
    serde_json::json!({
        "threshold": g.threshold,
        "minSsim": g.min_ssim,
        "maxChangedPct": g.max_changed_pct,
        "maxEdgePct": if g.max_edge_pct.is_finite() { serde_json::json!(g.max_edge_pct) } else { serde_json::Value::Null },
        "minCells": g.min_cells,
        "detail": g.detail.map(|d| serde_json::json!({
            "blockDelta": d.block_delta, "energyDelta": d.energy_delta, "minTiles": d.min_tiles
        })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn story_beats_cli_beats_env_beats_manifest() {
        let m = GateSpec { threshold: Some(32.0), min_cells: Some(2), max_changed_pct: Some(5.0), min_ssim: Some(0.9), ..Default::default() };
        let env = env_spec_from(|k| match k {
            "PXSIG_MIN_CELLS" => Some("7".into()),
            "PXSIG_MIN_SSIM" => Some("0.95".into()),
            "PXSIG_MAX_CHANGED_PCT" => Some("4".into()),
            _ => None,
        });
        let cli = GateSpec { min_cells: Some(9), min_ssim: Some(0.97), ..Default::default() };
        let s = GateSpec { threshold: Some(24.0), min_cells: Some(3), ..Default::default() };
        let g = resolve(Some(&m), &env, &cli, Some(&s));
        // story: threshold + minCells · CLI: minSsim · env: maxChangedPct
        assert_eq!((g.threshold, g.min_cells, g.min_ssim, g.max_changed_pct), (24.0, 3, 0.97, 4.0));
        // without a story gate, the CLI flag beats the environment, which beats the manifest
        let g = resolve(Some(&m), &env, &cli, None);
        assert_eq!((g.threshold, g.min_cells, g.min_ssim), (32.0, 9, 0.97));
        let g = resolve(Some(&m), &env, &GateSpec::default(), None);
        assert_eq!((g.min_cells, g.min_ssim), (7, 0.95));
    }

    #[test]
    fn env_ignores_unparsable_values() {
        let e = env_spec_from(|k| (k == "PXSIG_THRESHOLD").then(|| "lots".to_string()));
        assert_eq!(e, GateSpec::default());
    }

    #[test]
    fn detail_false_turns_it_off() {
        let s: GateSpec = serde_json::from_str(r#"{"detail": false}"#).unwrap();
        let none = GateSpec::default();
        assert!(resolve(None, &none, &none, Some(&s)).detail.is_none());
        let t: GateSpec = serde_json::from_str(r#"{"detail": {"minTiles": 5}}"#).unwrap();
        assert_eq!(resolve(None, &none, &none, Some(&t)).detail.unwrap().min_tiles, 5);
    }
}
