//! Where the changed pixels are: inside a change's boxes (widened by `edgePx`), inside a painted
//! element box that copy moved or resized, or outside both; and which changes drew no changed
//! pixel at all.

use std::collections::HashMap;

use super::align::{growth, Ch};
use super::{Pixels, Record, TextBox, Tolerances};

const TEXT: u8 = 1;
const ELEMENT: u8 = 4;

struct Cover<'a> {
    w: usize,
    h: usize,
    m: &'a [u8],
    c: Vec<u8>,
    edge: f64,
}

impl Cover<'_> {
    /// Marks a box, widened by `edgePx`, clipped to the image.
    fn paint(&mut self, b: TextBox, layer: u8) {
        let (x0, y0) = (b[0] - self.edge, b[1] - self.edge);
        let (x1, y1) = (b[0] + b[2] + self.edge, b[1] + b[3] + self.edge);
        let clamp = |v: f64, max: usize| (v.max(0.0) as usize).min(max);
        for y in clamp(y0.floor(), self.h)..clamp(y1.ceil(), self.h) {
            for x in clamp(x0.floor(), self.w)..clamp(x1.ceil(), self.w) {
                self.c[y * self.w + x] |= layer;
            }
        }
    }

    /// A resized box's border bands, `edgePx + 2` either side of each edge.
    fn bands(&mut self, b: TextBox) {
        let t = self.edge + 2.0;
        let edge = std::mem::replace(&mut self.edge, 0.0);
        for band in [
            [b[0] - t, b[1] - t, b[2] + 2.0 * t, 2.0 * t],
            [b[0] - t, b[1] + b[3] - t, b[2] + 2.0 * t, 2.0 * t],
            [b[0] - t, b[1] - t, 2.0 * t, b[3] + 2.0 * t],
            [b[0] + b[2] - t, b[1] - t, 2.0 * t, b[3] + 2.0 * t],
        ] {
            self.paint(band, ELEMENT);
        }
        self.edge = edge;
    }
}

fn boxes_of<'r>(c: &Ch, a: &'r Record, b: &'r Record) -> impl Iterator<Item = &'r TextBox> {
    let ba = c.i.map(|i| a.runs[i].boxes.as_slice()).unwrap_or_default();
    let bb = c.j.map(|j| b.runs[j].boxes.as_slice()).unwrap_or_default();
    ba.iter().chain(bb)
}

/// Paints the painted element boxes that copy moved (a moved box covers its old and new place) or
/// resized (its border bands and the strip it uncovers), by a copy change's `dw` or `dh`.
fn elements(cov: &mut Cover<'_>, chs: &[Ch], a: &Record, b: &Record, t: &Tolerances) {
    let near = |x: f64, y: f64| (x - y).abs() <= t.move_px;
    let vecs: Vec<(f64, f64)> = chs
        .iter()
        .filter(|c| c.copyish())
        .filter_map(|c| growth(c, a, b).map(|(_, dw, dh)| (dw, dh)))
        .collect();
    if vecs.is_empty() {
        return;
    }
    let by_copy = |v: f64| near(v, 0.0) || vecs.iter().any(|&(dw, dh)| near(v, dw) || near(v, dh));
    let was: HashMap<&str, TextBox> = a.elements.iter().map(|e| (e.path.as_str(), e.bx)).collect();
    for e in &b.elements {
        let Some(&p) = was.get(e.path.as_str()) else {
            continue;
        };
        let q = e.bx;
        let (dx, dy, dw, dh) = (q[0] - p[0], q[1] - p[1], q[2] - p[2], q[3] - p[3]);
        if [dx, dy, dw, dh].iter().all(|&v| near(v, 0.0)) {
            continue;
        }
        if near(dw, 0.0) && near(dh, 0.0) {
            if by_copy(dx) && by_copy(dy) {
                cov.paint(p, ELEMENT);
                cov.paint(q, ELEMENT);
            }
        } else if by_copy(dw) && by_copy(dh) && near(dx, 0.0) && near(dy, 0.0) {
            cov.bands(p);
            cov.bands(q);
            let e = cov.edge;
            if !near(dh, 0.0) {
                let y = (p[1] + p[3]).min(q[1] + q[3]) - e;
                cov.paint([p[0], y, p[2].max(q[2]), dh.abs() + 2.0 * e], ELEMENT);
            }
            if !near(dw, 0.0) {
                let x = (p[0] + p[2]).min(q[0] + q[2]) - e;
                cov.paint([x, p[1], dw.abs() + 2.0 * e, p[3].max(q[3])], ELEMENT);
            }
        }
    }
}

