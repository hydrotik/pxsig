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

#[cfg(test)]
mod golden {
    //! The comparator's numbers, pinned: values recorded from the engine as it is, for five
    //! generated image pairs. A change here is a change to every user's verdicts, so a value that
    //! moves is caught here, not updated to match.
    use super::*;
    use crate::metrics::{edge_diff_pct, ssim};
    use crate::signature::{signature_of, to_gray};

    const GRID: usize = 32;

    /// A `w×h` RGBA scene: a light page, a soft horizontal gradient band, and a dark box.
    fn scene(w: usize, h: usize, bx: usize, by: usize, colour: [u8; 3]) -> Vec<u8> {
        let mut d = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let px = if (bx..bx + 30).contains(&x) && (by..by + 30).contains(&y) {
                    colour
                } else if y < 12 {
                    let v = 200 + (x * 40 / w) as u8;
                    [v, v, 255]
                } else {
                    [245, 245, 245]
                };
                d[i..i + 3].copy_from_slice(&px);
                d[i + 3] = 255;
            }
        }
        d
    }

    const DARK: [u8; 3] = [30, 40, 60];

    /// The five pairs: (name, current RGBA, its width, its height). The baseline is always
    /// `scene(160, 100, 40, 30, DARK)`.
    fn pairs() -> Vec<(&'static str, Vec<u8>, usize, usize)> {
        let base = scene(160, 100, 40, 30, DARK);
        let mut one = base.clone();
        let i = (50 * 160 + 120) * 4;
        one[i..i + 3].copy_from_slice(&[0, 0, 0]);
        vec![
            ("identical", base, 160, 100),
            ("one-pixel", one, 160, 100),
            (
                "colour-shift",
                scene(160, 100, 40, 30, [70, 40, 60]),
                160,
                100,
            ),
            ("shape-move", scene(160, 100, 52, 30, DARK), 160, 100),
            ("size-change", scene(176, 110, 40, 30, DARK), 176, 110),
        ]
    }

    fn run(cur: &[u8], w: usize, h: usize, gate: &GateThresholds) -> CompareResult {
        let b = signature_of(&scene(160, 100, 40, 30, DARK), 160, 100, GRID);
        compare(&b.sig, &b.ahash, &b.dhash, &b.sha256, GRID, cur, w, h, gate)
    }

    /// What a pair gives: raw SSIM and edge delta (to 1e-9), then the rounded metrics and verdict
    /// under the default gate.
    struct Golden {
        name: &'static str,
        raw_ssim: f64,
        raw_edge: f64,
        ssim: f64,
        color_diff_pct: f64,
        edge_diff_pct: f64,
        max_cell_diff: u32,
        changed_cells: usize,
        changed_cells_pct: f64,
        psnr: f64,
        ahash: u32,
        dhash: u32,
        identical: bool,
        heat_sum: u64,
        reasons: &'static [&'static str],
    }

    const GOLDEN: [Golden; 5] = [
        Golden {
            name: "identical",
            raw_ssim: 1.0,
            raw_edge: 0.0,
            ssim: 1.0,
            color_diff_pct: 0.0,
            edge_diff_pct: 0.0,
            max_cell_diff: 0,
            changed_cells: 0,
            changed_cells_pct: 0.0,
            psnr: f64::INFINITY,
            ahash: 0,
            dhash: 0,
            identical: true,
            heat_sum: 0,
            reasons: &[],
        },
        Golden {
            name: "one-pixel",
            raw_ssim: 0.9948538094620876,
            raw_edge: 0.020920426240031223,
            ssim: 0.9949,
            color_diff_pct: 0.006,
            edge_diff_pct: 0.021,
            max_cell_diff: 16,
            changed_cells: 1,
            changed_cells_pct: 0.1,
            psnr: 54.15,
            ahash: 0,
            dhash: 1,
            identical: false,
            heat_sum: 16,
            reasons: &[],
        },
        Golden {
            name: "colour-shift",
            raw_ssim: 0.9994381434283877,
            raw_edge: 0.2670768986472403,
            ssim: 0.9994,
            color_diff_pct: 0.297,
            edge_diff_pct: 0.267,
            max_cell_diff: 13,
            changed_cells: 54,
            changed_cells_pct: 5.27,
            psnr: 39.24,
            ahash: 0,
            dhash: 0,
            identical: false,
            heat_sum: 762,
            reasons: &["changedCellsPct 5.27 > max 2"],
        },
        Golden {
            name: "shape-move",
            raw_ssim: 0.7944588245383869,
            raw_edge: 6.1613971025957035,
            ssim: 0.7945,
            color_diff_pct: 3.584,
            edge_diff_pct: 6.161,
            max_cell_diff: 202,
            changed_cells: 66,
            changed_cells_pct: 6.45,
            psnr: 15.97,
            ahash: 2,
            dhash: 4,
            identical: false,
            heat_sum: 9374,
            reasons: &["ssim 0.7945 < min 0.99", "changedCellsPct 6.45 > max 2"],
        },
        Golden {
            name: "size-change",
            raw_ssim: 0.8364232395520469,
            raw_edge: 4.189080248287589,
            ssim: 0.8364,
            color_diff_pct: 2.284,
            edge_diff_pct: 4.189,
            max_cell_diff: 202,
            changed_cells: 47,
            changed_cells_pct: 4.59,
            psnr: 18.64,
            ahash: 3,
            dhash: 4,
            identical: false,
            heat_sum: 5967,
            reasons: &["ssim 0.8364 < min 0.99", "changedCellsPct 4.59 > max 2"],
        },
    ];

    #[test]
    fn five_pairs_give_the_recorded_numbers() {
        let b = signature_of(&scene(160, 100, 40, 30, DARK), 160, 100, GRID);
        let base_gray = to_gray(&b.sig, GRID);
        let all = pairs();
        assert_eq!(all.len(), GOLDEN.len());
        for ((name, cur, w, h), g) in all.iter().zip(GOLDEN.iter()) {
            assert_eq!(*name, g.name);
            let c = signature_of(cur, *w, *h, GRID);
            let raw_ssim = ssim(&base_gray, &c.gray, GRID);
            let raw_edge = edge_diff_pct(&base_gray, &c.gray, GRID);
            assert!(
                (raw_ssim - g.raw_ssim).abs() < 1e-9,
                "{name} ssim {raw_ssim}"
            );
            assert!(
                (raw_edge - g.raw_edge).abs() < 1e-9,
                "{name} edge {raw_edge}"
            );
            let r = run(cur, *w, *h, &GateThresholds::default());
            let m = &r.metrics;
            assert_eq!(m.ssim, g.ssim, "{name} ssim");
            assert_eq!(m.color_diff_pct, g.color_diff_pct, "{name} colorDiffPct");
            assert_eq!(m.edge_diff_pct, g.edge_diff_pct, "{name} edgeDiffPct");
            assert_eq!(m.max_cell_diff, g.max_cell_diff, "{name} maxCellDiff");
            assert_eq!(m.changed_cells, g.changed_cells, "{name} changedCells");
            assert_eq!(
                m.changed_cells_pct, g.changed_cells_pct,
                "{name} changedCellsPct"
            );
            assert_eq!(m.psnr, g.psnr, "{name} psnr");
            assert_eq!(m.ahash_hamming, g.ahash, "{name} aHash");
            assert_eq!(m.dhash_hamming, g.dhash, "{name} dHash");
            assert_eq!(m.identical, g.identical, "{name} identical");
            assert_eq!(m.grid, GRID);
            assert_eq!(r.heat.len(), GRID * GRID);
            let heat: u64 = r.heat.iter().map(|&x| u64::from(x)).sum();
            assert_eq!(heat, g.heat_sum, "{name} heat");
            assert_eq!(r.reasons, g.reasons, "{name} reasons");
            assert_eq!(r.pass, g.reasons.is_empty(), "{name} pass");
            assert!(r.detail.is_none());
        }
    }

    #[test]
    fn the_default_gate() {
        let g = GateThresholds::default();
        assert_eq!(g.threshold, 12.0);
        assert_eq!(g.min_ssim, 0.99);
        assert_eq!(g.max_changed_pct, 2.0);
        assert_eq!(g.max_edge_pct, f64::INFINITY);
        assert_eq!(g.min_cells, 0);
        assert!(g.detail.is_none());
    }

    /// Every gate off but the one under test.
    fn open() -> GateThresholds {
        GateThresholds {
            threshold: 12.0,
            min_ssim: 0.0,
            max_changed_pct: 100.0,
            max_edge_pct: f64::INFINITY,
            min_cells: 0,
            detail: None,
        }
    }

    fn pair(name: &str) -> (Vec<u8>, usize, usize) {
        let (_, d, w, h) = pairs().into_iter().find(|p| p.0 == name).unwrap();
        (d, w, h)
    }

    #[test]
    fn each_gate_at_just_above_and_just_below_its_line() {
        // min_ssim fails below the line: shape-move's ssim is 0.7945.
        let (d, w, h) = pair("shape-move");
        let at = |min_ssim| run(&d, w, h, &GateThresholds { min_ssim, ..open() }).pass;
        assert!(at(0.7945), "at the line: passes");
        assert!(!at(0.7946), "line just above the value: fails");
        assert!(at(0.7944), "line just below: passes");
        // max_edge_pct fails above it: shape-move's edgeDiffPct is 6.161.
        let at = |max_edge_pct| {
            run(
                &d,
                w,
                h,
                &GateThresholds {
                    max_edge_pct,
                    ..open()
                },
            )
            .pass
        };
        assert!(at(6.161));
        assert!(at(6.162));
        assert!(!at(6.160));
        // max_changed_pct fails above it: colour-shift's changedCellsPct is 5.27.
        let (d, w, h) = pair("colour-shift");
        let at = |max_changed_pct| {
            run(
                &d,
                w,
                h,
                &GateThresholds {
                    max_changed_pct,
                    ..open()
                },
            )
            .pass
        };
        assert!(at(5.27));
        assert!(at(5.28));
        assert!(!at(5.26));
        // min_cells fails at or above it: colour-shift has 54 cells over the threshold.
        let at = |min_cells| {
            run(
                &d,
                w,
                h,
                &GateThresholds {
                    min_cells,
                    ..open()
                },
            )
        };
        assert!(!at(54).pass, "54 cells >= 54: fails");
        assert_eq!(at(54).reasons, ["changedCells 54 >= 54 (off by > 12)"]);
        assert!(at(55).pass, "54 < 55: passes");
        assert!(!at(53).pass);
        assert!(at(0).pass, "0 is off");
        // threshold counts a cell strictly above it: the box's cells are off by exactly 40/3.
        let off = 40.0 / 3.0;
        let cells = |threshold| {
            run(
                &d,
                w,
                h,
                &GateThresholds {
                    threshold,
                    ..open()
                },
            )
            .metrics
            .changed_cells
        };
        assert_eq!(cells(off), 0, "at the line: not counted");
        assert_eq!(cells(off - 1e-9), 54, "just below: counted");
        assert_eq!(cells(off + 1e-9), 0);
    }
}
