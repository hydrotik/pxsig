//! Content trimming: crop a render to its content so the signature grid lands on
//! the component instead of empty canvas.
//!
//! Storybook's `#storybook-root` fills the viewport, so most renders were the full
//! 868×600 with a small component in the top-left — the 64×64 grid then spent most
//! of its cells on background, and the inspector opened zoomed out on emptiness.
//!
//! Only the **right and bottom** are trimmed. The top-left origin is kept, so a
//! layout shift (content moving right or down) still moves pixels relative to the
//! frame and stays detectable. The background is the bottom-right pixel; a column
//! or row is content when any pixel differs from it by more than `tolerance`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrimBox {
    pub width: usize,
    pub height: usize,
}

/// The kept size for an RGBA image: content extent + `pad`, never larger than the image.
pub fn content_box(data: &[u8], w: usize, h: usize, tolerance: u8, pad: usize) -> TrimBox {
    if w == 0 || h == 0 {
        return TrimBox { width: w, height: h };
    }
    let bg = &data[((h - 1) * w + (w - 1)) * 4..][..4];
    let differs = |i: usize| (0..4).any(|c| data[i + c].abs_diff(bg[c]) > tolerance);
    let (mut max_x, mut max_y) = (0usize, 0usize);
    let mut any = false;
    for y in 0..h {
        let row = y * w * 4;
        // Rightmost differing pixel in this row, if any.
        if let Some(x) = (0..w).rev().find(|&x| differs(row + x * 4)) {
            any = true;
            max_x = max_x.max(x);
            max_y = y;
        }
    }
    if !any {
        return TrimBox { width: w.min(pad.max(1)), height: h.min(pad.max(1)) };
    }
    TrimBox { width: (max_x + 1 + pad).min(w), height: (max_y + 1 + pad).min(h) }
}

/// Crop RGBA to `b` (top-left anchored).
pub fn crop(data: &[u8], w: usize, b: TrimBox) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.width * b.height * 4);
    for y in 0..b.height {
        out.extend_from_slice(&data[y * w * 4..y * w * 4 + b.width * 4]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(w: usize, h: usize, dots: &[(usize, usize)]) -> Vec<u8> {
        let mut d = vec![20u8; w * h * 4];
        for &(x, y) in dots {
            d[(y * w + x) * 4] = 250;
        }
        d
    }

    #[test]
    fn keeps_origin_and_trims_right_bottom() {
        let d = img(100, 80, &[(10, 5), (30, 40)]);
        assert_eq!(content_box(&d, 100, 80, 8, 4), TrimBox { width: 35, height: 45 });
    }

    #[test]
    fn content_at_the_edge_keeps_full_size() {
        let d = img(50, 50, &[(48, 48)]);
        assert_eq!(content_box(&d, 50, 50, 8, 16), TrimBox { width: 50, height: 50 });
    }

    #[test]
    fn crop_takes_the_top_left() {
        let d = img(4, 3, &[(1, 1)]);
        let c = crop(&d, 4, TrimBox { width: 2, height: 2 });
        assert_eq!(c.len(), 16);
        // Pixel (1, 1) of the 2-wide crop: index (y * width + x) * 4.
        assert_eq!(c[3 * 4], 250);
    }
}
