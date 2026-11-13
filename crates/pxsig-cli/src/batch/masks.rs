//! The masks of a render: `<id>.masks.json` beside `<id>.png`, written by the capture when a mask
//! applied (packages/pxsig/src/lib/capture/masks.mjs). A baseline written from that render keeps
//! the record as its header's `masks`, `{ v: 1, masks: [] }` when none applied (docs/spec.md,
//! section 5). `check` compares the render's masks with its baseline's: a mask added, removed,
//! grown, moved or matching another number of elements is "masks changed", a change for a person
//! to approve, never a pass. All masks over a quarter of the capture warn; over half, or on the
//! story root, fail the entry and no baseline is written from it.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::{json, Map, Value};

use crate::io;

/// Masks over more than this share of the capture, together, are a warning (`masksCoverage`).
/// One mask over it is listed in `masksLarge`.
pub const LARGE: f64 = 0.25;
/// Masks over more than this share of the capture, together, fail the entry (`masksBlocked`), and
/// no approval clears it: only smaller masks do.
pub const LIMIT: f64 = 0.5;
/// A mask the capture found on the story root covers it from this share of the capture on.
const ROOT: f64 = 0.95;
/// A box may differ by this many pixels on a side (rounding) and still be the same box.
const SLACK: f64 = 1.0;
/// What the capture paints a mask with (`maskShot`, `#FF00FF`), and how far a pixel may be from it.
const PAINT: [u8; 3] = [255, 0, 255];
const PAINT_TOL: u8 = 8;
/// Where a mask may come from.
const SOURCES: [&str; 4] = ["attribute", "story", "project", "workspace"];
/// What the capture can find wrong with a mask, and the reason each gives (`problems`): a
/// `data-volatile` element with element children of its own, one with no reason, and an element
/// a mask matched that the capture could not measure (so it would be painted unweighed).
const PROBLEMS: [(&str, &str); 3] = [
    ("container", "mask on a container"),
    ("reason", "mask needs a reason"),
    ("unmeasured", "mask not measured"),
];

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

/// The boxes `[x0, y0, x1, y1]` clipped to `w` × `h` and rounded to whole pixels, empty ones left
/// out. Trim keeps a capture's top-left corner, so clipping the capture's boxes to the trimmed
/// size leaves exactly the masked pixels that are still in the image.
fn clip(rects: &[[f64; 4]], w: f64, h: f64) -> Vec<[f64; 4]> {
    rects
        .iter()
        .map(|b| {
            [
                b[0].round().clamp(0.0, w),
                b[1].round().clamp(0.0, h),
                b[2].round().clamp(0.0, w),
                b[3].round().clamp(0.0, h),
            ]
        })
        .filter(|b| b[2] > b[0] && b[3] > b[1])
        .collect()
}

/// Pixels the (clipped) boxes cover, counted once where they overlap.
fn covered(r: &[[f64; 4]]) -> f64 {
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

/// A mask's boxes, `rects` (`[[x0, y0, x1, y1]]`): None when missing or not boxes.
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

/// A share of the capture, 0..1 to 4 decimals.
fn share(px: f64, total: f64) -> f64 {
    ((px / total).min(1.0) * 10_000.0).round() / 10_000.0
}

/// The render's masks as a baseline header keeps them, `{ v: 1, masks: [{ selector, source,
/// reason?, area, count, px, rects, root? }], coverage }`. `rects` are the mask's boxes inside the
/// PNG as it is compared (after trim), `px` the pixels they cover and `area` that share of the PNG,
/// to 4 decimals; `coverage` is the share every mask covers together. `root`: the capture found the
/// mask on the story root. None without a record; a record that does not read is an error, so a
/// baseline never stores what is not one, and a check never weighs it.
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
    let (w, h) = (w as f64, h as f64);
    let total = (w * h).max(1.0);
    let mut all = Vec::new();
    let masks = list
        .iter()
        .map(|m| {
            let (Some(sel), Some(src), Some(count), Some(boxes)) = (
                m["selector"].as_str(),
                m["source"].as_str().filter(|s| SOURCES.contains(s)),
                m["count"].as_u64(),
                rects(m),
            ) else {
                bail!("{name}: each mask needs a selector, a source, a count and rects");
            };
            let root = match m.get("root") {
                None => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => bail!("{name}: a mask's root is true or false"),
            };
            let boxes = clip(&boxes, w, h);
            let px = covered(&boxes);
            all.extend_from_slice(&boxes);
            let mut o = Map::new();
            o.insert("selector".into(), json!(sel));
            o.insert("source".into(), json!(src));
            if let Some(r) = m["reason"].as_str() {
                o.insert("reason".into(), json!(r));
            }
            o.insert("area".into(), json!(share(px, total)));
            o.insert("count".into(), json!(count));
            o.insert("px".into(), json!(px as u64));
            let whole: Vec<[i64; 4]> = boxes.iter().map(|b| b.map(|n| n as i64)).collect();
            o.insert("rects".into(), json!(whole));
            if root {
                o.insert("root".into(), json!(true));
            }
            Ok(Value::Object(o))
        })
        .collect::<Result<Vec<_>>>()?;
    let coverage = share(covered(&all), total);
    let mut out = json!({ "v": 1, "masks": masks, "coverage": coverage });
    if let Some(p) = v.get("problems") {
        let ok = p.as_array().is_some_and(|l| {
            l.iter()
                .all(|x| PROBLEMS.iter().any(|(k, _)| x["kind"] == *k) && x["element"].is_string())
        });
        if !ok {
            bail!("{name}: each problem needs a known kind and an element");
        }
        out["problems"] = p.clone();
    }
    Ok(Some(out))
}