/// The capture's own box: a render that grew or shrank by a copy change's `dw` (or `dh`) explains
/// the strip only one image has. Image sizes are whole pixels, so a growth is matched within 1px
/// more than `movePx`.
fn frame(
    cov: &mut Cover<'_>,
    chs: &[Ch],
    a: &Record,
    b: &Record,
    t: &Tolerances,
    base: (usize, usize),
    cur: (usize, usize),
) {
    let vecs: Vec<(f64, f64)> = chs
        .iter()
        .filter(|c| c.copyish())
        .filter_map(|c| growth(c, a, b).map(|(_, dw, dh)| (dw, dh)))
        .collect();
    let by_copy = |d: f64| {
        vecs.iter()
            .any(|&(dw, dh)| (d - dw).abs() < 1.0 + t.move_px || (d - dh).abs() < 1.0 + t.move_px)
    };
    let (dw, dh) = (cur.0 as f64 - base.0 as f64, cur.1 as f64 - base.1 as f64);
    let (w0, h0) = (base.0.min(cur.0), base.1.min(cur.1));
    let (w, h) = (cov.w, cov.h);
    if dw != 0.0 && by_copy(dw) {
        for y in 0..h {
            for x in w0..w {
                cov.c[y * w + x] |= ELEMENT;
            }
        }
    }
    if dh != 0.0 && by_copy(dh) {
        for y in h0..h {
            for x in 0..w {
                cov.c[y * w + x] |= ELEMENT;
            }
        }
    }
}

/// Changed pixels outside every change's widened boxes, inside them, and (of the outside ones)
/// those a painted element box moved by copy explains.
pub(super) fn count(
    chs: &[Ch],
    a: &Record,
    b: &Record,
    px: Pixels<'_>,
    t: &Tolerances,
) -> (usize, usize, usize) {
    let Pixels::Mask { w, h, m, base, cur } = px else {
        return (0, 0, 0);
    };
    let mut cov = Cover {
        w,
        h,
        m,
        c: vec![0; w * h],
        edge: t.edge_px,
    };
    for c in chs {
        for &bx in boxes_of(c, a, b) {
            cov.paint(bx, TEXT);
        }
    }
    elements(&mut cov, chs, a, b, t);
    frame(&mut cov, chs, a, b, t, base, cur);
    let (mut outside, mut inside, mut element) = (0, 0, 0);
    for (k, &on) in cov.m.iter().enumerate().take(w * h) {
        if on == 0 {
            continue;
        }
        let c = cov.c[k];
        if c & TEXT != 0 {
            inside += 1;
        } else {
            outside += 1;
            if c & ELEMENT != 0 {
                element += 1;
            }
        }
    }
    (outside, inside, element)
}

/// Drops each change none of whose own boxes holds a changed pixel (text under a dialog, or
/// whitespace that draws nothing), but keeps a copy change that pushed a drawn one, and the
/// change that pushed it, and so on.
pub(super) fn drop_undrawn(chs: &mut Vec<Ch>, a: &Record, b: &Record, px: Pixels<'_>) {
    let drawn = |bx: &TextBox| match px {
        Pixels::Unchanged => false,
        Pixels::Mask { w, h, m, .. } => {
            let clamp = |v: f64, max: usize| (v.max(0.0) as usize).min(max);
            let (x0, x1) = (clamp(bx[0].floor(), w), clamp((bx[0] + bx[2]).ceil(), w));
            (clamp(bx[1].floor(), h)..clamp((bx[1] + bx[3]).ceil(), h))
                .any(|y| m[y * w + x0..y * w + x1].iter().any(|&v| v != 0))
        }
    };
    let mut keep: Vec<bool> = chs.iter().map(|c| boxes_of(c, a, b).any(drawn)).collect();
    for c in 0..chs.len() {
        if !keep[c] {
            continue;
        }
        let mut k = chs[c].pushed_by;
        while let Some(p) = k.filter(|&p| !keep[p]) {
            keep[p] = true;
            k = chs[p].pushed_by;
        }
    }
    let mut at = vec![None; chs.len()];
    let mut n = 0;
    for (c, &kept) in keep.iter().enumerate() {
        if kept {
            at[c] = Some(n);
            n += 1;
        }
    }
    let mut c = 0;
    chs.retain(|_| {
        c += 1;
        keep[c - 1]
    });
    for ch in chs.iter_mut() {
        ch.pushed_by = ch.pushed_by.and_then(|p| at[p]);
    }
}
