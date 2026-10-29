//! The store's record files: what a change to `a11y.json`, a manifest or a log selects.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use crate::batch::StoreInfo;

use super::paths::norm_str;

/// What a record file's change selects.
pub(super) enum RecordDiff {
    /// Every entry it covers (a rewritten log, a side that does not parse, a top-level change).
    All(String),
    Ids {
        ids: Vec<String>,
        removed: Vec<String>,
    },
}

fn parse_obj(text: &str, empty: Value) -> Option<Value> {
    if text.trim().is_empty() {
        return Some(empty);
    }
    serde_json::from_str::<Value>(text)
        .ok()
        .filter(Value::is_object)
}

pub(super) fn diff_a11y(base: &str, now: &str) -> RecordDiff {
    let (Some(a), Some(b)) = (parse_obj(base, json!({})), parse_obj(now, json!({}))) else {
        return RecordDiff::All("a11y.json does not parse".into());
    };
    let (a, b) = (a.as_object().unwrap(), b.as_object().unwrap());
    let mut ids: Vec<String> = a
        .keys()
        .chain(b.keys())
        .filter(|k| a.get(*k) != b.get(*k))
        .cloned()
        .collect();
    ids.sort();
    ids.dedup();
    RecordDiff::Ids {
        ids,
        removed: vec![],
    }
}

pub(super) fn diff_manifest(base: &str, now: &str) -> RecordDiff {
    let empty = json!({ "stories": [] });
    let (Some(a), Some(b)) = (parse_obj(base, empty.clone()), parse_obj(now, empty)) else {
        return RecordDiff::All("the manifest does not parse".into());
    };
    let (ao, bo) = (a.as_object().unwrap(), b.as_object().unwrap());
    let top = |o: &serde_json::Map<String, Value>| -> BTreeMap<String, Value> {
        o.iter()
            .filter(|(k, _)| !matches!(k.as_str(), "stories" | "skipped"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    };
    if !base.trim().is_empty() && top(ao) != top(bo) {
        return RecordDiff::All("a manifest setting changed".into());
    }
    let by_id = |v: &Value| -> BTreeMap<String, Value> {
        v["stories"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e["id"].as_str().map(|id| (id.to_string(), e.clone())))
            .collect()
    };
    let (sa, sb) = (by_id(&a), by_id(&b));
    let ids = sb
        .iter()
        .filter(|(id, e)| sa.get(*id) != Some(e))
        .map(|(id, _)| id.clone())
        .collect();
    let removed = sa
        .keys()
        .filter(|id| !sb.contains_key(*id))
        .cloned()
        .collect();
    RecordDiff::Ids { ids, removed }
}

pub(super) fn diff_log(base: &str, now: &str, name: &str) -> RecordDiff {
    let Some(appended) = now.as_bytes().strip_prefix(base.as_bytes()) else {
        return RecordDiff::All(format!("{name} was rewritten, not appended to"));
    };
    let mut ids = Vec::new();
    for line in String::from_utf8_lossy(appended)
        .lines()
        .filter(|l| !l.trim().is_empty())
    {
        match serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|v| v["id"].as_str().map(String::from))
        {
            Some(id) => ids.push(id),
            None => return RecordDiff::All(format!("an appended {name} line does not parse")),
        }
    }
    ids.sort();
    ids.dedup();
    RecordDiff::Ids {
        ids,
        removed: vec![],
    }
}

/// The entries of the store's other manifests, by id and by baseline path, and each suite's size.
pub(super) struct OtherSuites {
    pub(super) by_id: HashMap<String, String>,
    pub(super) by_sig: HashMap<String, String>,
    pub(super) size: HashMap<String, usize>,
}

pub(super) fn other_suites(root: &Path, store: Option<&StoreInfo>) -> OtherSuites {
    let mut o = OtherSuites {
        by_id: HashMap::new(),
        by_sig: HashMap::new(),
        size: HashMap::new(),
    };
    let Some(store) = store else { return o };
    let this = store.suite.clone().unwrap_or_default();
    for (suite, path) in &store.manifests {
        if *suite == this {
            continue;
        }
        let Ok(text) = fs::read_to_string(root.join(path)) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let stories = v["stories"].as_array().cloned().unwrap_or_default();
        o.size.insert(suite.clone(), stories.len());
        for e in stories {
            if let Some(id) = e["id"].as_str() {
                o.by_id.insert(id.to_string(), suite.clone());
            }
            if let Some(sig) = e["sig"].as_str() {
                o.by_sig.insert(norm_str(sig), suite.clone());
            }
        }
    }
    o
}

/// A store record file: its kind and, for a manifest, its suite (`None`: shared by every suite).
pub(super) fn record_kind(s: &StoreInfo, p: &str) -> Option<(&'static str, Option<String>)> {
    let is = |x: &Option<String>| x.as_deref().is_some_and(|x| norm_str(x) == p);
    if is(&s.a11y) {
        return Some(("a11y", None));
    }
    if is(&s.approvals) || is(&s.a11y_decisions) {
        return Some(("log", None));
    }
    s.manifests
        .iter()
        .find(|(_, path)| norm_str(path) == p)
        .map(|(suite, _)| ("manifest", Some(suite.clone())))
}

/// One classified path: (class, selects, n, why).
pub(super) type Class = (&'static str, &'static str, Option<usize>, String);
