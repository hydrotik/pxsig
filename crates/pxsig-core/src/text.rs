//! Text-aware labels: what changed in the text a render draws, from the baseline's and the render's
//! text records (`<id>.boxes.json`, the `.psig`'s `boxes` section) and the changed-pixel mask.
//! Labels only: nothing here is read by the gate, a verdict or an exit code.
//!
//! The steps: runs are aligned (`align`), each pair and each unpaired run becomes a change (`same`
//! runs are none), a moved run is credited to the nearest preceding copy change whose growth
//! explains its move (`push`), painted element boxes moved by that growth explain their pixels,
//! every changed pixel is inside a change's boxes (widened by `edgePx`) or outside them, a change
//! with no changed pixel in its own boxes is dropped (but a copy change that pushed a drawn one is
//! kept), and the entry gets the first kind that applies: `pixel`, `restyled`, `moved`,
//! `copy-reflow`, `copy`, or none.

use serde::{Deserialize, Serialize};
use serde_json::Value;

mod align;
mod paint;

/// A box in the screenshot's frame, CSS px at DPR 1: `[x, y, width, height]`.
pub type TextBox = [f64; 4];

/// A text record, version 1 (`packages/pxsig/src/types/text.d.ts`). Fields this step does not
/// read are not kept.
#[derive(Debug, Clone, Deserialize)]
pub struct Record {
    pub v: u32,
    #[serde(default)]
    pub styles: Vec<Value>,
    pub runs: Vec<Run>,
    #[serde(default)]
    pub elements: Vec<Element>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Run {
    pub path: String,
    #[serde(default)]
    pub key: Option<String>,
    pub s: String,
    pub st: usize,
    pub boxes: Vec<TextBox>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Element {
    pub path: String,
    #[serde(rename = "box")]
    pub bx: TextBox,
}

impl Record {
    /// A text record from its JSON: version 1, with runs. A run without a box draws nothing here
    /// and is left out.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let mut r: Self =
            serde_json::from_slice(bytes).map_err(|e| format!("not a text record: {e}"))?;
        if r.v != 1 {
            return Err(format!("text record version {} is not supported", r.v));
        }
        r.runs.retain(|run| !run.boxes.is_empty());
        Ok(r)
    }
}

/// How far a box may move and still be in place (`movePx`), how far around a run's boxes a changed
/// pixel still belongs to it (`edgePx`), and how many changed pixels outside text a text kind still
/// allows (`noisePx`). Labels only.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tolerances {
    pub move_px: f64,
    pub edge_px: f64,
    pub noise_px: u64,
}

impl Default for Tolerances {
    fn default() -> Self {
        Self {
            move_px: 0.5,
            edge_px: 2.0,
            noise_px: 0,
        }
    }
}

/// The changed pixels between the baseline image and the render.
#[derive(Debug, Clone, Copy)]
pub enum Pixels<'a> {
    /// No pixel changed (an identical render).
    Unchanged,
    /// `w*h`, non-zero where a pixel changed (`pixeldiff::PixelDiff::mask`), and the two images'
    /// sizes (`base`, `cur`): where they differ, a strip only one image has counts as changed.
    Mask {
        w: usize,
        h: usize,
        m: &'a [u8],
        base: (usize, usize),
        cur: (usize, usize),
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    Copy,
    Moved,
    Rewrapped,
    Restyled,
    Added,
    Removed,
}

/// One change, as the row lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub kind: ChangeKind,
    /// The baseline's string (a copy change).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub was: Option<String>,
    /// The render's string (a copy change).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub now: Option<String>,
    /// The string (any other change).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub s: Option<String>,
    /// A copy change equal after collapsing whitespace.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub whitespace: bool,
    /// The font facts that differ (a restyle, or a copy change whose style changed too).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub facts: Vec<&'static str>,
    /// The move of its first box (a moved, rewrapped, restyled or pushed copy run).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dx: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dy: Option<f64>,
    /// Moved by a copy change's growth.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pushed: bool,
    /// That copy change's index in `changes`, when it is listed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pushed_by: Option<usize>,
    /// More runs moved the same way by the same push, folded into this change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub same: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub path: String,
    /// Its first box: the render's, or the baseline's for a removed run.
    #[serde(rename = "box")]
    pub bx: TextBox,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub runs: usize,
    pub copy: usize,
    pub moved: usize,
    pub rewrapped: usize,
    pub restyled: usize,
    pub added: usize,
    pub removed: usize,
}