/// The header a render with no masks record gets: no mask applied. Every baseline records its
/// masks, so a mask added later is always "masks changed".
pub fn none() -> Value {
    json!({ "v": 1, "masks": [] })
}

fn list(v: Option<&Value>) -> Vec<Value> {
    v.and_then(|v| v["masks"].as_array())
        .cloned()
        .unwrap_or_default()
}

fn find<'a>(l: &'a [Value], sel: &str) -> Option<&'a Value> {
    l.iter().find(|m| m["selector"] == sel)
}

fn selectors(l: &[Value]) -> impl Iterator<Item = &str> {
    l.iter().filter_map(|m| m["selector"].as_str())
}

/// The mask covers more than before, by any amount: its pixels, or (a header written before they
/// were kept) its area.
fn grew(old: &Value, new: &Value) -> bool {
    match (old["px"].as_f64(), new["px"].as_f64()) {
        (Some(a), Some(b)) => b > a,
        _ => new["area"].as_f64().unwrap_or(0.0) > old["area"].as_f64().unwrap_or(0.0),
    }
}

/// The same boxes, each side within `SLACK`, in any order. A header without boxes cannot show
/// that, so it never does.
fn same_boxes(old: &Value, new: &Value) -> bool {
    let (Some(mut a), Some(mut b)) = (rects(old), rects(new)) else {
        return false;
    };
    if a.len() != b.len() {
        return false;
    }
    let order = |x: &[f64; 4], y: &[f64; 4]| {
        x.iter()
            .zip(y)
            .map(|(p, q)| p.total_cmp(q))
            .find(|o| o.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    };
    a.sort_by(order);
    b.sort_by(order);
    a.iter()
        .zip(&b)
        .all(|(x, y)| x.iter().zip(y).all(|(p, q)| (p - q).abs() <= SLACK))
}

/// The baseline image shows the mask's boxes painted: every pixel inside each box, a pixel in
/// from its edges (an edge can be part covered), within `PAINT_TOL` of `PAINT`. A box outside the
/// image, too small to have an inside, or no boxes at all: not shown.
fn painted(img: &(Vec<u8>, usize, usize), m: &Value) -> bool {
    let (data, w, h) = img;
    let Some(boxes) = rects(m).filter(|b| !b.is_empty()) else {
        return false;
    };
    boxes.iter().all(|b| {
        let (x0, y0) = (b[0].round() as i64 + 1, b[1].round() as i64 + 1);
        let (x1, y1) = (b[2].round() as i64 - 1, b[3].round() as i64 - 1);
        if x0 >= x1 || y0 >= y1 || x0 < 0 || y0 < 0 || x1 > *w as i64 || y1 > *h as i64 {
            return false;
        }
        (y0..y1).all(|y| {
            (x0..x1).all(|x| {
                let i = (y as usize * w + x as usize) * 4;
                (0..3).all(|c| data[i + c].abs_diff(PAINT[c]) <= PAINT_TOL)
            })
        })
    })
}

/// What changed from the baseline's masks (`base`, its header's `masks`) to the render's (`cur`):
/// `{ added, removed, grew, moved, count }`, selectors; None when nothing did. A selector is a
/// mask's identity: its source and reason are labels. `grew`: it covers any pixel more; `moved`:
/// a box differs by more than a pixel on a side; `count`: it matches another number of elements.
///
/// A baseline without `masks` was written before every baseline recorded them (0.7.6 and earlier,
/// when only story masks existed, painted `PAINT`). Against it, a story mask is left out only where
/// the baseline image (`base_image`) shows it painted: one it does not show is "added".
pub fn changes(
    base: Option<&Value>,
    cur: Option<&Value>,
    base_image: Option<&[u8]>,
) -> Option<Value> {
    let old = list(base);
    let mut new = list(cur);
    if base.is_none() && new.iter().any(|m| m["source"] == "story") {
        let img = base_image.and_then(|b| io::decode_png_bytes(b, Path::new("baseline")).ok());
        new.retain(|m| !(m["source"] == "story" && img.as_ref().is_some_and(|i| painted(i, m))));
    }
    let both = |f: &dyn Fn(&Value, &Value) -> bool| -> Vec<&str> {
        selectors(&new)
            .filter(|s| match (find(&old, s), find(&new, s)) {
                (Some(a), Some(b)) => f(a, b),
                _ => false,
            })
            .collect()
    };
    let added: Vec<&str> = selectors(&new)
        .filter(|s| find(&old, s).is_none())
        .collect();
    let removed: Vec<&str> = selectors(&old)
        .filter(|s| find(&new, s).is_none())
        .collect();
    let grown = both(&grew);
    let count = both(&|a, b| a["count"].as_u64().is_none() || a["count"] != b["count"]);
    let moved: Vec<&str> = both(&|a, b| !same_boxes(a, b))
        .into_iter()
        .filter(|s| !count.contains(s))
        .collect();
    if [&added, &removed, &grown, &moved, &count]
        .iter()
        .all(|l| l.is_empty())
    {
        return None;
    }
    Some(
        json!({ "added": added, "removed": removed, "grew": grown, "moved": moved, "count": count }),
    )
}

/// The masks over `LARGE` of the capture each: `[{ selector, source, area }]`.
pub fn large(cur: Option<&Value>) -> Vec<Value> {
    list(cur)
        .into_iter()
        .filter(|m| m["area"].as_f64().unwrap_or(0.0) > LARGE)
        .map(|m| json!({ "selector": m["selector"], "source": m["source"], "area": m["area"] }))
        .collect()
}

/// A share as a whole percent, with a decimal where the whole number would read as the limit.
fn pct(x: f64, limit: f64) -> String {
    let p = x * 100.0;
    if p.round() == limit * 100.0 && x > limit {
        format!("{p:.1}%")
    } else {
        format!("{p:.0}%")
    }
}

/// What no approval can pass: `{ coverage?, root?, problems? }`, when the masks together cover
/// more than `LIMIT` of the capture (`coverage`, their share), one covers the story root (`root`,
/// selectors: the capture found it there and it covers `ROOT` of the capture), or the capture
/// found a mask it may not apply as asked (`problems`, as the record has them). None otherwise.
pub fn blocked(cur: Option<&Value>) -> Option<Value> {
    let cur = cur?;
    let mut out = Map::new();
    if let Some(p) = cur["problems"].as_array().filter(|p| !p.is_empty()) {
        out.insert("problems".into(), json!(p));
    }
    let coverage = cur["coverage"].as_f64().unwrap_or(0.0);
    if coverage > LIMIT {
        out.insert("coverage".into(), json!(coverage));
    }
    let root: Vec<&Value> = cur["masks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["root"] == json!(true) && m["area"].as_f64().unwrap_or(0.0) >= ROOT)
        .map(|m| &m["selector"])
        .collect();
    if !root.is_empty() {
        out.insert("root".into(), json!(root));
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

/// The reasons a blocked row gets: `mask on a container: …`, `masks cover 62% of the capture, over
/// 50%`, `a mask covers the story root: #storybook-root > *`.
pub fn blocked_reasons(b: &Value) -> Vec<String> {
    let mut out: Vec<String> = b["problems"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let (_, word) = PROBLEMS.iter().find(|(k, _)| p["kind"] == *k)?;
            Some(format!("{word}: {}", p["element"].as_str().unwrap_or("")))
        })
        .collect();
    if let Some(c) = b["coverage"].as_f64() {
        out.push(format!(
            "masks cover {} of the capture, over {:.0}%",
            pct(c, LIMIT),
            LIMIT * 100.0
        ));
    }
    let root: Vec<&str> = b["root"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if !root.is_empty() {
        out.push(format!("a mask covers the story root: {}", root.join(", ")));
    }
    out
}

/// The fix for each cause of a block (lib/mask-words.mjs says the same).
pub fn blocked_fixes(b: &Value) -> Vec<&'static str> {
    let p = b["problems"].as_array();
    let has = |k: &str| p.is_some_and(|p| p.iter().any(|x| x["kind"] == k));
    let root = b["root"].as_array().is_some_and(|r| !r.is_empty());
    [
        (
            has("container"),
            "put data-volatile on the element that shows the value (a leaf)",
        ),
        (
            has("reason"),
            "give data-volatile a reason, e.g. data-volatile=\"relative time\"",
        ),
        (
            has("unmeasured"),
            "mask at most 500 elements, all there when the story is ready",
        ),
        (b["coverage"].is_number(), "make the masks smaller"),
        (root, "mask the value, not the story root"),
    ]
    .into_iter()
    .filter_map(|(on, fix)| on.then_some(fix))
    .collect()
}

/// The kinds of change, and how a reason words each.
const KINDS: [(&str, &str); 5] = [
    ("added", "added"),
    ("removed", "removed"),
    ("grew", "grew"),
    ("moved", "moved"),
    ("count", "changed count"),
];

/// The reason a row gets for a mask change: `masks changed: 1 added, 1 grew`.
pub fn reason(ch: &Value) -> String {
    let parts: Vec<String> = KINDS
        .iter()
        .filter_map(|(k, word)| {
            let n = ch[*k].as_array().map_or(0, Vec::len);
            (n > 0).then(|| format!("{n} {word}"))
        })
        .collect();
    format!("masks changed: {}", parts.join(", "))
}

/// A change with its selectors, for a refusal: `1 added: .a; 2 grew: .b, .c`.
pub fn describe(ch: &Value) -> String {
    KINDS
        .iter()
        .filter_map(|(k, word)| {
            let s: Vec<&str> = ch[*k]
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .collect();
            (!s.is_empty()).then(|| format!("{} {word}: {}", s.len(), s.join(", ")))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Add a failing reason to a checked row.
fn fail(v: &mut Value, why: String) {
    let mut reasons: Vec<Value> = v["reasons"].as_array().cloned().unwrap_or_default();
    reasons.push(json!(why));
    let note: Vec<&str> = reasons.iter().filter_map(Value::as_str).collect();
    v["note"] = json!(note.join("; "));
    v["reasons"] = json!(reasons);
    v["pass"] = json!(false);
}

/// Add the render's masks to a checked row: `masks` and `masksCoverage` (when any), `masksLarge`
/// (each mask over `LARGE`), on a change `masksChanged`, `masksBaseline` (the baseline's masks, so
/// a reviewer sees both), a failing verdict and its reason; and over the limits `masksBlocked`, a
/// failing verdict and its reasons, whatever the baseline. `base` is the baseline header's
/// `masks`, `base_image` its image (for a baseline without `masks`). `check` and the single-entry
/// `compare` both call it, so the two never disagree.
pub fn annotate(
    v: &mut Value,
    png: &Path,
    base: Option<&Value>,
    base_image: Option<&[u8]>,
) -> Result<()> {
    let cur = record(png)?;
    if let Some(c) = &cur {
        v["masks"] = c["masks"].clone();
        v["masksCoverage"] = c["coverage"].clone();
    }
    let big = large(cur.as_ref());
    if !big.is_empty() {
        v["masksLarge"] = json!(big);
    }
    if let Some(ch) = changes(base, cur.as_ref(), base_image) {
        fail(v, reason(&ch));
        v["masksChanged"] = ch;
        v["masksBaseline"] = json!(list(base));
    }
    if let Some(b) = blocked(cur.as_ref()) {
        for why in blocked_reasons(&b) {
            fail(v, why);
        }
        v["masksBlocked"] = b;
    }
    Ok(())
}

/// Refuse a baseline no approval may write (`blocked`, naming each cause and its fix), or a
/// `.pxsig.json` one (`psig` false) from a render with masks; else the `.psig` header's `masks`.
pub fn for_baseline(png: &Path, psig: bool) -> Result<Option<Value>> {
    let cur = record(png)?;
    if let Some(b) = blocked(cur.as_ref()) {
        bail!(
            "{}: no approval writes this baseline; {}",
            blocked_reasons(&b).join("; "),
            blocked_fixes(&b).join("; ")
        );
    }
    if !psig {
        if cur.as_ref().is_some_and(|c| !list(Some(c)).is_empty()) {
            bail!("a .pxsig.json baseline cannot record masks: write a .psig baseline");
        }
        return Ok(None);
    }
    Ok(Some(cur.unwrap_or_else(none)))
}
