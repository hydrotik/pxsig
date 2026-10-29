//! `.psig` files: `cat` (git's textconv), `pack` (spec v1 records into baselines) and `attach`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::io;

// --- .psig: cat / pack -----------------------------------------------------------

pub(super) fn cmd_cat(file: &Path, image: Option<PathBuf>) -> Result<u8> {
    let bytes = std::fs::read(file).with_context(|| format!("reading {}", file.display()))?;
    let header = if pxsig_core::psig::is_psig(&bytes) {
        let p = pxsig_core::psig::decode(&bytes)
            .map_err(|e| anyhow::anyhow!("{}: {e}", file.display()))?;
        if let Some(out) = image {
            let img = p
                .image
                .as_ref()
                .with_context(|| format!("{} has no baseline image", file.display()))?;
            std::fs::write(&out, img).with_context(|| format!("writing {}", out.display()))?;
        }
        p.header
    } else {
        if image.is_some() {
            bail!(
                "{} is a .pxsig.json: it has no baseline image",
                file.display()
            );
        }
        let mut v: Value = serde_json::from_slice(&bytes)
            .with_context(|| format!("{} is not a baseline", file.display()))?;
        if let Value::Object(o) = &mut v {
            o.remove("sig");
        }
        v
    };
    println!("{}", serde_json::to_string_pretty(&header)?);
    Ok(0)
}

#[derive(serde::Deserialize)]
struct PackItem {
    sig: PathBuf,
    out: PathBuf,
    #[serde(default)]
    image: Option<PathBuf>,
    #[serde(default)]
    entry: Option<Value>,
}

fn pack_one(it: &PackItem) -> Result<Value> {
    let raw = std::fs::read(&it.sig).with_context(|| format!("reading {}", it.sig.display()))?;
    let record: pxsig_core::PxsigRecord = serde_json::from_slice(&raw)
        .with_context(|| format!("{} is not a spec v1 record", it.sig.display()))?;
    let image = match &it.image {
        Some(p) => Some(std::fs::read(p).with_context(|| format!("reading {}", p.display()))?),
        None => None,
    };
    io::write_baseline(&it.out, &record, image.as_deref(), it.entry.as_ref(), None)?;
    // Read it back: the packed record and image must equal their sources exactly.
    let back =
        pxsig_core::psig::decode(&std::fs::read(&it.out)?).map_err(|e| anyhow::anyhow!(e))?;
    if serde_json::to_string(&back.record)? != serde_json::to_string(&record)?
        || back.image != image
    {
        bail!("{}: read-back differs from its sources", it.out.display());
    }
    Ok(
        json!({ "out": it.out, "bytes": std::fs::metadata(&it.out)?.len(), "image": image.is_some() }),
    )
}

pub(super) fn cmd_pack(
    sig: Option<PathBuf>,
    out: Option<PathBuf>,
    image: Option<PathBuf>,
    entry: Option<String>,
    plan: Option<PathBuf>,
    as_json: bool,
) -> Result<u8> {
    use rayon::prelude::*;
    let items: Vec<PackItem> = match (plan, sig) {
        (Some(p), None) => serde_json::from_slice(
            &std::fs::read(&p).with_context(|| format!("reading {}", p.display()))?,
        )?,
        (None, Some(sig)) => {
            let out = out.context("--out is required")?;
            let entry = entry
                .map(|e| serde_json::from_str(&e))
                .transpose()
                .context("--entry is not JSON")?;
            vec![PackItem {
                sig,
                out,
                image,
                entry,
            }]
        }
        _ => bail!("give a record and --out, or --plan"),
    };
    let t0 = std::time::Instant::now();
    let res: Vec<(usize, Result<Value>)> = items
        .par_iter()
        .enumerate()
        .map(|(i, it)| (i, pack_one(it)))
        .collect();
    let errors: Vec<String> = res
        .iter()
        .filter_map(|(i, r)| {
            r.as_ref()
                .err()
                .map(|e| format!("{}: {e:#}", items[*i].sig.display()))
        })
        .collect();
    let bytes: u64 = res
        .iter()
        .filter_map(|(_, r)| r.as_ref().ok())
        .map(|v| v["bytes"].as_u64().unwrap_or(0))
        .sum();
    let summary = json!({ "packed": items.len() - errors.len(), "failed": errors.len(), "bytes": bytes, "elapsedMs": t0.elapsed().as_secs_f64() * 1000.0 });
    if as_json {
        println!("{}", json!({ "summary": summary, "errors": errors }));
    } else {
        println!(
            "[pxsig] packed {} of {} ({} bytes)",
            items.len() - errors.len(),
            items.len(),
            bytes
        );
        for e in &errors {
            eprintln!("  {e}");
        }
    }
    Ok(if errors.is_empty() { 0 } else { 2 })
}