/// The entry's kind, first that applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Pixel,
    Restyled,
    Moved,
    CopyReflow,
    Copy,
}

/// A compared entry (`textDiff` with `state: "compared"`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compared {
    pub kind: Option<Kind>,
    pub kinds: Vec<ChangeKind>,
    pub counts: Counts,
    /// Changed pixels outside every change's widened boxes.
    pub outside_px: usize,
    /// Changed pixels inside them.
    pub inside_px: usize,
    /// Of `outside_px`, those a painted element box (or the capture's own box) moved or resized by
    /// copy explains.
    pub element_px: usize,
    /// The first [`MAX_CHANGES`], largest first.
    pub changes: Vec<Change>,
    /// Every change (after folding), listed or not.
    pub change_count: usize,
    /// Either record hit the capture's cap: runs past it are not compared.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

/// The most changes a row lists.
pub const MAX_CHANGES: usize = 20;

/// The font facts compared, in report order.
pub const FACTS: [&str; 13] = [
    "family",
    "size",
    "weight",
    "style",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "transform",
    "decoration",
    "color",
    "features",
    "variation",
    "loaded",
];

/// Whether anything in the text differs at all (a pair not in place, a string, a style, a run
/// added or removed), before pixels are looked at: a passing render needs its pixel diff only then.
pub fn differs(a: &Record, b: &Record, t: &Tolerances) -> bool {
    !align::changes(a, b, t).is_empty()
}

/// Classify the text changes between a baseline record `a` and a render's record `b`.
pub fn classify(a: &Record, b: &Record, px: Pixels<'_>, t: &Tolerances) -> Compared {
    let mut chs = align::changes(a, b, t);
    align::push(&mut chs, a, b, t);
    let (outside, inside, element) = paint::count(&chs, a, b, px, t);
    paint::drop_undrawn(&mut chs, a, b, px);
    let mut counts = Counts {
        runs: b.runs.len(),
        ..Counts::default()
    };
    for c in &chs {
        *match c.kind {
            ChangeKind::Copy => &mut counts.copy,
            ChangeKind::Moved => &mut counts.moved,
            ChangeKind::Rewrapped => &mut counts.rewrapped,
            ChangeKind::Restyled => &mut counts.restyled,
            ChangeKind::Added => &mut counts.added,
            ChangeKind::Removed => &mut counts.removed,
        } += 1;
    }
    let copyish = counts.copy + counts.added + counts.removed > 0;
    let restyled = chs.iter().any(|c| {
        c.kind == ChangeKind::Restyled || (c.kind == ChangeKind::Copy && !c.facts.is_empty())
    });
    let unpushed = chs.iter().any(|c| c.moves() && c.pushed_by.is_none());
    let pushed = chs.iter().any(|c| c.pushed_by.is_some()) || element > 0;
    let kind = if outside - element > t.noise_px as usize {
        Some(Kind::Pixel)
    } else if restyled {
        Some(Kind::Restyled)
    } else if unpushed {
        Some(Kind::Moved)
    } else if copyish && pushed {
        Some(Kind::CopyReflow)
    } else if copyish {
        Some(Kind::Copy)
    } else {
        None
    };
    let mut kinds: Vec<ChangeKind> = chs.iter().map(|c| c.kind).collect();
    kinds.sort();
    kinds.dedup();
    let changes = align::listed(&chs, a, b, t);
    Compared {
        kind,
        kinds,
        counts,
        outside_px: outside,
        inside_px: inside,
        element_px: element,
        change_count: changes.len(),
        changes: changes.into_iter().take(MAX_CHANGES).collect(),
        truncated: a.truncated || b.truncated,
    }
    .relink()
}

impl Compared {
    /// `pushed_by` holds an index into the full list; past the cap it is left out.
    fn relink(mut self) -> Self {
        let n = self.changes.len();
        for c in &mut self.changes {
            c.pushed_by = c.pushed_by.filter(|&i| i < n);
        }
        self
    }
}

/// Round to 0.01px, as the record does.
pub(crate) fn r2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[cfg(test)]
#[path = "text_tests.rs"]
mod tests;
