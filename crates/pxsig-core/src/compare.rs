//! Comparison + gating: builds the metric set + per-cell heat map and evaluates the
//! gate thresholds (docs/spec.md §3–4).

use crate::detail::{compare_detail, Detail, DetailGate, DetailMetrics};
use crate::hash::hamming;
use crate::metrics::{edge_diff_pct, ssim};
use crate::signature::{signature_of, to_gray};

#[derive(Debug, Clone)]
pub struct GateThresholds {
    pub threshold: f64,
    pub min_ssim: f64,
    pub max_changed_pct: f64,
    pub max_edge_pct: f64,
    /// Fail when at least this many cells are off by more than `threshold`
    /// (the calibrated "cells>=k@t" rule). 0 = off.
    pub min_cells: usize,
    /// Detail-channel gate; applied only when the baseline carries a detail signature.
    pub detail: Option<DetailGate>,
}

impl Default for GateThresholds {
    fn default() -> Self {
        Self {
            threshold: 12.0,
            min_ssim: 0.99,
            max_changed_pct: 2.0,
            max_edge_pct: f64::INFINITY,
            min_cells: 0,
            detail: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Metrics {
    pub ssim: f64,
    pub color_diff_pct: f64,
    pub edge_diff_pct: f64,
    pub max_cell_diff: u32,
    pub changed_cells: usize,
    pub changed_cells_pct: f64,
    /// `f64::INFINITY` when the renders are identical.
    pub psnr: f64,
    pub ahash_hamming: u32,
    pub dhash_hamming: u32,
    pub identical: bool,
    pub grid: usize,
}

#[derive(Debug, Clone)]
pub struct CompareResult {
    pub metrics: Metrics,
    /// Per-cell mean RGB delta (0–255) for the heat map.
    pub heat: Vec<u8>,
    pub base_sig: Vec<u8>,
    pub cur_sig: Vec<u8>,
    pub pass: bool,
    pub reasons: Vec<String>,
    /// Detail-channel result when both the baseline and the gate have one.
    pub detail: Option<DetailMetrics>,
}

/// Diff a current render (decoded RGBA + dims) against a baseline signature and
/// its committed hashes. `base_sig` is the raw `grid*grid*3` bytes.
#[allow(clippy::too_many_arguments)]
pub fn compare(
    base_sig: &[u8],
    base_ahash: &str,
    base_dhash: &str,
    base_sha256: &str,
    grid: usize,
    cur_data: &[u8],
    cur_w: usize,
    cur_h: usize,
    gate: &GateThresholds,
) -> CompareResult {
    compare_with_detail(
        base_sig,
        base_ahash,
        base_dhash,
        base_sha256,
        grid,
        None,
        cur_data,
        cur_w,
        cur_h,
        gate,
    )
}

/// [`compare`] plus the detail channel when `base_detail` and `gate.detail` are both set.
#[allow(clippy::too_many_arguments)]
pub fn compare_with_detail(
    base_sig: &[u8],
    base_ahash: &str,
    base_dhash: &str,
    base_sha256: &str,
    grid: usize,
    base_detail: Option<&Detail>,
    cur_data: &[u8],
    cur_w: usize,
    cur_h: usize,
    gate: &GateThresholds,
) -> CompareResult {
    let cur = signature_of(cur_data, cur_w, cur_h, grid);
    let base_gray = to_gray(base_sig, grid);
    let cells = grid * grid;

    let (mut sum_abs, mut max_cell, mut changed, mut sum_sq_lum) = (0f64, 0f64, 0usize, 0f64);
    let mut heat = vec![0u8; cells];
    for c in 0..cells {
        let o = c * 3;
        let dr = (base_sig[o] as i32 - cur.sig[o] as i32).unsigned_abs() as f64;
        let dg = (base_sig[o + 1] as i32 - cur.sig[o + 1] as i32).unsigned_abs() as f64;
        let db = (base_sig[o + 2] as i32 - cur.sig[o + 2] as i32).unsigned_abs() as f64;
        let cell_mean = (dr + dg + db) / 3.0;
        heat[c] = cell_mean.round().min(255.0) as u8;
        sum_abs += cell_mean;
        if cell_mean > max_cell {
            max_cell = cell_mean;
        }
        if cell_mean > gate.threshold {
            changed += 1;
        }
        let d = base_gray[c] - cur.gray[c];
        sum_sq_lum += d * d;
    }

    let color_diff_pct = (sum_abs / cells as f64 / 255.0) * 100.0;
    let mse = sum_sq_lum / cells as f64;
    let psnr = if mse == 0.0 {
        f64::INFINITY
    } else {
        10.0 * (255.0f64 * 255.0 / mse).log10()
    };
    let ssim_score = ssim(&base_gray, &cur.gray, grid);
    let edge_pct = edge_diff_pct(&base_gray, &cur.gray, grid);

    let metrics = Metrics {
        ssim: round(ssim_score, 4),
        color_diff_pct: round(color_diff_pct, 3),
        edge_diff_pct: round(edge_pct, 3),
        max_cell_diff: max_cell.round() as u32,
        changed_cells: changed,
        changed_cells_pct: round((changed as f64 / cells as f64) * 100.0, 2),
        psnr: if psnr.is_infinite() {
            psnr
        } else {
            round(psnr, 2)
        },
        ahash_hamming: hamming(base_ahash, &cur.ahash),
        dhash_hamming: hamming(base_dhash, &cur.dhash),
        identical: cur.sha256 == base_sha256,
        grid,
    };

    let mut reasons = Vec::new();
    if metrics.ssim < gate.min_ssim {
        reasons.push(format!("ssim {} < min {}", metrics.ssim, gate.min_ssim));
    }
    if metrics.changed_cells_pct > gate.max_changed_pct {
        reasons.push(format!(
            "changedCellsPct {} > max {}",
            metrics.changed_cells_pct, gate.max_changed_pct
        ));
    }
    if metrics.edge_diff_pct > gate.max_edge_pct {
        reasons.push(format!(
            "edgeDiffPct {} > max {}",
            metrics.edge_diff_pct, gate.max_edge_pct
        ));
    }

    if gate.min_cells > 0 && metrics.changed_cells >= gate.min_cells {
        reasons.push(format!(
            "changedCells {} >= {} (off by > {})",
            metrics.changed_cells, gate.min_cells, gate.threshold
        ));
    }
    let detail = match (base_detail, gate.detail) {
        (Some(d), Some(g)) => {
            let m = compare_detail(d, cur_data, cur_w, cur_h, &g);
            let tiles = m.changed_tiles + m.new_edge_tiles;
            if tiles >= g.min_tiles {
                reasons.push(format!(
                    "detail {tiles} tiles changed ({} kept, {} new edges) >= {}",
                    m.changed_tiles, m.new_edge_tiles, g.min_tiles
                ));
            }
            Some(m)
        }
        _ => None,
    };

    let pass = reasons.is_empty();
    CompareResult {
        detail,
        metrics,
        heat,
        base_sig: base_sig.to_vec(),
        cur_sig: cur.sig,
        pass,
        reasons,
    }
}

/// Round to `dp` decimal places (spec v1 reports metrics rounded like `toFixed`).
fn round(v: f64, dp: i32) -> f64 {
    let f = 10f64.powi(dp);
    (v * f).round() / f
}
