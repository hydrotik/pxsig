//! `pairs` and `rerecord`: a `.psig`'s record against its own baseline image.
//!
//! A baseline holds two things a person approves together: the record (the signature the gate
//! reads) and the baseline image (what the dashboard shows). `pairs` captures each baseline's image
//! as `capture` would, at the record's own grid, and says whether it has the record's `sha256`: a
//! pair from two different renders reads `match: false`. `rerecord` writes a record again from its
//! own image (the grid policy and detail setting of the entry, as `baseline` resolves them), and
//! keeps the image, the masks, every other header key and every other section byte for byte. It
//! refuses a file whose bytes are not the ones the caller planned (`expect`), one without an image,
//! and one whose pair already matches. With `--png-dir`, `pairs` also hashes each entry's latest
//! render and the image pixel for pixel (`latestPixels`, `pixels`), so a caller can tell a
//! render that is the baseline image, whatever its PNG encoding. Neither command approves or
//! changes a gate.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use pxsig_core::{detail_of, signature_of, DetailParams, PxsigRecord};

use crate::batch::{self, Entry, Manifest};
use crate::io;

fn file_sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The sha256 `capture` gives an image at `grid` (the signature bytes' hash).
fn image_sha(img: &[u8], grid: usize, label: &Path) -> Result<String> {
    let (data, w, h) = io::decode_png_bytes(img, label)?;
    Ok(signature_of(&data, w, h, grid).sha256)
}

/// The sha256 of an image's pixels as the engine reads them (8-bit RGBA) and its size: equal for
/// two PNGs of the same pixels, whatever their encoding.
fn pixels_sha(data: &[u8], w: usize, h: usize) -> String {
    let mut d = Sha256::new();
    d.update((w as u32).to_le_bytes());
    d.update((h as u32).to_le_bytes());
    d.update(data);
    d.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// What one pair is read from: a baseline (`.psig`, or a spec v1 `.pxsig.json` record), and the
/// image to hold it against (a PNG file; else the `.psig`'s own image).
#[derive(Deserialize)]
struct PairSource {
    id: String,
    sig: PathBuf,
    #[serde(default)]
    image: Option<PathBuf>,
}

/// One pair: `match` is null when there is no image (nothing to compare). With a render folder,
/// `latestPixels` is the entry's render's pixel hash (null without a render).
fn pair_of(src: &PairSource, png_dir: Option<&Path>) -> Result<Value> {
    let path = &src.sig;
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let (record, own) = if pxsig_core::psig::is_psig(&bytes) {
        let p = pxsig_core::psig::decode(&bytes).map_err(|x| anyhow!("{}: {x}", path.display()))?;
        (p.record, p.image)
    } else {
        let r: PxsigRecord = serde_json::from_slice(&bytes)
            .with_context(|| format!("{} is not a baseline", path.display()))?;
        (r, None)
    };
    let img = match &src.image {
        Some(png) => {
            Some(std::fs::read(png).with_context(|| format!("reading {}", png.display()))?)
        }
        None => own,
    };
    let grid = record.config.grid;
    let (image, pixels) = match &img {
        Some(img) => {
            let (data, w, h) = io::decode_png_bytes(img, path)?;
            (
                Some(signature_of(&data, w, h, grid).sha256),
                // Only beside a render folder: hashing every pixel is most of the cost.
                png_dir.map(|_| pixels_sha(&data, w, h)),
            )
        }
        None => (None, None),
    };
    let mut v = json!({
        "id": src.id,
        "file": file_sha(&bytes),
        "record": record.sha256,
        "image": image,
        "pixels": pixels,
        "grid": grid,
        "match": image.as_ref().map(|s| *s == record.sha256),
    });
    if let Some(dir) = png_dir {
        let png = dir.join(format!("{}.png", src.id));
        v["latestPixels"] = match png.is_file() {
            // A render that does not decode is no render this image can be.
            true => json!(io::decode_png(&png)
                .ok()
                .map(|(d, w, h)| pixels_sha(&d, w, h))),
            false => Value::Null,
        };
    }
    Ok(v)
}

/// The manifest's `.psig` entries (on disk), with `only` applied.
fn psig_entries(m: &Manifest, root: &Path, only: Option<&str>) -> Result<Vec<PairSource>> {
    let only = batch::parse_only(only)?;
    Ok(m.stories
        .iter()
        .filter(|e| only.as_ref().is_none_or(|o| o.contains(&e.id)))
        .filter(|e| io::is_psig_path(Path::new(&e.sig)) && root.join(&e.sig).is_file())
        .map(|e| PairSource {
            id: e.id.clone(),
            sig: root.join(&e.sig),
            image: None,
        })
        .collect())
}

/// A manifest, read as `load_manifest` reads it, except that one with no stories is no error here.
fn read_manifest(path: &Path) -> Result<Manifest> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("manifest not found: {}", path.display()))?;
    serde_json::from_str(&raw).context("manifest is not valid JSON")
}

/// What `pairs` reads: a manifest's baselines, or a plan's `[{ id, sig, image? }]`.
pub(super) struct PairsArgs<'a> {
    pub manifest: Option<&'a Path>,
    pub plan: Option<&'a Path>,
    pub root: Option<PathBuf>,
    pub only: Option<&'a str>,
    pub png_dir: Option<&'a Path>,
}