pub(super) fn cmd_attach(psig: &Path, png: &Path, as_json: bool) -> Result<u8> {
    let p = pxsig_core::psig::decode(
        &std::fs::read(psig).with_context(|| format!("reading {}", psig.display()))?,
    )
    .map_err(|e| anyhow::anyhow!("{}: {e}", psig.display()))?;
    if p.image.is_some() {
        bail!(
            "{} already has a baseline image: refusing to replace it",
            psig.display()
        );
    }
    let img = std::fs::read(png).with_context(|| format!("reading {}", png.display()))?;
    io::decode_png_bytes(&img, png)?; // must be a readable PNG
                                      // Every top-level key this version does not own (`env`, or one a later version added) is kept.
    let extra = pxsig_core::psig::extras(&p.header);
    io::write_baseline(
        psig,
        &p.record,
        Some(&img),
        p.header.get("entry"),
        Some(&extra),
    )?;
    let back = pxsig_core::psig::decode(&std::fs::read(psig)?).map_err(|e| anyhow::anyhow!(e))?;
    if back.sig != p.sig
        || serde_json::to_string(&back.record)? != serde_json::to_string(&p.record)?
    {
        bail!("{}: signature changed on attach", psig.display());
    }
    if pxsig_core::psig::extras(&back.header) != extra {
        bail!("{}: header keys changed on attach", psig.display());
    }
    if as_json {
        println!("{}", json!({ "attached": psig, "bytes": img.len() }));
    } else {
        println!(
            "[pxsig] attached {} ({} bytes) to {}",
            png.display(),
            img.len(),
            psig.display()
        );
    }
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::batch;

    #[test]
    fn attach_keeps_every_header_key_it_does_not_own() {
        let d = std::env::temp_dir().join(format!("pxsig-attach-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let png = d.join("a.png");
        let px: Vec<u8> = (0..16 * 16)
            .flat_map(|i| [(i % 251) as u8, 30, 90, 255])
            .collect();
        io::encode_png_pub(&png, 16, 16, &px).unwrap();
        // A signature-only baseline that records an environment and a key from a later version.
        let sig = d.join("a.psig");
        let mut extra = serde_json::Map::new();
        extra.insert("env".into(), json!({ "v": 1, "id": "1111222233334444" }));
        extra.insert("later".into(), json!(true));
        let rec =
            batch::capture_png(&png, &d.join("tmp.pxsig.json"), 16, false, None, None).unwrap();
        io::write_baseline(&sig, &rec, None, Some(&json!({ "id": "a" })), Some(&extra)).unwrap();
        cmd_attach(&sig, &png, true).unwrap();
        let h = pxsig_core::psig::header(&std::fs::read(&sig).unwrap()).unwrap();
        assert_eq!(h["env"]["id"], json!("1111222233334444"));
        assert_eq!(h["later"], json!(true));
        assert_eq!(h["entry"]["id"], json!("a"));
        assert!(h["sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == json!("image")));
        let _ = std::fs::remove_dir_all(&d);
    }
}
