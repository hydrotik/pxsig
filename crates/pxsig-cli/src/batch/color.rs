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
///
/// Returns the row's `differs`: on an entry that passes (the color rule included), whether any
/// pixel of the render is not the baseline image's (another size counts as different). `None` when
/// a rule failed it, or the baseline holds no image.
pub fn apply(
    r: &mut CompareResult,
    b: &Baseline,
    png: &Path,
    bytes: &[u8],
    cur: (&[u8], usize, usize),
    gate: &GateThresholds,
) -> Result<Option<bool>> {
    if !r.pass {
        return Ok(None);
    }
    // The same file: every pixel is the same, so the render stands in for the baseline (no decode).
    let decoded = match b.image.as_deref() {
        Some(img) if img != bytes => Some(io::decode_png_bytes(img, Path::new("baseline image"))),
        _ => None,
    };
    // An image that does not decode fails the color rule's row, as before; without the rule it
    // leaves `differs` unknown.
    let decoded = match decoded {
        Some(Err(e)) if gate.color.is_some() => {
            return Err(e).with_context(|| format!("the color rule for {}", png.display()))
        }
        Some(Err(_)) => return Ok(None),
        Some(Ok(d)) => Some(d),
        None => None,
    };
    let differs = b.image.as_ref().map(|_| {
        decoded
            .as_ref()
            .is_some_and(|(d, w, h)| (*w, *h) != (cur.1, cur.2) || d.as_slice() != cur.0)
    });
    if let Some(g) = gate.color.as_ref() {
        let base = match (&decoded, &b.image) {
            (Some((d, w, h)), _) => Some((d.as_slice(), *w, *h)),
            (None, Some(_)) => Some(cur),
            (None, None) => None,
        };
        let size = (b.record.src_width as usize, b.record.src_height as usize);
        apply_color(r, base, size, cur, g);
    }
    Ok(differs.filter(|_| r.pass))
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
