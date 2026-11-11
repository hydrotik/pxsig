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

/// Pixels the boxes `[x0, y0, x1, y1]` cover inside `w` × `h`, counted once where they overlap.
/// Trim keeps a capture's top-left corner, so clipping the capture's boxes to the trimmed size
/// leaves exactly the masked pixels that are still in the image.
fn covered(rects: &[[f64; 4]], w: f64, h: f64) -> f64 {
    let r: Vec<[f64; 4]> = rects
        .iter()
        .map(|b| {
            [
                b[0].clamp(0.0, w),
                b[1].clamp(0.0, h),
                b[2].clamp(0.0, w),
                b[3].clamp(0.0, h),
            ]
        })
        .filter(|b| b[2] > b[0] && b[3] > b[1])
        .collect();
    let mut xs: Vec<f64> = r.iter().flat_map(|b| [b[0], b[2]]).collect();
    xs.sort_by(f64::total_cmp);
    xs.dedup();
    let mut px = 0.0;
    for x in xs.windows(2) {
        let mut spans: Vec<(f64, f64)> = r
            .iter()
            .filter(|b| b[0] <= x[0] && b[2] >= x[1])
            .map(|b| (b[1], b[3]))
            .collect();
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        let (mut cover, mut end) = (0.0, f64::NEG_INFINITY);
        for (y0, y1) in spans {
            if y1 > end {
                cover += y1 - y0.max(end);
                end = y1;
            }
        }
        px += cover * (x[1] - x[0]);
    }
    px
}

/// A mask's boxes, `rects` (`[[x0, y0, x1, y1]]`): None for a record written before them.
fn rects(m: &Value) -> Option<Vec<[f64; 4]>> {
    m["rects"]
        .as_array()?
        .iter()
        .map(|b| {
            let b = b.as_array().filter(|b| b.len() == 4)?;
            let n: Vec<f64> = b.iter().filter_map(Value::as_f64).collect();
            (n.len() == 4).then(|| [n[0], n[1], n[2], n[3]])
        })
        .collect()
}

/// The render's masks as a baseline header keeps them, `{ v: 1, masks: [{ selector, source,
/// reason?, area }] }`, `area` being the masked pixels' share of the PNG, to 4 decimals. Both are
/// of the PNG as it is compared, after trim: the mask's boxes (`rects`) are counted inside it, so
/// a mask that trim cropped away counts only what is left (a record without `rects` falls back
/// to `px`, counted before trim). None without a record; a record that does not read is an
/// error, so a baseline never stores what is not one.
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
            let px = rects(m).map_or(px, |r| covered(&r, w as f64, h as f64));
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
/// `LARGE`), and on a change `masksChanged`, `masksBaseline` (the baseline's masks, so a reviewer
/// sees both), a failing verdict and its reason. `check` and the single-entry `compare` both call
/// it, so the two never disagree.
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
        v["masksBaseline"] = json!(list(base));
        v["pass"] = json!(false);
    }
    Ok(())
}
