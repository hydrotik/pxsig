//! Perceptual hashes (aHash / dHash) + Hamming distance (docs/spec.md §2).

/// Box resize of a grayscale grid to `n × n`.
pub fn gray_resize(gray: &[f64], grid: usize, n: usize) -> Vec<f64> {
    let mut out = vec![0f64; n * n];
    for y in 0..n {
        for x in 0..n {
            let x0 = x * grid / n;
            let x1 = ((x + 1) * grid / n).max(x0 + 1);
            let y0 = y * grid / n;
            let y1 = ((y + 1) * grid / n).max(y0 + 1);
            let (mut s, mut c) = (0f64, 0f64);
            for yy in y0..y1 {
                for xx in x0..x1 {
                    s += gray[yy * grid + xx];
                    c += 1.0;
                }
            }
            out[y * n + x] = s / c;
        }
    }
    out
}

fn bits_to_hex(bits: &[u8]) -> String {
    let mut hex = String::with_capacity(bits.len() / 4);
    let mut i = 0;
    while i + 3 < bits.len() {
        let nib = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
        hex.push(char::from_digit(nib as u32, 16).unwrap());
        i += 4;
    }
    hex
}

/// 64-bit average hash → 16 hex chars.
pub fn a_hash(gray: &[f64], grid: usize) -> String {
    let s = gray_resize(gray, grid, 8);
    let mean = s.iter().sum::<f64>() / s.len() as f64;
    let bits: Vec<u8> = s.iter().map(|&v| u8::from(v >= mean)).collect();
    bits_to_hex(&bits)
}

/// 64-bit difference hash → 16 hex chars.
pub fn d_hash(gray: &[f64], grid: usize) -> String {
    let s = gray_resize(gray, grid, 9);
    let mut bits = Vec::with_capacity(64);
    for y in 0..8 {
        for x in 0..8 {
            bits.push(u8::from(s[y * 9 + x + 1] > s[y * 9 + x]));
        }
    }
    bits_to_hex(&bits)
}

/// Hamming distance between two equal-length hex strings (bit differences).
pub fn hamming(a: &str, b: &str) -> u32 {
    if a.len() != b.len() {
        return (a.len().max(b.len()) * 4) as u32;
    }
    a.chars()
        .zip(b.chars())
        .map(|(ca, cb)| {
            let xa = ca.to_digit(16).unwrap_or(0);
            let xb = cb.to_digit(16).unwrap_or(0);
            (xa ^ xb).count_ones()
        })
        .sum()
}
