//! The colour rule at check time (pxsig_core::colour): after the other rules passed, against the
//! baseline image the `.psig` holds.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};

use pxsig_core::{apply_colour, CompareResult, GateThresholds};

use super::Baseline;
use crate::io;

/// Apply the colour rule to `r`, made from the render `png` (its file bytes and decoded pixels).
/// Nothing runs when the gate has no colour rule or `r` failed already; the flat-area check is
/// skipped when the render's file is byte for byte the baseline image, and runs on the cells alone
/// when the baseline has no image (a pre-0.2 `.pxsig.json`). A render of another size than the
/// baseline's is not measured (`pxsig_core::colour::apply_colour`).
pub fn apply(
    r: &mut CompareResult,
    b: &Baseline,
    png: &Path,
    bytes: &[u8],
    cur: (&[u8], usize, usize),
    gate: &GateThresholds,
) -> Result<()> {
    let Some(g) = gate.colour.as_ref().filter(|_| r.pass) else {
        return Ok(());
    };
    // The same file: every pixel is the same, so the render stands in for the baseline (no decode).
    let decoded = match b.image.as_deref() {
        Some(img) if img != bytes => Some(
            io::decode_png_bytes(img, Path::new("baseline image"))
                .with_context(|| format!("the colour rule for {}", png.display()))?,
        ),
        _ => None,
    };
    let base = match (&decoded, &b.image) {
        (Some((d, w, h)), _) => Some((d.as_slice(), *w, *h)),
        (None, Some(_)) => Some(cur),
        (None, None) => None,
    };
    let size = (b.record.src_width as usize, b.record.src_height as usize);
    apply_colour(r, base, size, cur, g);
    Ok(())
}

/// The colour rule's measurements for a row (`null` when it did not run).
pub fn colour_json(r: &CompareResult) -> Value {
    r.colour.as_ref().map_or(Value::Null, |m| {
        json!({
            "flatArea": m.flat_area,
            "flatDeltaE": (m.flat_delta_e * 100.0).round() / 100.0,
            "cells": m.cells,
            "maxCellDeltaE": (m.max_cell_delta_e * 100.0).round() / 100.0,
        })
    })
}
