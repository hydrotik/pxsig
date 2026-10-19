//! Serde model for the spec v1 record: the body of a `.psig` header, or a standalone
//! `.pxsig.json`. Field names and shapes are fixed by docs/spec.md.

use serde::{Deserialize, Serialize};

pub const SPEC_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecConfig {
    pub grid: usize,
    pub channels: u8,
    pub encoding: String,
    #[serde(rename = "alphaFlatten")]
    pub alpha_flatten: String,
}

impl SpecConfig {
    pub fn for_grid(grid: usize) -> Self {
        Self {
            grid,
            channels: 3,
            encoding: "base64-rgb-row-major".to_string(),
            alpha_flatten: "white".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PxsigRecord {
    pub tool: String,
    pub version: u32,
    pub config: SpecConfig,
    pub source: String,
    #[serde(rename = "srcWidth")]
    pub src_width: u32,
    #[serde(rename = "srcHeight")]
    pub src_height: u32,
    pub ahash: String,
    pub dhash: String,
    pub sha256: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// base64 of `grid*grid*3` row-major RGB bytes.
    pub sig: String,
    /// Optional detail channel. Absent with `--no-detail`, so those records stay
    /// byte-identical to plain spec v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<crate::detail::DetailRecord>,
}

impl PxsigRecord {
    /// Validate the tool tag + spec version and return the grid.
    pub fn validate(&self) -> Result<usize, String> {
        if self.tool != "pxsig" {
            return Err("not a pxsig record".into());
        }
        if self.version != SPEC_VERSION {
            return Err(format!(
                "spec version mismatch (record v{}, tool v{})",
                self.version, SPEC_VERSION
            ));
        }
        let grid = self.config.grid;
        if grid < 8 {
            return Err(format!("invalid grid {grid}"));
        }
        Ok(grid)
    }
}

impl PxsigRecord {
    /// Build the committable record from a signature (JS `toRecord`). The caller
    /// supplies `created_at` so the core stays free of wall-clock reads.
    pub fn from_signature(
        s: &crate::signature::Signature,
        source: &str,
        created_at: &str,
    ) -> Self {
        Self {
            tool: "pxsig".to_string(),
            version: SPEC_VERSION,
            config: SpecConfig::for_grid(s.grid),
            source: source.to_string(),
            src_width: s.src_width,
            src_height: s.src_height,
            ahash: s.ahash.clone(),
            dhash: s.dhash.clone(),
            sha256: s.sha256.clone(),
            created_at: created_at.to_string(),
            sig: crate::signature::encode_sig(&s.sig),
            detail: None,
        }
    }

    /// Validate and decode the raw `grid*grid*3` signature bytes (JS `recordToBaseline`).
    pub fn baseline(&self) -> Result<(usize, Vec<u8>), String> {
        let grid = self.validate()?;
        let sig = crate::signature::decode_sig(&self.sig).map_err(|e| format!("bad sig: {e}"))?;
        if sig.len() != grid * grid * 3 {
            return Err(format!(
                "signature length {} != expected {}",
                sig.len(),
                grid * grid * 3
            ));
        }
        Ok((grid, sig))
    }
}