pub(super) fn cmd_pairs(a: PairsArgs) -> Result<u8> {
    let t0 = Instant::now();
    let root = a.root.unwrap_or_else(|| PathBuf::from("."));
    let sources: Vec<PairSource> = match (a.manifest, a.plan) {
        (Some(m), None) => psig_entries(&read_manifest(m)?, &root, a.only)?,
        (None, Some(p)) => {
            let items: Vec<PairSource> = serde_json::from_slice(
                &std::fs::read(p).with_context(|| format!("reading {}", p.display()))?,
            )
            .context("--plan is not [{ id, sig, image? }]")?;
            items
                .into_iter()
                .map(|x| PairSource {
                    sig: root.join(&x.sig),
                    image: x.image.map(|i| root.join(i)),
                    ..x
                })
                .collect()
        }
        _ => bail!("give --manifest or --plan"),
    };
    let rows: Vec<Value> = sources
        .par_iter()
        .map(|x| {
            pair_of(x, a.png_dir)
                .unwrap_or_else(|e| json!({ "id": x.id, "error": format!("{e:#}") }))
        })
        .collect();
    let count = |f: &dyn Fn(&Value) -> bool| rows.iter().filter(|r| f(r)).count();
    let summary = json!({
        "baselines": rows.len(),
        "mismatched": count(&|r| r["match"] == json!(false)),
        "noImage": count(&|r| r["match"].is_null() && r["error"].is_null()),
        "errors": count(&|r| !r["error"].is_null()),
        "elapsedMs": t0.elapsed().as_secs_f64() * 1000.0,
    });
    println!("{}", json!({ "summary": summary, "results": rows }));
    Ok(0)
}

#[derive(Deserialize)]
struct PlanItem {
    id: String,
    /// The file's sha256 when the caller planned the write.
    expect: String,
}

/// Write one entry's record again from its own image; the before / after of file and record.
fn rerecord_one(m: &Manifest, e: &Entry, root: &Path, expect: &str) -> Result<Value> {
    let path = root.join(&e.sig);
    let bytes = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
    let before = file_sha(&bytes);
    if before != expect {
        bail!("the baseline changed since it was planned: nothing written");
    }
    let p = pxsig_core::psig::decode(&bytes).map_err(|x| anyhow!("{}: {x}", path.display()))?;
    let img = p
        .image
        .as_deref()
        .context("no baseline image: nothing to record from")?;
    if image_sha(img, p.record.config.grid, &path)? == p.record.sha256 {
        bail!("the record already matches its image: nothing written");
    }
    // The entry's capture settings, as `baseline` resolves them.
    let max_grid = e.grid.or(m.grid).unwrap_or(64).clamp(8, 256);
    let min_cell = if e.grid.is_some() {
        None
    } else {
        m.min_cell_px
    };
    let (data, w, h) = io::decode_png_bytes(img, &path)?;
    let grid = batch::grid_for(w, h, max_grid, min_cell);
    let s = signature_of(&data, w, h, grid);
    let mut record = PxsigRecord::from_signature(&s, &p.record.source, &io::iso_now());
    if e.detail.or(m.detail).unwrap_or(true) {
        record.detail = Some(detail_of(&data, w, h, DetailParams::default()).to_record());
    }
    let extra = pxsig_core::psig::extras(&p.header);
    io::write_baseline(
        &path,
        &record,
        Some(img),
        p.header.get("entry"),
        Some(&extra),
        &p.sections,
    )?;
    // Read back: the image, every other header key and section exactly as they were.
    let out = std::fs::read(&path)?;
    let back = pxsig_core::psig::decode(&out).map_err(|x| anyhow!(x))?;
    if back.image.as_deref() != Some(img)
        || pxsig_core::psig::extras(&back.header) != extra
        || back.sections != p.sections
        || back.header.get("entry") != p.header.get("entry")
    {
        bail!("{}: read-back differs outside the record", path.display());
    }
    if image_sha(img, back.record.config.grid, &path)? != back.record.sha256 {
        bail!(
            "{}: the new record does not match its image",
            path.display()
        );
    }
    Ok(json!({
        "id": e.id,
        "before": before,
        "after": file_sha(&out),
        "recordBefore": p.record.sha256,
        "recordAfter": back.record.sha256,
        "grid": back.record.config.grid,
    }))
}

pub(super) fn cmd_rerecord(manifest: &Path, root: Option<PathBuf>, plan: &Path) -> Result<u8> {
    let m = batch::load_manifest(manifest)?;
    let root = root.unwrap_or_else(|| PathBuf::from("."));
    let items: Vec<PlanItem> = serde_json::from_slice(
        &std::fs::read(plan).with_context(|| format!("reading {}", plan.display()))?,
    )
    .context("--plan is not [{ id, expect }]")?;
    let rows: Vec<Value> = items
        .par_iter()
        .map(|it| {
            let r = match m.stories.iter().find(|e| e.id == it.id) {
                Some(e) if io::is_psig_path(Path::new(&e.sig)) => {
                    rerecord_one(&m, e, &root, &it.expect)
                }
                Some(_) => Err(anyhow!("not a .psig baseline")),
                None => Err(anyhow!("not in the manifest")),
            };
            r.unwrap_or_else(|x| json!({ "id": it.id, "error": format!("{x:#}") }))
        })
        .collect();
    let failed = rows.iter().filter(|r| !r["error"].is_null()).count();
    println!(
        "{}",
        json!({ "summary": { "written": rows.len() - failed, "failed": failed }, "results": rows })
    );
    Ok(if failed == 0 { 0 } else { 2 })
}

#[cfg(test)]
#[path = "cmd_pairs_tests.rs"]
mod tests;
