//! The detail channel: a sparse, full-resolution signature for
//! the thin features a whole-image grid averages away — 1px borders, strokes,
//! arrowheads, icons, corner radii.
//!
//! The render is cut into fixed `tile`-pixel tiles (16 by default), measured in
//! pixels from the top-left so the tiling does not move when the image grows.
//! For every tile we keep its **edge energy** (mean absolute luminance gradient,
//! one byte). Tiles whose energy clears `sel_energy` also keep their luminance
//! box-averaged into `block`-pixel blocks (4×4 blocks of 4px by default).
//!
//! Comparing then has two local rules, both blind to whole-image averages:
//! - a **kept tile changed** when any of its blocks moved by more than
//!   `block_delta` (a line vanished, recoloured, thickened, shifted);
//! - a **new edge appeared** when a tile's energy rose by more than
//!   `energy_delta` (a line or glyph drawn where there was none).
//!
//! The gate fails when at least `min_tiles` tiles trip either rule.
//! Defaults are calibrated by `tools/calibrate-detail.mjs` (in the repository) against the
//! scenario renders (zero false positives across the noise scenarios).

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy)]
pub struct DetailParams {
    pub tile: usize,
    pub block: usize,
    /// Minimum tile energy (0–255) for a tile's blocks to be stored.
    pub sel_energy: u8,
}

