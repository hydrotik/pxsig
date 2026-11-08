//! A row's `textDiff`: the render's text record (`<id>.boxes.json` beside its PNG) against its
//! baseline's (the `.psig`'s `boxes` section), classified by `pxsig_core::text`. Labels only:
//! nothing here changes `pass`, the reasons, the gate or an exit code.
//!
//! States: no text record beside the render, no `textDiff` at all (text capture off); the
//! render's environment is not the baseline's (their env ids differ, or either is unknown):
//! `env-differs`, never compared, since text boxes differ across environments by design; the
//! baseline has no text record: `no-baseline`; a record that does not read: `error`; otherwise
//! `compared`.

use std::path::Path;

use pxsig_core::text::{self, Pixels, Record, Tolerances};
use serde_json::{json, Map, Value};

use super::Baseline;

/// The text side of one row, before its pixels are known.
pub enum Text {
    /// The render has no text record: the row gets no `textDiff`.
    Off,
    /// A `textDiff` that needs no pixels (`env-differs`, `no-baseline`, `error`).
    Row(Value),
    /// Both records, to classify.
    Compare(Box<(Record, Record)>),
}

fn state(state: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("v".into(), json!(1));
    m.insert("state".into(), json!(state));
    m
}

/// An `error` `textDiff`.
pub fn failed(msg: &str) -> Value {
    let mut m = state("error");
    m.insert("error".into(), json!(msg));
    Value::Object(m)
}

/// The run manifest's `text` tolerances; a value that is not a number of 0 or more (and, for
/// `noisePx`, whole) keeps its default.
pub fn tolerances(v: Option<&Value>) -> Tolerances {
    let d = Tolerances::default();
    let px = |k: &str| {
        v.and_then(|v| v[k].as_f64())
            .filter(|x| x.is_finite() && *x >= 0.0)
    };
    Tolerances {
        move_px: px("movePx").unwrap_or(d.move_px),
        edge_px: px("edgePx").unwrap_or(d.edge_px),
        noise_px: v.and_then(|v| v["noisePx"].as_u64()).unwrap_or(d.noise_px),
    }
}

/// The text side of a row: the render at `png` (its record beside it), its environment id
/// (`render_env`, from the run's env plan), and its baseline.
pub fn prepare(png: &Path, render_env: Option<&str>, b: &Baseline) -> Text {
    let Some(file) = super::boxes::beside(png) else {
        return Text::Off;
    };
    let base_env = super::env_id(b.env.as_ref());
    if render_env.is_none() || render_env != base_env.as_deref() {
        return Text::Row(Value::Object(state("env-differs")));
    }
    let Some(section) = &b.boxes else {
        return Text::Row(Value::Object(state("no-baseline")));
    };
    // Named by file name only: a row reaches the dashboard, and a full path names the user.
    let name = file
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let cur = match std::fs::read(&file) {
        Ok(bytes) => Record::parse(&bytes).map_err(|e| format!("{name}: {e}")),
        Err(e) => Err(format!("{name}: {e}")),
    };
    let base = section
        .data()
        .and_then(|d| Record::parse(&d))
        .map_err(|e| format!("the baseline's text record: {e}"));
    match (base, cur) {
        (Ok(a), Ok(c)) => Text::Compare(Box::new((a, c))),
        (Err(e), _) | (_, Err(e)) => Text::Row(failed(&e)),
    }
}

impl Text {
    /// Whether this row's label needs a pixel diff it would not otherwise get: the records differ
    /// and the render is not identical.
    pub fn wants_pixels(&self, t: &Tolerances, identical: bool) -> bool {
        match self {
            Text::Compare(p) => !identical && text::differs(&p.0, &p.1, t),
            _ => false,
        }
    }

    /// The row's `textDiff`, if any. `px` is the row's pixel diff (`Pixels::Mask`) when it has
    /// one; `identical` says no pixel changed. Without either, the records do not differ (see
    /// [`Text::wants_pixels`]): the kind is none and no pixel count is given.
    pub fn finish(
        self,
        t: &Tolerances,
        identical: bool,
        mask: Option<Pixels<'_>>,
    ) -> Option<Value> {
        let (a, b) = match self {
            Text::Off => return None,
            Text::Row(v) => return Some(v),
            Text::Compare(p) => *p,
        };
        let px = match mask {
            Some(px) if !identical => px,
            _ => Pixels::Unchanged,
        };
        let measured = identical || mask.is_some();
        let c = text::classify(&a, &b, px, t);
        let mut out = state("compared");
        if let Ok(Value::Object(m)) = serde_json::to_value(c) {
            out.extend(m);
        }
        if !measured {
            for k in ["outsidePx", "insidePx", "elementPx"] {
                out.remove(k);
            }
        }
        Some(Value::Object(out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tolerances_keep_their_defaults_for_a_bad_or_missing_value() {
        assert_eq!(tolerances(None), Tolerances::default());
        let t = tolerances(Some(&json!({ "movePx": 1, "edgePx": -1, "noisePx": 1.5 })));
        assert_eq!((t.move_px, t.edge_px, t.noise_px), (1.0, 2.0, 0));
        let t = tolerances(Some(&json!({ "movePx": "x", "edgePx": 3, "noisePx": 7 })));
        assert_eq!((t.move_px, t.edge_px, t.noise_px), (0.5, 3.0, 7));
    }
}
