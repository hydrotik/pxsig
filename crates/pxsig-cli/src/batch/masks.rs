//! The masks of a render: `<id>.masks.json` beside `<id>.png`, written by the capture when a mask
//! applied (packages/pxsig/src/lib/capture/masks.mjs). A baseline written from that render keeps
//! the record as its header's `masks` (docs/spec.md, section 5). `check` compares the render's
//! masks with its baseline's: a mask added, removed or grown is "masks changed", a change for a
//! person to approve, never a pass. A mask over a quarter of the capture is a warning.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::{json, Map, Value};

use crate::io;

/// A mask over more than this share of the capture is a warning (`masksLarge`).
pub const LARGE: f64 = 0.25;
/// A mask whose share of the capture grew by more than this has grown.
const GREW: f64 = 0.001;
/// Where a mask may come from.
const SOURCES: [&str; 4] = ["attribute", "story", "project", "workspace"];

/// The masks record that belongs to a render: `<dir>/<id>.masks.json` beside `<dir>/<id>.png`,
/// when the file exists.
pub fn beside(png: &Path) -> Option<PathBuf> {
    let f = png.with_extension("masks.json");
    f.is_file().then_some(f)
}

/// The bytes of a render's masks record for a cache key (a marker when there is none).
pub fn key(png: &Path) -> Vec<u8> {
    let rec = beside(png).and_then(|f| fs::read(f).ok());
    rec.map_or_else(
        || b"\0masks:none".to_vec(),
        |r| [b"\0masks:".as_slice(), &r].concat(),
    )
}

/// The render's masks as a baseline header keeps them, `{ v: 1, masks: [{ selector, source,
/// reason?, area }] }`, `area` being the masked pixels' share of the PNG (after trim), to 4
/// decimals. None without a record; a record that does not read is an error, so a baseline never
/// stores what is not one.
pub fn record(png: &Path) -> Result<Option<Value>> {
    let Some(file) = beside(png) else {
        return Ok(None);
    };
    // Named by its file name only: the message reaches the dashboard, and a full path names the user.
    let name = io::file_name(&file);
    let raw = fs::read(&file).with_context(|| format!("reading {name}"))?;
    let v: Value = serde_json::from_slice(&raw).with_context(|| format!("{name} is not JSON"))?;
    let list = match (v.get("v"), v.get("masks")) {
        (Some(ver), Some(Value::Array(m))) if ver == &json!(1) => m,
        _ => bail!("{name} is not a masks record (v 1 with masks)"),
    };
    let (_, w, h) = io::png_size(png)?;
    let total = (w * h).max(1) as f64;
    let masks = list
        .iter()
        .map(|m| {
            let (Some(sel), Some(src), Some(px)) = (
                m["selector"].as_str(),
                m["source"].as_str().filter(|s| SOURCES.contains(s)),
                m["px"].as_f64(),
            ) else {
                bail!("{name}: each mask needs a selector, a source and px");
            };
            let mut o = Map::new();
            o.insert("selector".into(), json!(sel));
            o.insert("source".into(), json!(src));
            if let Some(r) = m["reason"].as_str() {
                o.insert("reason".into(), json!(r));
            }
            let area = ((px / total).min(1.0) * 10_000.0).round() / 10_000.0;
            o.insert("area".into(), json!(area));
            Ok(Value::Object(o))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(json!({ "v": 1, "masks": masks })))
}

fn list(v: Option<&Value>) -> Vec<Value> {
    v.and_then(|v| v["masks"].as_array())
        .cloned()
        .unwrap_or_default()
}

fn area_of(l: &[Value], sel: &str) -> Option<f64> {
    l.iter()
        .find(|m| m["selector"] == sel)
        .map(|m| m["area"].as_f64().unwrap_or(0.0))
}

fn selectors(l: &[Value]) -> impl Iterator<Item = &str> {
    l.iter().filter_map(|m| m["selector"].as_str())
}

/// What changed from the baseline's masks (`base`, its header's `masks`) to the render's (`cur`):
/// `{ added, removed, grew }`, selectors; None when nothing did. A selector is a mask's identity:
/// its source and reason are labels. A baseline without `masks` had none recorded: story masks
/// (`ignore`) are older than the record, so against it they are left out, and upgrading pxsig
/// changes no entry.
pub fn changes(base: Option<&Value>, cur: Option<&Value>) -> Option<Value> {
    let old = list(base);
    let mut new = list(cur);
    if base.is_none() {
        new.retain(|m| m["source"] != "story");
    }
    let added: Vec<&str> = selectors(&new)
        .filter(|s| area_of(&old, s).is_none())
        .collect();
    let removed: Vec<&str> = selectors(&old)
        .filter(|s| area_of(&new, s).is_none())
        .collect();
    let grew: Vec<&str> = selectors(&new)
        .filter(|s| match (area_of(&old, s), area_of(&new, s)) {
            (Some(a), Some(b)) => b > a + GREW,
            _ => false,
        })
        .collect();
    if added.is_empty() && removed.is_empty() && grew.is_empty() {
        return None;
    }
    Some(json!({ "added": added, "removed": removed, "grew": grew }))
}

/// The masks over `LARGE` of the capture: `[{ selector, source, area }]`.
pub fn large(cur: Option<&Value>) -> Vec<Value> {
    list(cur)
        .into_iter()
        .filter(|m| m["area"].as_f64().unwrap_or(0.0) > LARGE)
        .map(|m| json!({ "selector": m["selector"], "source": m["source"], "area": m["area"] }))
        .collect()
}

/// The reason a row gets for a mask change: `masks changed: 1 added, 1 grew`.
pub fn reason(ch: &Value) -> String {
    let parts: Vec<String> = ["added", "removed", "grew"]
        .iter()
        .filter_map(|k| {
            let n = ch[*k].as_array().map_or(0, Vec::len);
            (n > 0).then(|| format!("{n} {k}"))
        })
        .collect();
    format!("masks changed: {}", parts.join(", "))
}

/// Add the render's masks to a checked row: `masks` (when any), `masksLarge` (when any is over
/// `LARGE`), and on a change `masksChanged`, a failing verdict and its reason.
pub fn annotate(v: &mut Value, png: &Path, base: Option<&Value>) -> Result<()> {
    let cur = record(png)?;
    if let Some(c) = &cur {
        v["masks"] = c["masks"].clone();
    }
    let big = large(cur.as_ref());
    if !big.is_empty() {
        v["masksLarge"] = json!(big);
    }
    if let Some(ch) = changes(base, cur.as_ref()) {
        let mut reasons: Vec<Value> = v["reasons"].as_array().cloned().unwrap_or_default();
        reasons.push(json!(reason(&ch)));
        let note: Vec<&str> = reasons.iter().filter_map(Value::as_str).collect();
        v["note"] = json!(note.join("; "));
        v["reasons"] = json!(reasons);
        v["masksChanged"] = ch;
        v["pass"] = json!(false);
    }
    Ok(())
}
