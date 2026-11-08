//! A fixture corpus for text-aware checks: small renders whose dark rectangles stand in for glyphs,
//! each with the text record a capture would write beside it (`<id>.boxes.json`). Every case is a
//! baseline render and a current render; the baselines are written by `pxsig baseline`, so a case
//! with text on carries its record as the `.psig`'s `boxes` section, exactly as an approval does.

#![allow(dead_code)]

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub const W: usize = 96;
pub const H: usize = 32;

/// One render: the rectangles it paints (x, y, w, h, grey) and its text runs (string, style index,
/// boxes). Rectangles are whole pixels; boxes may be fractional, as a browser reports them.
#[derive(Clone, Default)]
pub struct Shot {
    pub rects: Vec<(usize, usize, usize, usize, u8)>,
    pub runs: Vec<(&'static str, usize, Vec<[f64; 4]>)>,
    /// A second style (index 1) that differs from style 0 in colour.
    pub red: bool,
}

pub struct Case {
    pub id: &'static str,
    pub base: Shot,
    pub cur: Shot,
}

fn style(color: &str) -> Value {
    json!({ "family": "Inter, sans-serif", "size": 13, "weight": 400, "style": "normal",
        "lineHeight": 18, "letterSpacing": 0, "wordSpacing": 0, "transform": "none",
        "decoration": "none", "color": color, "features": "normal", "variation": "normal",
        "loaded": true })
}

/// The text record of a shot, as `lib/capture/boxes.mjs` writes it (version 1).
pub fn record(s: &Shot) -> Value {
    let runs: Vec<Value> = s
        .runs
        .iter()
        .enumerate()
        .map(|(i, (text, st, boxes))| json!({ "path": format!("0/{i}/#0"), "s": text, "st": st, "boxes": boxes }))
        .collect();
    json!({ "v": 1, "frame": { "w": W, "h": H },
        "styles": [style("rgb(0, 0, 0)"), style(if s.red { "rgb(200, 0, 0)" } else { "rgb(0, 0, 0)" })],
        "runs": runs, "elements": [],
        "skipped": { "iframes": 0, "closedShadow": 0, "hidden": 0, "fields": 0, "ignored": 0,
            "clipped": 0, "covered": 0, "offFrame": 0 },
        "truncated": false })
}

pub fn write_png(path: &Path, s: &Shot) {
    let mut px = vec![255u8; W * H * 4];
    for &(x, y, w, h, g) in &s.rects {
        for yy in y..(y + h).min(H) {
            for xx in x..(x + w).min(W) {
                let i = (yy * W + xx) * 4;
                px[i..i + 3].copy_from_slice(&if g == 0 && s.red {
                    [200, 0, 0]
                } else {
                    [g, g, g]
                });
            }
        }
    }
    let f = fs::File::create(path).unwrap();
    let mut e = png::Encoder::new(std::io::BufWriter::new(f), W as u32, H as u32);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header().unwrap().write_image_data(&px).unwrap();
}

/// A glyph rectangle filling a run's box.
fn glyph(b: [f64; 4]) -> (usize, usize, usize, usize, u8) {
    (
        b[0] as usize,
        b[1] as usize,
        b[2] as usize,
        b[3] as usize,
        0,
    )
}

fn shot(runs: Vec<(&'static str, [f64; 4])>) -> Shot {
    Shot {
        rects: runs.iter().map(|r| glyph(r.1)).collect(),
        runs: runs.into_iter().map(|(s, b)| (s, 0, vec![b])).collect(),
        red: false,
    }
}

/// The corpus: one case per kind, plus a passing entry, an entry whose baseline has no text record,
/// and an entry with no render.
pub fn cases() -> Vec<Case> {
    let total = shot(vec![("Total", [4.0, 4.0, 20.0, 10.0])]);
    let mut pixel = total.clone();
    pixel.rects.push((60, 20, 30, 10, 90));
    let mut copy_cur = shot(vec![("abd", [4.0, 4.0, 18.0, 10.0])]);
    copy_cur.rects.push((16, 6, 4, 4, 255));
    let mut restyled = total.clone();
    restyled.runs[0].1 = 1;
    restyled.red = true;
    vec![
        Case {
            id: "same",
            base: total.clone(),
            cur: total.clone(),
        },
        // #256: the figure "1" gains a trailing space, so its unit moves right by the space.
        Case {
            id: "copy-reflow",
            base: shot(vec![
                ("1", [4.0, 4.0, 6.0, 10.0]),
                ("new", [12.0, 4.0, 18.0, 10.0]),
            ]),
            cur: Shot {
                rects: vec![glyph([4.0, 4.0, 6.0, 10.0]), glyph([16.0, 4.0, 18.0, 10.0])],
                runs: vec![
                    ("1 ", 0, vec![[4.0, 4.0, 10.0, 10.0]]),
                    ("new", 0, vec![[16.0, 4.0, 18.0, 10.0]]),
                ],
                red: false,
            },
        },
        Case {
            id: "copy",
            base: shot(vec![("abc", [4.0, 4.0, 18.0, 10.0])]),
            cur: copy_cur,
        },
        Case {
            id: "pixel",
            base: total.clone(),
            cur: pixel,
        },
        Case {
            id: "restyled",
            base: total.clone(),
            cur: restyled,
        },
        Case {
            id: "moved",
            base: total.clone(),
            cur: shot(vec![("Total", [4.0, 14.0, 20.0, 10.0])]),
        },
        Case {
            id: "no-record",
            base: total.clone(),
            cur: shot(vec![("Totals", [4.0, 4.0, 24.0, 10.0])]),
        },
        Case {
            id: "no-render",
            base: total.clone(),
            cur: total,
        },
    ]
}

pub fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-text-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    for sub in ["base", "cur", "store"] {
        fs::create_dir_all(d.join(sub)).unwrap();
    }
    d
}

pub fn pxsig(dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pxsig"))
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap()
}

/// Writes the corpus into `d`: renders under `base/` and `cur/`, a manifest, and baselines from
/// `base/`. With `text`, each render gets its text record (but `no-record`'s baseline does not,
/// and `no-render` has no current render).
pub fn build(d: &Path, text: bool) -> Vec<&'static str> {
    let cs = cases();
    let stories: Vec<Value> = cs
        .iter()
        .map(|c| json!({ "id": c.id, "sig": format!("store/{}.psig", c.id) }))
        .collect();
    fs::write(d.join("m.json"), json!({ "stories": stories }).to_string()).unwrap();
    for c in &cs {
        write_png(&d.join(format!("base/{}.png", c.id)), &c.base);
        if c.id != "no-render" {
            write_png(&d.join(format!("cur/{}.png", c.id)), &c.cur);
        }
        if text {
            if c.id != "no-record" {
                fs::write(
                    d.join(format!("base/{}.boxes.json", c.id)),
                    record(&c.base).to_string(),
                )
                .unwrap();
            }
            fs::write(
                d.join(format!("cur/{}.boxes.json", c.id)),
                record(&c.cur).to_string(),
            )
            .unwrap();
        }
    }
    let out = pxsig(
        d,
        &[
            "baseline",
            "--manifest",
            "m.json",
            "--png-dir",
            "base",
            "--root",
            ".",
            "--json",
        ],
    );
    assert!(
        out.status.success(),
        "baseline: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    cs.iter().map(|c| c.id).collect()
}

/// `pxsig check` on the current renders: its exit code and its JSON.
pub fn check(d: &Path, extra: &[&str]) -> (i32, Value) {
    let mut args = vec![
        "check",
        "--manifest",
        "m.json",
        "--png-dir",
        "cur",
        "--root",
        ".",
        "--artifacts",
        "none",
        "--json",
    ];
    args.extend_from_slice(extra);
    let out = pxsig(d, &args);
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "check output: {e}: {}",
            String::from_utf8_lossy(&out.stderr)
        )
    });
    (out.status.code().unwrap_or(-1), v)
}

/// The rows of a check, by id.
pub fn rows(v: &Value) -> std::collections::BTreeMap<String, Value> {
    v["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["id"].as_str().unwrap().to_string(), r.clone()))
        .collect()
}
