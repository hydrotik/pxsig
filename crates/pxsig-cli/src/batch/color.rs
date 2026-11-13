//! The color rule at check time (pxsig_core::color): after the other rules passed, against the
//! baseline image the `.psig` holds.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};

use pxsig_core::{apply_color, CompareResult, GateThresholds};

use super::Baseline;
use crate::io;

/// Apply the color rule to `r`, made from the render `png` (its file bytes and decoded pixels).
/// Nothing runs when the gate has no color rule or `r` failed already; the flat-area check is
/// skipped when the render's file is byte for byte the baseline image, and runs on the cells alone
/// when the baseline has no image (a pre-0.2 `.pxsig.json`). A render of another size than the
/// baseline's gets the flat-area check alone, over the region both cover
/// (`pxsig_core::color::apply_color`).
pub fn apply(
    r: &mut CompareResult,
    b: &Baseline,
    png: &Path,
    bytes: &[u8],
    cur: (&[u8], usize, usize),
    gate: &GateThresholds,
) -> Result<()> {
    let Some(g) = gate.color.as_ref().filter(|_| r.pass) else {
        return Ok(());
    };
    // The same file: every pixel is the same, so the render stands in for the baseline (no decode).
    let decoded = match b.image.as_deref() {
        Some(img) if img != bytes => Some(
            io::decode_png_bytes(img, Path::new("baseline image"))
                .with_context(|| format!("the color rule for {}", png.display()))?,
        ),
        _ => None,
    };
    let base = match (&decoded, &b.image) {
        (Some((d, w, h)), _) => Some((d.as_slice(), *w, *h)),
        (None, Some(_)) => Some(cur),
        (None, None) => None,
    };
    let size = (b.record.src_width as usize, b.record.src_height as usize);
    apply_color(r, base, size, cur, g);
    Ok(())
}

/// The color rule's measurements for a row (`null` when it did not run).
pub fn color_json(r: &CompareResult) -> Value {
    r.color.as_ref().map_or(Value::Null, |m| {
        json!({
            "flatArea": m.flat_area,
            "flatDeltaE": (m.flat_delta_e * 100.0).round() / 100.0,
            "cells": m.cells,
            "maxCellDeltaE": (m.max_cell_delta_e * 100.0).round() / 100.0,
        })
    })
}
