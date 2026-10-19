#![forbid(unsafe_code)]
//! # pxsig-core
//!
//! Pure pixel-fingerprint engine — no IO, no CLI. Produces **spec v1** records and the
//! metric definitions in `docs/spec.md`, and packs them into `.psig` baselines (`psig`).
//!
//! The public surface is deliberately small:
//! - [`signature::signature_of`] — build a signature from decoded RGBA pixels.
//! - [`record::PxsigRecord`] — serde model for the spec v1 record.
//! - [`psig`] — the `.psig` container: record, raw signature and baseline image.
//! - [`compare::compare`] — diff a current render against a baseline signature.
//!
//! IO (PNG decode, files, diff artifacts) lives in `pxsig-cli`.

pub mod compare;
pub mod detail;
pub mod hash;
pub mod metrics;
pub mod pixeldiff;
pub mod psig;
pub mod record;
pub mod signature;
pub mod trim;

pub use compare::{compare, compare_with_detail, CompareResult, GateThresholds, Metrics};
pub use detail::{detail_of, Detail, DetailGate, DetailMetrics, DetailParams, DetailRecord};
pub use pixeldiff::{pixel_diff, PixelDiff, Region};
pub use psig::Psig;
pub use record::{PxsigRecord, SpecConfig, SPEC_VERSION};
pub use signature::{downsample, signature_of, to_gray, Signature};
pub use trim::{content_box, crop, TrimBox};

#[cfg(test)]
mod tests {
    use super::*;

    /// Render a W×H RGBA image with a vertical dark bar starting at `x_line`.
    fn bar(x_line: usize, w: usize, h: usize, bar_w: usize) -> Vec<u8> {
        let mut data = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let on = x >= x_line && x < x_line + bar_w;
                let v = if on { 20 } else { 245 };
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
                data[i + 3] = 255;
            }
        }
        data
    }

    #[test]
    fn identical_render_matches() {
        let grid = 48;
        let base = signature_of(&bar(40, 160, 100, 6), 160, 100, grid);
        let res = compare(
            &base.sig,
            &base.ahash,
            &base.dhash,
            &base.sha256,
            grid,
            &bar(40, 160, 100, 6),
            160,
            100,
            &GateThresholds::default(),
        );
        assert!(res.pass);
        assert_eq!(res.metrics.ssim, 1.0);
        assert_eq!(res.metrics.changed_cells, 0);
        assert_eq!(res.metrics.edge_diff_pct, 0.0);
    }

    #[test]
    fn edge_gate_catches_shift() {
        let grid = 48;
        let base = signature_of(&bar(40, 160, 100, 6), 160, 100, grid);
        let gate = GateThresholds {
            min_ssim: 0.0,
            max_changed_pct: 100.0,
            max_edge_pct: 1.0,
            ..GateThresholds::default()
        };
        let res = compare(
            &base.sig,
            &base.ahash,
            &base.dhash,
            &base.sha256,
            grid,
            &bar(70, 160, 100, 6),
            160,
            100,
            &gate,
        );
        assert!(!res.pass);
        assert!(res.reasons.iter().any(|r| r.starts_with("edgeDiffPct")));
    }
}