impl Default for DetailParams {
    fn default() -> Self {
        Self {
            tile: 16,
            block: 4,
            sel_energy: 10,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DetailGate {
    pub block_delta: f64,
    pub energy_delta: f64,
    pub min_tiles: usize,
}

impl Default for DetailGate {
    fn default() -> Self {
        Self {
            block_delta: 32.0,
            energy_delta: 48.0,
            min_tiles: 3,
        }
    }
}

/// The stored detail signature.
#[derive(Debug, Clone, PartialEq)]
pub struct Detail {
    pub tile: usize,
    pub block: usize,
    pub cols: usize,
    pub rows: usize,
    /// `cols*rows` tile energies.
    pub energy: Vec<u8>,
    /// Indices (row-major) of the tiles whose blocks are kept.
    pub sel: Vec<u32>,
    /// `sel.len() * (tile/block)^2` block luminances.
    pub blocks: Vec<u8>,
}

/// JSON shape inside a `.pxsig.json` record (optional `detail` field).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetailRecord {
    pub tile: usize,
    pub block: usize,
    pub cols: usize,
    pub rows: usize,
    /// base64 of the energy bytes.
    pub energy: String,
    /// base64 of little-endian u32 tile indices.
    pub sel: String,
    /// base64 of the block bytes.
    pub blocks: String,
}

#[derive(Debug, Clone, Default)]
pub struct DetailMetrics {
    /// Kept tiles whose blocks moved past `block_delta`.
    pub changed_tiles: usize,
    /// Tiles whose energy rose past `energy_delta`.
    pub new_edge_tiles: usize,
    /// Largest block delta seen in a kept tile.
    pub max_block_delta: u32,
    /// Row-major indices of every tripped tile (for overlays).
    pub tripped: Vec<u32>,
}

/// Alpha-flattened-on-white luminance, one f32 per pixel.
pub fn luminance(data: &[u8], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0f32; w * h];
    for (i, px) in data.as_chunks::<4>().0.iter().take(w * h).enumerate() {
        let a = px[3] as f32 / 255.0;
        let f = |c: u8| c as f32 * a + 255.0 * (1.0 - a);
        out[i] = 0.299 * f(px[0]) + 0.587 * f(px[1]) + 0.114 * f(px[2]);
    }
    out
}

fn tile_energy(lum: &[f32], w: usize, h: usize, tx: usize, ty: usize, tile: usize) -> u8 {
    let (x0, y0) = (tx * tile, ty * tile);
    let (x1, y1) = ((x0 + tile).min(w), (y0 + tile).min(h));
    let (mut sum, mut n) = (0f32, 0f32);
    for y in y0..y1 {
        for x in x0..x1 {
            let v = lum[y * w + x];
            if x + 1 < w {
                sum += (lum[y * w + x + 1] - v).abs();
            }
            if y + 1 < h {
                sum += (lum[(y + 1) * w + x] - v).abs();
            }
            n += 1.0;
        }
    }
    if n == 0.0 {
        0
    } else {
        // mean |gradient| (0–510) × 4, clamped: one hard 1px line in a 16px tile ≈ 100.
        ((sum / n) * 4.0).round().min(255.0) as u8
    }
}

#[allow(clippy::too_many_arguments)]
fn tile_blocks(
    lum: &[f32],
    w: usize,
    h: usize,
    tx: usize,
    ty: usize,
    tile: usize,
    block: usize,
    out: &mut Vec<u8>,
) {
    let per = tile / block;
    for by in 0..per {
        for bx in 0..per {
            let (x0, y0) = (tx * tile + bx * block, ty * tile + by * block);
            let (x1, y1) = ((x0 + block).min(w), (y0 + block).min(h));
            let (mut s, mut n) = (0f32, 0f32);
            for y in y0..y1 {
                for x in x0..x1 {
                    s += lum[y * w + x];
                    n += 1.0;
                }
            }
            // Blocks past the image edge read as white, like the alpha flatten.
            out.push(if n == 0.0 {
                255
            } else {
                (s / n).round().clamp(0.0, 255.0) as u8
            });
        }
    }
}

/// Build the detail signature of a decoded RGBA render.
pub fn detail_of(data: &[u8], w: usize, h: usize, p: DetailParams) -> Detail {
    let lum = luminance(data, w, h);
    detail_of_lum(&lum, w, h, p)
}

pub fn detail_of_lum(lum: &[f32], w: usize, h: usize, p: DetailParams) -> Detail {
    let (cols, rows) = (w.div_ceil(p.tile), h.div_ceil(p.tile));
    let mut energy = Vec::with_capacity(cols * rows);
    let mut sel = Vec::new();
    let mut blocks = Vec::new();
    for ty in 0..rows {
        for tx in 0..cols {
            let e = tile_energy(lum, w, h, tx, ty, p.tile);
            energy.push(e);
            if e >= p.sel_energy {
                sel.push((ty * cols + tx) as u32);
                tile_blocks(lum, w, h, tx, ty, p.tile, p.block, &mut blocks);
            }
        }
    }
    Detail {
        tile: p.tile,
        block: p.block,
        cols,
        rows,
        energy,
        sel,
        blocks,
    }
}

/// Compare a baseline detail signature with a current render (decoded RGBA).
pub fn compare_detail(
    base: &Detail,
    data: &[u8],
    w: usize,
    h: usize,
    gate: &DetailGate,
) -> DetailMetrics {
    let lum = luminance(data, w, h);
    compare_detail_lum(base, &lum, w, h, gate)
}

pub fn compare_detail_lum(
    base: &Detail,
    lum: &[f32],
    w: usize,
    h: usize,
    gate: &DetailGate,
) -> DetailMetrics {
    let (tile, block) = (base.tile, base.block);
    let per = (tile / block) * (tile / block);
    let (cols, rows) = (w.div_ceil(tile), h.div_ceil(tile));
    let mut m = DetailMetrics::default();
    let mut tripped = vec![false; base.cols * base.rows];
    let mut scratch = Vec::with_capacity(per);

    for (k, &idx) in base.sel.iter().enumerate() {
        let idx = idx as usize;
        let (tx, ty) = (idx % base.cols, idx / base.cols);
        let stored = &base.blocks[k * per..(k + 1) * per];
        if tx >= cols || ty >= rows {
            // The render shrank past a tile that had detail: it is gone.
            m.changed_tiles += 1;
            tripped[idx] = true;
            continue;
        }
        scratch.clear();
        tile_blocks(lum, w, h, tx, ty, tile, block, &mut scratch);
        let d = stored
            .iter()
            .zip(&scratch)
            .map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs())
            .max()
            .unwrap_or(0);
        m.max_block_delta = m.max_block_delta.max(d);
        if d as f64 > gate.block_delta {
            m.changed_tiles += 1;
            tripped[idx] = true;
        }
    }
    for ty in 0..rows.min(base.rows) {
        for tx in 0..cols.min(base.cols) {
            let idx = ty * base.cols + tx;
            if tripped[idx] {
                continue;
            }
            let e = tile_energy(lum, w, h, tx, ty, tile) as f64;
            if e - base.energy[idx] as f64 > gate.energy_delta {
                m.new_edge_tiles += 1;
                tripped[idx] = true;
            }
        }
    }
    m.tripped = tripped
        .iter()
        .enumerate()
        .filter(|(_, t)| **t)
        .map(|(i, _)| i as u32)
        .collect();
    m
}

