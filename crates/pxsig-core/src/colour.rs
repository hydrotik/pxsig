//! The colour rule (docs/spec.md §4): colour changes the luminance-only rules cannot see.
//!
//! SSIM, the edge map and the detail channel read luminance, and the cell rule needs a cell's mean
//! RGB to move by more than `threshold`, so a small area changing hue at about the same lightness
//! (a badge's tint, a row highlight, a status colour on text) passes them. Two checks close that:
//!
//! - **flat area**: pixels whose 3×3 luminance range is under [`FLAT_RANGE`] in both images, and
//!   whose CIEDE2000 difference (sRGB → CIELAB, D65) is at least `delta_e`, form 8-connected
//!   regions; the rule trips when one region has at least `min_area` pixels. Flat pixels only, so
//!   anti-aliased edges and sub-pixel text drift do not count;
//! - **cells**: the CIEDE2000 difference of each grid cell's mean colour (the signature's cells,
//!   the same grid as the cell rule); the rule trips when at least `min_cells` cells move by
//!   `cell_delta_e` or more. This one sees a change to thin strokes, which are never flat.
//!
//! The flat-area check needs the baseline image (a `.psig` holds it); the cell check needs only the
//! signature. Both images are alpha-flattened onto white, like the signature. Neither runs when the
//! render's size is not the baseline's ([`apply_colour`]).

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use crate::compare::CompareResult;
use crate::detail::luminance;

/// Pixels whose 3×3 luminance range (0–255) is below this, in both images, are flat.
pub const FLAT_RANGE: f32 = 8.0;

/// The colour rule's settings. `min_area` 0 turns the flat-area check off, `min_cells` 0 the cell
/// check.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColourGate {
    /// CIEDE2000 difference at which a flat pixel counts as changed.
    pub delta_e: f64,
    /// Fewest connected changed flat pixels that fail the entry.
    pub min_area: usize,
    /// CIEDE2000 difference of a cell's mean colour at which the cell counts as changed.
    pub cell_delta_e: f64,
    /// Fewest such cells that fail the entry.
    pub min_cells: usize,
}

impl Default for ColourGate {
    fn default() -> Self {
        Self {
            delta_e: 3.0,
            min_area: 64,
            cell_delta_e: 5.0,
            min_cells: 3,
        }
    }
}

/// What the colour rule measured.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ColourMetrics {
    /// Pixels in the largest connected flat region that changed colour; `None` when the flat-area
    /// check did not run (no baseline image, a different size, or `min_area` 0).
    pub flat_area: Option<usize>,
    /// Mean CIEDE2000 difference over that region (0 when there is none).
    pub flat_delta_e: f64,
    /// Cells whose mean colour moved by at least `cell_delta_e`.
    pub cells: usize,
    /// The largest cell difference.
    pub max_cell_delta_e: f64,
}

/// An RGBA image: row-major, 4 bytes per pixel, its width and height.
pub type Rgba<'a> = (&'a [u8], usize, usize);

