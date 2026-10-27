//! Full-resolution pixel diff between two renders, for the inspector and the
//! PR summary: changed-pixel count, the changed mask, and the change regions
//! (8px tiles holding a changed pixel, joined 8-way, largest first) — the same
//! algorithm the dashboard runs in the browser, so both agree.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
    /// Changed pixels inside the box.
    pub px: usize,
}

#[derive(Debug, Clone)]
pub struct PixelDiff {
    pub width: usize,
    pub height: usize,
    pub changed: usize,
    pub max_delta: u8,
    /// `width*height`, 1 where the max channel delta exceeds the tolerance.
    pub mask: Vec<u8>,
    pub regions: Vec<Region>,
}

pub const REGION_TILE: usize = 8;

/// Diff two RGBA images. Pixels outside one image (a size change) count as changed.
pub fn pixel_diff(
    a: &[u8],
    aw: usize,
    ah: usize,
    b: &[u8],
    bw: usize,
    bh: usize,
    tolerance: u8,
) -> PixelDiff {
    let (w, h) = (aw.max(bw), ah.max(bh));
    let mut mask = vec![0u8; w * h];
    let (mut changed, mut max_delta) = (0usize, 0u8);
    for y in 0..h {
        for x in 0..w {
            let d = if x < aw && y < ah && x < bw && y < bh {
                let (i, j) = ((y * aw + x) * 4, (y * bw + x) * 4);
                (0..4)
                    .map(|c| a[i + c].abs_diff(b[j + c]))
                    .max()
                    .unwrap_or(0)
            } else {
                255
            };
            max_delta = max_delta.max(d);
            if d > tolerance {
                mask[y * w + x] = 1;
                changed += 1;
            }
        }
    }
    let regions = regions_of(&mask, w, h, REGION_TILE);
    PixelDiff {
        width: w,
        height: h,
        changed,
        max_delta,
        mask,
        regions,
    }
}

/// Connected boxes of changed tiles, sorted by changed pixels (desc), then position.
pub fn regions_of(mask: &[u8], w: usize, h: usize, t: usize) -> Vec<Region> {
    let (tw, th) = (w.div_ceil(t), h.div_ceil(t));
    let mut tiles = vec![false; tw * th];
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] != 0 {
                tiles[(y / t) * tw + x / t] = true;
            }
        }
    }
    let mut seen = vec![false; tw * th];
    let mut out = Vec::new();
    let mut stack = Vec::new();
    for start in 0..tiles.len() {
        if !tiles[start] || seen[start] {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
        while let Some(u) = stack.pop() {
            let (ux, uy) = (u % tw, u / tw);
            x0 = x0.min(ux);
            y0 = y0.min(uy);
            x1 = x1.max(ux);
            y1 = y1.max(uy);
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let (vx, vy) = (ux as i64 + dx, uy as i64 + dy);
                    if vx < 0 || vy < 0 || vx >= tw as i64 || vy >= th as i64 {
                        continue;
                    }
                    let v = vy as usize * tw + vx as usize;
                    if tiles[v] && !seen[v] {
                        seen[v] = true;
                        stack.push(v);
                    }
                }
            }
        }
        let (x, y) = (x0 * t, y0 * t);
        let (rw, rh) = (((x1 + 1) * t).min(w) - x, ((y1 + 1) * t).min(h) - y);
        let mut px = 0;
        for yy in y..y + rh {
            px += mask[yy * w + x..yy * w + x + rw]
                .iter()
                .filter(|&&m| m != 0)
                .count();
        }
        out.push(Region {
            x,
            y,
            w: rw,
            h: rh,
            px,
        });
    }
    out.sort_by(|p, q| q.px.cmp(&p.px).then(p.y.cmp(&q.y)).then(p.x.cmp(&q.x)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_two_separate_regions() {
        let (w, h) = (64, 32);
        let a = vec![200u8; w * h * 4];
        let mut b = a.clone();
        for (x, y) in [(2, 2), (3, 2), (50, 20)] {
            b[(y * w + x) * 4] = 0;
        }
        let d = pixel_diff(&a, w, h, &b, w, h, 16);
        assert_eq!(d.changed, 3);
        assert_eq!(d.regions.len(), 2);
        assert_eq!(
            d.regions[0],
            Region {
                x: 0,
                y: 0,
                w: 8,
                h: 8,
                px: 2
            }
        );
    }

    #[test]
    fn size_change_counts_as_changed() {
        let a = vec![0u8; 8 * 8 * 4];
        let b = vec![0u8; 8 * 10 * 4];
        let d = pixel_diff(&a, 8, 8, &b, 8, 10, 0);
        assert_eq!(d.changed, 16);
    }
}
