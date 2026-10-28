//! Structural metrics: windowed SSIM and the Sobel edge-map delta (docs/spec.md §3).

/// Mean SSIM over 8×8 windows (stride 4) on two grayscale grids.
pub fn ssim(a: &[f64], b: &[f64], grid: usize) -> f64 {
    let c1 = (0.01 * 255.0f64).powi(2);
    let c2 = (0.03 * 255.0f64).powi(2);
    let win = 8.min(grid);
    let stride = (win / 2).max(1);
    let (mut total, mut count) = (0f64, 0f64);
    let mut y = 0;
    while y + win <= grid {
        let mut x = 0;
        while x + win <= grid {
            let (mut sa, mut sb, mut saa, mut sbb, mut sab) = (0f64, 0f64, 0f64, 0f64, 0f64);
            let nn = (win * win) as f64;
            for wy in 0..win {
                for wx in 0..win {
                    let i = (y + wy) * grid + (x + wx);
                    let (va, vb) = (a[i], b[i]);
                    sa += va;
                    sb += vb;
                    saa += va * va;
                    sbb += vb * vb;
                    sab += va * vb;
                }
            }
            let ma = sa / nn;
            let mb = sb / nn;
            let va = saa / nn - ma * ma;
            let vb = sbb / nn - mb * mb;
            let cov = sab / nn - ma * mb;
            let s = ((2.0 * ma * mb + c1) * (2.0 * cov + c2))
                / ((ma * ma + mb * mb + c1) * (va + vb + c2));
            total += s;
            count += 1.0;
            x += stride;
        }
        y += stride;
    }
    if count > 0.0 {
        total / count
    } else {
        1.0
    }
}

/// Sobel gradient-magnitude map (edge strength per cell).
pub fn sobel(gray: &[f64], grid: usize) -> Vec<f64> {
    let g = grid as isize;
    let at = |x: isize, y: isize| -> f64 {
        let xx = x.clamp(0, g - 1) as usize;
        let yy = y.clamp(0, g - 1) as usize;
        gray[yy * grid + xx]
    };
    let mut mag = vec![0f64; grid * grid];
    for y in 0..g {
        for x in 0..g {
            let gx = -at(x - 1, y - 1) - 2.0 * at(x - 1, y) - at(x - 1, y + 1)
                + at(x + 1, y - 1)
                + 2.0 * at(x + 1, y)
                + at(x + 1, y + 1);
            let gy = -at(x - 1, y - 1) - 2.0 * at(x, y - 1) - at(x + 1, y - 1)
                + at(x - 1, y + 1)
                + 2.0 * at(x, y + 1)
                + at(x + 1, y + 1);
            mag[(y as usize) * grid + x as usize] = gx.hypot(gy);
        }
    }
    mag
}

/// Mean absolute Sobel-magnitude difference, normalised to a 0–100 percentage.
pub fn edge_diff_pct(a: &[f64], b: &[f64], grid: usize) -> f64 {
    let ea = sobel(a, grid);
    let eb = sobel(b, grid);
    let max = 4.0 * 255.0;
    let sum: f64 = ea.iter().zip(eb.iter()).map(|(x, y)| (x - y).abs()).sum();
    (sum / ea.len() as f64 / max) * 100.0
}

#[cfg(test)]
mod golden {
    use super::*;

    fn grids(grid: usize) -> (Vec<f64>, Vec<f64>) {
        let a: Vec<f64> = (0..grid * grid).map(|i| ((i * 37) % 256) as f64).collect();
        let b: Vec<f64> = a
            .iter()
            .enumerate()
            .map(|(i, v)| if i % 5 == 0 { 255.0 - v } else { *v })
            .collect();
        (a, b)
    }

    /// (grid, ssim, edge delta, Sobel magnitude of cell 0), recorded from the engine as it is.
    /// Grid 4 is below the 8-cell window; 33 leaves a column no window covers.
    const GOLDEN: [(usize, f64, f64, f64); 4] = [
        (4, 0.4715797147118954, 15.790413401109587, 610.2196325914138),
        (
            8,
            0.5687230003300919,
            15.516134716311713,
            217.95412361320444,
        ),
        (16, 0.580636430405843, 15.608048876030582, 352.5677239907249),
        (33, 0.6038166420207886, 14.617780119378809, 801.77802414384),
    ];

    #[test]
    fn ssim_and_edge_give_the_recorded_numbers() {
        for (g, want_ssim, want_edge, want_sobel) in GOLDEN {
            let (a, b) = grids(g);
            let s = ssim(&a, &b, g);
            let e = edge_diff_pct(&a, &b, g);
            assert!((s - want_ssim).abs() < 1e-9, "grid {g}: ssim {s}");
            assert!((e - want_edge).abs() < 1e-9, "grid {g}: edge {e}");
            assert!(
                (sobel(&a, g)[0] - want_sobel).abs() < 1e-9,
                "grid {g}: sobel"
            );
            assert_eq!(ssim(&a, &a, g), 1.0, "grid {g}: a grid against itself");
            assert_eq!(edge_diff_pct(&a, &a, g), 0.0);
        }
    }
}
