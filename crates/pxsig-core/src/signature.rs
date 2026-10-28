//! Signature construction: box-average downsample (alpha-flattened onto white),
//! grayscale, perceptual hashes, and sha256 (docs/spec.md §2).

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};

use crate::hash::{a_hash, d_hash};

pub struct Signature {
    /// `grid*grid*3` row-major RGB bytes.
    pub sig: Vec<u8>,
    /// `grid*grid` luminance values.
    pub gray: Vec<f64>,
    pub grid: usize,
    pub ahash: String,
    pub dhash: String,
    pub sha256: String,
    pub src_width: u32,
    pub src_height: u32,
}

/// Box-average an RGBA image (row-major, 4 bytes/px, `data.len() == w*h*4`) down
/// to `grid × grid` RGB, flattening alpha onto white (`c·α + 255·(1−α)`).
pub fn downsample(data: &[u8], w: usize, h: usize, grid: usize) -> Vec<u8> {
    let mut out = vec![0u8; grid * grid * 3];
    for gy in 0..grid {
        let y0 = gy * h / grid;
        let y1 = ((gy + 1) * h / grid).max(y0 + 1);
        for gx in 0..grid {
            let x0 = gx * w / grid;
            let x1 = ((gx + 1) * w / grid).max(x0 + 1);
            let (mut r, mut g, mut b, mut n) = (0f64, 0f64, 0f64, 0f64);
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = (y * w + x) * 4;
                    let a = data[i + 3] as f64 / 255.0;
                    r += data[i] as f64 * a + 255.0 * (1.0 - a);
                    g += data[i + 1] as f64 * a + 255.0 * (1.0 - a);
                    b += data[i + 2] as f64 * a + 255.0 * (1.0 - a);
                    n += 1.0;
                }
            }
            let o = (gy * grid + gx) * 3;
            out[o] = (r / n).round() as u8;
            out[o + 1] = (g / n).round() as u8;
            out[o + 2] = (b / n).round() as u8;
        }
    }
    out
}

/// Luminance grid (`0.299R + 0.587G + 0.114B`) from an RGB signature.
pub fn to_gray(sig: &[u8], grid: usize) -> Vec<f64> {
    (0..grid * grid)
        .map(|i| {
            let o = i * 3;
            0.299 * sig[o] as f64 + 0.587 * sig[o + 1] as f64 + 0.114 * sig[o + 2] as f64
        })
        .collect()
}

/// Build a full signature (sig + gray + hashes + sha256) from decoded RGBA.
pub fn signature_of(data: &[u8], w: usize, h: usize, grid: usize) -> Signature {
    let sig = downsample(data, w, h, grid);
    let gray = to_gray(&sig, grid);
    let mut hasher = Sha256::new();
    hasher.update(&sig);
    let sha256 = hex(&hasher.finalize());
    Signature {
        ahash: a_hash(&gray, grid),
        dhash: d_hash(&gray, grid),
        sha256,
        src_width: w as u32,
        src_height: h as u32,
        sig,
        gray,
        grid,
    }
}

pub fn encode_sig(sig: &[u8]) -> String {
    STANDARD.encode(sig)
}

pub fn decode_sig(b64: &str) -> Result<Vec<u8>, base64::DecodeError> {
    STANDARD.decode(b64)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

#[cfg(test)]
mod golden {
    use super::*;

    /// A `w×h` RGBA pattern with every channel and alpha varying, so rounding and the alpha
    /// flattening both show.
    fn pattern(w: usize, h: usize) -> Vec<u8> {
        let mut d = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                d[i] = ((x * 7 + y * 3) % 256) as u8;
                d[i + 1] = ((x * 2 + y * 11) % 256) as u8;
                d[i + 2] = ((x * y) % 256) as u8;
                d[i + 3] = (255 - (x + y) % 128) as u8;
            }
        }
        d
    }

    #[test]
    fn downsample_127_by_65_to_16() {
        let d = downsample(&pattern(127, 65), 127, 65, 16);
        assert_eq!(d.len(), 16 * 16 * 3);
        assert_eq!(&d[..12], &[29, 27, 9, 86, 48, 27, 143, 69, 45, 197, 90, 63]);
        assert_eq!(&d[d.len() - 6..], &[226, 164, 143, 102, 180, 140]);
        assert_eq!(d.iter().map(|&x| u64::from(x)).sum::<u64>(), 120901);
        let s = signature_of(&pattern(127, 65), 127, 65, 16);
        assert_eq!(
            s.sha256,
            "5c3d7d15bf1b19670de0c52d72726027d69494712e643bcc4ea7da8b8ad5ed03"
        );
        assert_eq!(s.ahash, "1e72871cfc8d3cf0");
        assert_eq!(s.dhash, "fef096b4b5a529e8");
        assert_eq!((s.src_width, s.src_height, s.grid), (127, 65, 16));
    }

    #[test]
    fn downsample_1_by_1() {
        // Half-transparent (α 128) over white: c·α + 255·(1−α), rounded.
        let one = [10u8, 20, 30, 128];
        assert_eq!(downsample(&one, 1, 1, 1), [132, 137, 142]);
        // A grid larger than the image repeats the one pixel in every cell.
        assert_eq!(downsample(&one, 1, 1, 4), [132, 137, 142].repeat(16));
        let s = signature_of(&one, 1, 1, 8);
        assert_eq!(
            s.sha256,
            "fcf77dc95796288a4c29bcfb7b1859f100e1f3cfe4b3f87c701ae38bc33b46d8"
        );
        assert_eq!(s.ahash, "ffffffffffffffff");
        assert_eq!(s.dhash, "0000000000000000");
    }

    #[test]
    fn encode_sig_and_decode_sig_round_trip() {
        let sig = downsample(&pattern(127, 65), 127, 65, 16);
        let b64 = encode_sig(&sig);
        assert_eq!(decode_sig(&b64).unwrap(), sig);
        assert_eq!(encode_sig(&[]), "");
        assert_eq!(encode_sig(&[132, 137, 142]), "hImO");
        assert_eq!(decode_sig("hImO").unwrap(), [132, 137, 142]);
        assert!(decode_sig("not base64!").is_err());
    }
}