/// sRGB (8-bit) → CIELAB, D65 white.
pub fn lab(rgb: [u8; 3]) -> [f64; 3] {
    let lin = |c: u8| {
        let c = c as f64 / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let (r, g, b) = (lin(rgb[0]), lin(rgb[1]), lin(rgb[2]));
    let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    let z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    let f = |t: f64| {
        if t > 216.0 / 24389.0 {
            t.cbrt()
        } else {
            (24389.0 / 27.0 * t + 16.0) / 116.0
        }
    };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// CIEDE2000 colour difference of two CIELAB colours (kL = kC = kH = 1).
pub fn delta_e00(p: [f64; 3], q: [f64; 3]) -> f64 {
    let [l1, a1, b1] = p;
    let [l2, a2, b2] = q;
    let p7 = |c: f64| c.powi(7);
    let c_bar = (a1.hypot(b1) + a2.hypot(b2)) / 2.0;
    let g = 0.5 * (1.0 - (p7(c_bar) / (p7(c_bar) + p7(25.0))).sqrt());
    let (a1p, a2p) = ((1.0 + g) * a1, (1.0 + g) * a2);
    let (c1p, c2p) = (a1p.hypot(b1), a2p.hypot(b2));
    let hue = |b: f64, a: f64| b.atan2(a).to_degrees().rem_euclid(360.0);
    let (h1p, h2p) = (hue(b1, a1p), hue(b2, a2p));
    let neutral = c1p * c2p == 0.0;
    let mut dh = h2p - h1p;
    if neutral {
        dh = 0.0;
    } else if dh > 180.0 {
        dh -= 360.0;
    } else if dh < -180.0 {
        dh += 360.0;
    }
    let d_lp = l2 - l1;
    let d_cp = c2p - c1p;
    let d_hp = 2.0 * (c1p * c2p).sqrt() * (dh / 2.0).to_radians().sin();
    let l_bar = (l1 + l2) / 2.0;
    let c_barp = (c1p + c2p) / 2.0;
    let hs = h1p + h2p;
    let h_bar = if neutral {
        hs
    } else if (h1p - h2p).abs() <= 180.0 {
        hs / 2.0
    } else if hs < 360.0 {
        (hs + 360.0) / 2.0
    } else {
        (hs - 360.0) / 2.0
    };
    let cos = |deg: f64| deg.to_radians().cos();
    let t =
        1.0 - 0.17 * cos(h_bar - 30.0) + 0.24 * cos(2.0 * h_bar) + 0.32 * cos(3.0 * h_bar + 6.0)
            - 0.20 * cos(4.0 * h_bar - 63.0);
    let d_theta = 30.0 * (-((h_bar - 275.0) / 25.0).powi(2)).exp();
    let r_c = 2.0 * (p7(c_barp) / (p7(c_barp) + p7(25.0))).sqrt();
    let s_l = 1.0 + 0.015 * (l_bar - 50.0).powi(2) / (20.0 + (l_bar - 50.0).powi(2)).sqrt();
    let s_c = 1.0 + 0.045 * c_barp;
    let s_h = 1.0 + 0.015 * c_barp * t;
    let r_t = -(2.0 * d_theta).to_radians().sin() * r_c;
    let (l, c, h) = (d_lp / s_l, d_cp / s_c, d_hp / s_h);
    (l * l + c * c + h * h + r_t * c * h).sqrt()
}

/// The cell check: how many of the signatures' cells moved by at least `threshold`, and the
/// largest move. `a` and `b` are `grid*grid*3` RGB bytes.
pub fn cell_colour(a: &[u8], b: &[u8], threshold: f64) -> (usize, f64) {
    let (mut n, mut max) = (0usize, 0f64);
    for (p, q) in a.as_chunks::<3>().0.iter().zip(b.as_chunks::<3>().0) {
        if p == q {
            continue;
        }
        let d = delta_e00(lab(*p), lab(*q));
        if d >= threshold {
            n += 1;
        }
        max = max.max(d);
    }
    (n, max)
}

/// One pixel flattened onto white, as the signature does.
fn rgb(data: &[u8], i: usize) -> [u8; 3] {
    let px = &data[i * 4..i * 4 + 4];
    if px[3] == 255 {
        return [px[0], px[1], px[2]];
    }
    let a = px[3] as f64 / 255.0;
    let f = |c: u8| (c as f64 * a + 255.0 * (1.0 - a)).round() as u8;
    [f(px[0]), f(px[1]), f(px[2])]
}

/// Whether pixel `(x, y)`'s 3×3 neighbourhood (inside the image) has a luminance range under
/// [`FLAT_RANGE`].
fn flat(lum: &[f32], w: usize, h: usize, x: usize, y: usize) -> bool {
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for yy in y.saturating_sub(1)..(y + 2).min(h) {
        for &v in &lum[yy * w + x.saturating_sub(1)..yy * w + (x + 2).min(w)] {
            lo = lo.min(v);
            hi = hi.max(v);
        }
    }
    hi - lo < FLAT_RANGE
}

/// Whether two CIELAB colours can be `threshold` or more apart in CIEDE2000, from a bound that
/// needs no trigonometry: S_L, S_C and S_H are all at least 1 (T > 0.07), |R_T| ≤ 2 so the rotation
/// term adds at most ΔC'² + ΔH'², ΔC'² + ΔH'² = Δa'² + Δb², and a' = (1 + G)·a with G ≤ 0.5. So
/// ΔE00² ≤ ΔL² + 4.5·Δa² + 2·Δb². It skips the one-step drift of noise, nearly every pixel there.
fn may_reach(p: [f64; 3], q: [f64; 3], threshold: f64) -> bool {
    let (dl, da, db) = (p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    dl * dl + 4.5 * da * da + 2.0 * db * db >= threshold * threshold
}

/// A multiplicative hash for the 24-bit colour keys of the Lab cache (the default SipHash is
/// several times slower, and these keys come from images, not from an adversary).
#[derive(Default)]
struct ColourHash(u64);

impl Hasher for ColourHash {
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u32(u32::from(b) ^ (self.0 as u32).rotate_left(8));
        }
    }
    fn write_u32(&mut self, k: u32) {
        let h = (u64::from(k) ^ self.0).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        self.0 = h ^ (h >> 29);
    }
    fn finish(&self) -> u64 {
        self.0
    }
}

/// The flat-area check over two same-size images: the largest 8-connected region of flat pixels
/// whose colour moved by at least `threshold`, as (pixels, mean ΔE00).
pub fn flat_change(base: Rgba, cur: Rgba, threshold: f64) -> (usize, f64) {
    let ((a, w, h), (b, ..)) = (base, cur);
    if a == b {
        return (0, 0.0);
    }
    // Most of a UI is a few colours: convert each once.
    let mut labs: HashMap<u32, [f64; 3], BuildHasherDefault<ColourHash>> = HashMap::default();
    let mut lab_of = |c: [u8; 3]| {
        let k = u32::from_be_bytes([0, c[0], c[1], c[2]]);
        *labs.entry(k).or_insert_with(|| lab(c))
    };
    // Pass 1: the pixels that could reach `threshold` ([`may_reach`]), without the trigonometry.
    let mut maybe = Vec::new();
    for i in 0..w * h {
        if a[i * 4..i * 4 + 4] == b[i * 4..i * 4 + 4] {
            continue;
        }
        let (p, q) = (rgb(a, i), rgb(b, i));
        if p != q {
            let (lp, lq) = (lab_of(p), lab_of(q));
            if may_reach(lp, lq, threshold) {
                maybe.push((i, lp, lq));
            }
        }
    }
    if maybe.is_empty() {
        return (0, 0.0);
    }
    // Pass 2: flat in both images, and the exact difference.
    let (la, lb) = (luminance(a, w, h), luminance(b, w, h));
    let mut de = vec![0f32; w * h];
    let mut hit = Vec::new();
    for (i, lp, lq) in maybe {
        let (x, y) = (i % w, i / w);
        if !flat(&la, w, h, x, y) || !flat(&lb, w, h, x, y) {
            continue;
        }
        let d = delta_e00(lp, lq);
        if d >= threshold {
            de[i] = d as f32;
            hit.push(i);
        }
    }
    let mut seen = vec![false; w * h];
    let (mut best, mut best_sum) = (0usize, 0f64);
    let mut stack = Vec::new();
    for &start in &hit {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let (mut n, mut sum) = (0usize, 0f64);
        while let Some(i) = stack.pop() {
            n += 1;
            sum += de[i] as f64;
            let (x, y) = (i % w, i / w);
            for yy in y.saturating_sub(1)..(y + 2).min(h) {
                for xx in x.saturating_sub(1)..(x + 2).min(w) {
                    let j = yy * w + xx;
                    if !seen[j] && de[j] > 0.0 {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        if n > best {
            (best, best_sum) = (n, sum);
        }
    }
    (
        best,
        if best == 0 {
            0.0
        } else {
            best_sum / best as f64
        },
    )
}

/// Round to one decimal place, for a reason.
fn one_dp(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Apply the colour rule to a result the other rules passed: measure, record the metrics, and fail
/// it with a reason for each check that trips. `base` is the baseline image when there is one,
/// `base_size` the size the baseline was made from (its record's), and `cur` the render the result
/// was made from. Nothing runs when the result already failed (its verdict cannot change, and the
/// flat-area check costs a pass over every pixel), or when the render's size is not the baseline's:
/// that is a layout change for the other rules, and the signature's cells, laid over a different
/// size, no longer cover the same pixels (a trimmed component one pixel wider moves every cell's
/// edge, which a colour difference reads as many changed cells).
pub fn apply_colour(
    r: &mut CompareResult,
    base: Option<Rgba>,
    base_size: (usize, usize),
    cur: Rgba,
    g: &ColourGate,
) {
    if !r.pass || base_size != (cur.1, cur.2) {
        return;
    }
    let mut m = ColourMetrics::default();
    if g.min_cells > 0 {
        (m.cells, m.max_cell_delta_e) = cell_colour(&r.base_sig, &r.cur_sig, g.cell_delta_e);
    }
    if let Some(base) = base.filter(|b| g.min_area > 0 && (b.1, b.2) == base_size) {
        let (area, de) = flat_change(base, cur, g.delta_e);
        m.flat_area = Some(area);
        m.flat_delta_e = de;
    }
    if let Some(area) = m.flat_area.filter(|&a| a >= g.min_area) {
        r.reasons.push(format!(
            "colour ΔE00 {} over {area} px (flat area) >= {}",
            one_dp(m.flat_delta_e),
            g.delta_e
        ));
    }
    if g.min_cells > 0 && m.cells >= g.min_cells {
        r.reasons.push(format!(
            "colour cells {} >= {} (ΔE00 >= {})",
            m.cells, g.min_cells, g.cell_delta_e
        ));
    }
    r.pass = r.reasons.is_empty();
    r.colour = Some(m);
}

#[cfg(test)]
#[path = "colour_tests.rs"]
mod tests;