impl Detail {
    pub fn to_record(&self) -> DetailRecord {
        let sel: Vec<u8> = self.sel.iter().flat_map(|i| i.to_le_bytes()).collect();
        DetailRecord {
            tile: self.tile,
            block: self.block,
            cols: self.cols,
            rows: self.rows,
            energy: STANDARD.encode(&self.energy),
            sel: STANDARD.encode(sel),
            blocks: STANDARD.encode(&self.blocks),
        }
    }
}

impl DetailRecord {
    pub fn decode(&self) -> Result<Detail, String> {
        let energy = STANDARD
            .decode(&self.energy)
            .map_err(|e| format!("bad detail.energy: {e}"))?;
        let sel_raw = STANDARD
            .decode(&self.sel)
            .map_err(|e| format!("bad detail.sel: {e}"))?;
        let blocks = STANDARD
            .decode(&self.blocks)
            .map_err(|e| format!("bad detail.blocks: {e}"))?;
        if self.block == 0 || !self.tile.is_multiple_of(self.block) {
            return Err(format!(
                "detail tile {} is not a multiple of block {}",
                self.tile, self.block
            ));
        }
        if energy.len() != self.cols * self.rows || sel_raw.len() % 4 != 0 {
            return Err("detail lengths do not match cols × rows".into());
        }
        let sel: Vec<u32> = sel_raw
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| u32::from_le_bytes(*c))
            .collect();
        let per = (self.tile / self.block).pow(2);
        if blocks.len() != sel.len() * per || sel.iter().any(|&i| i as usize >= energy.len()) {
            return Err("detail blocks do not match the kept tiles".into());
        }
        Ok(Detail {
            tile: self.tile,
            block: self.block,
            cols: self.cols,
            rows: self.rows,
            energy,
            sel,
            blocks,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canvas(w: usize, h: usize, f: impl Fn(usize, usize) -> u8) -> Vec<u8> {
        let mut d = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let v = f(x, y);
                d[(y * w + x) * 4..][..4].copy_from_slice(&[v, v, v, 255]);
            }
        }
        d
    }

    #[test]
    fn identical_render_trips_nothing() {
        let img = canvas(200, 120, |x, _| if x == 50 { 20 } else { 240 });
        let d = detail_of(&img, 200, 120, DetailParams::default());
        assert!(!d.sel.is_empty());
        let m = compare_detail(&d, &img, 200, 120, &DetailGate::default());
        assert_eq!(
            (m.changed_tiles, m.new_edge_tiles, m.max_block_delta),
            (0, 0, 0)
        );
    }

    #[test]
    fn a_vanished_hairline_is_caught() {
        let base = canvas(200, 120, |x, _| if x == 50 { 20 } else { 240 });
        let gone = canvas(200, 120, |_, _| 240);
        let d = detail_of(&base, 200, 120, DetailParams::default());
        let m = compare_detail(&d, &gone, 200, 120, &DetailGate::default());
        assert!(m.changed_tiles >= 7, "{m:?}");
    }

    #[test]
    fn a_new_hairline_is_caught() {
        let base = canvas(200, 120, |_, _| 240);
        let drawn = canvas(200, 120, |x, _| if x == 50 { 20 } else { 240 });
        let d = detail_of(&base, 200, 120, DetailParams::default());
        assert!(d.sel.is_empty());
        let m = compare_detail(&d, &drawn, 200, 120, &DetailGate::default());
        assert!(m.new_edge_tiles >= 7, "{m:?}");
    }

    #[test]
    fn record_round_trips() {
        let img = canvas(70, 40, |x, y| ((x * 7 + y * 3) % 255) as u8);
        let d = detail_of(&img, 70, 40, DetailParams::default());
        assert_eq!(d.to_record().decode().unwrap(), d);
    }
}
