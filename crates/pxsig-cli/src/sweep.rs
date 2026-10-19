//! `pxsig detail-sweep`: the raw material for calibrating the detail channel.
//!
//! For each `{key, base, cur}` pair and each build (`tile`/`block`/`selEnergy`),
//! build the detail signature from `base` and report, per tile that moved at
//! all, `[blockDelta, energyRise]` (blockDelta −1 when the tile was not kept).
//! A rule "fail when ≥ k tiles have blockDelta > T or energyRise > E" can then be
//! scored for any k/T/E without touching a PNG again (`tools/calibrate-detail.mjs` in the
//! repository drives it).

use std::path::PathBuf;

use anyhow::{Context, Result};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};

use pxsig_core::detail::{detail_of_lum, luminance, DetailParams};

use crate::io;

#[derive(Deserialize)]
pub struct Pair {
    pub key: String,
    pub base: PathBuf,
    pub cur: PathBuf,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub tile: usize,
    pub block: usize,
    pub sel_energy: u8,
}

#[derive(Deserialize)]
pub struct SweepInput {
    pub pairs: Vec<Pair>,
    pub builds: Vec<Build>,
}

fn blocks(lum: &[f32], w: usize, h: usize, tx: usize, ty: usize, tile: usize, block: usize) -> Vec<f32> {
    let per = tile / block;
    let mut out = Vec::with_capacity(per * per);
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
            out.push(if n == 0.0 { 255.0 } else { (s / n).round().clamp(0.0, 255.0) });
        }
    }
    out
}

pub fn run(input: &SweepInput) -> Result<Value> {
    let rows: Vec<Value> = input
        .pairs
        .par_iter()
        .map(|p| -> Result<Value> {
            let (a, aw, ah) = io::decode_png(&p.base).with_context(|| p.key.clone())?;
            let (b, bw, bh) = io::decode_png(&p.cur).with_context(|| p.key.clone())?;
            let (la, lb) = (luminance(&a, aw, ah), luminance(&b, bw, bh));
            let builds: Vec<Value> = input
                .builds
                .iter()
                .map(|bp| {
                    let params = DetailParams { tile: bp.tile, block: bp.block, sel_energy: bp.sel_energy };
                    let d = detail_of_lum(&la, aw, ah, params);
                    let cur = detail_of_lum(&lb, bw, bh, DetailParams { sel_energy: 255, ..params });
                    let per = (bp.tile / bp.block).pow(2);
                    let mut kept = vec![-1i32; d.cols * d.rows];
                    for (k, &idx) in d.sel.iter().enumerate() {
                        let idx = idx as usize;
                        let (tx, ty) = (idx % d.cols, idx / d.cols);
                        if tx >= cur.cols || ty >= cur.rows {
                            kept[idx] = 255;
                            continue;
                        }
                        let now = blocks(&lb, bw, bh, tx, ty, bp.tile, bp.block);
                        let stored = &d.blocks[k * per..(k + 1) * per];
                        kept[idx] = stored.iter().zip(&now).map(|(s, n)| (*s as f32 - n).abs() as i32).max().unwrap_or(0);
                    }
                    let mut tiles = Vec::new();
                    for ty in 0..d.rows {
                        for tx in 0..d.cols {
                            let idx = ty * d.cols + tx;
                            let rise = if tx < cur.cols && ty < cur.rows {
                                cur.energy[ty * cur.cols + tx] as i32 - d.energy[idx] as i32
                            } else {
                                0
                            };
                            if kept[idx] > 8 || rise > 4 {
                                tiles.push(json!([kept[idx], rise]));
                            }
                        }
                    }
                    let bytes = d.to_record();
                    json!({
                        "kept": d.sel.len(),
                        "tiles": d.cols * d.rows,
                        "recordBytes": bytes.energy.len() + bytes.sel.len() + bytes.blocks.len(),
                        "moved": tiles,
                    })
                })
                .collect();
            Ok(json!({ "key": p.key, "builds": builds }))
        })
        .collect::<Result<_>>()?;
    Ok(json!({ "rows": rows }))
}
