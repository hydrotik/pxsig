//! `react-plan`: which changed files React analysis compiles, and for each side (the merge base
//! and now) its content hash, whether the cache has it, and the text to compile when it does not.
//!
//! Analysed: a changed (added, modified, renamed) module file, `tsx jsx ts js mts mjs cts cjs`,
//! of class `graph` (it reaches an entry) or `affects-all` (a Storybook config module), not
//! matching `exclude`. Not analysed, silently: deleted files, other classes, outside the
//! workspace. `--all`: every module file that reaches an entry, with no base side.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use super::cache;
use crate::affected::{self, glob_match};
use crate::batch;

/// The default `react.exclude`: stories, tests, type declarations, vanilla-extract styles.
pub const EXCLUDE: [&str; 7] = [
    "**/*.stories.*",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.d.ts",
    "**/*.css.ts",
    "**/__tests__/**",
    "**/__mocks__/**",
];
const EXTS: [&str; 8] = ["tsx", "jsx", "ts", "js", "mts", "mjs", "cts", "cjs"];
/// Files compiled per run at most: the first ones by path, the rest skipped with a note.
pub const MAX_FILES: usize = 300;

/// What to analyse.
pub enum Select {
    /// Changed since the merge base with this ref, plus uncommitted work.
    Since(String),
    /// These files, compared with `HEAD`.
    Files(Vec<String>),
    /// Every module file that reaches an entry; no comparison.
    All,
}

pub struct PlanOpts {
    pub manifest: PathBuf,
    pub root: PathBuf,
    pub select: Select,
    pub cache: PathBuf,
    /// `{ key: { backend, compiler, babel, options }, exclude?: [globs] }`.
    pub options: Value,
}

/// Babel's parser plugins for a file, by extension. Part of the cache key.
pub fn parser(path: &str) -> &'static [&'static str] {
    match path.rsplit('.').next().unwrap_or("") {
        "tsx" => &["jsx", "typescript"],
        "ts" | "mts" | "cts" => &["typescript"],
        _ => &["jsx"],
    }
}

/// One file the selection picked, before hashing.
struct Candidate {
    path: String,
    status: String,
    /// The base side's path (a rename's old path); `None`: a new file.
    base_path: Option<String>,
    entries: Vec<String>,
    /// An `affects-all` module: it reaches every entry.
    all: bool,
}

fn side(cache_dir: &Path, key: &Value, parser: &[&str], bytes: &[u8]) -> Value {
    let sha = cache::key(key, parser, bytes);
    let hit = cache::read(cache_dir, &sha).is_some();
    let mut s = json!({ "sha": sha, "hit": hit });
    if !hit {
        s["text"] = json!(String::from_utf8_lossy(bytes));
    }
    s
}

/// The plan: `{ v, base, files, skipped, notes }`.
pub fn plan(o: &PlanOpts) -> Result<Value> {
    let m = batch::load_manifest(&o.manifest)?;
    let key = o
        .options
        .get("key")
        .filter(|k| k.is_object())
        .ok_or_else(|| anyhow!("options.key (backend, versions, options) is required"))?;
    let exclude: Vec<String> = match o.options["exclude"].as_array() {
        Some(a) => a
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect(),
        None => EXCLUDE.iter().map(|s| s.to_string()).collect(),
    };
    let mut notes: Vec<String> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();
    let (mut cands, base, changes) = match &o.select {
        Select::All => {
            let c = affected::inventory(&o.root, &m)
                .into_iter()
                .map(|(path, entries)| Candidate {
                    path,
                    status: "M".into(),
                    base_path: None,
                    entries,
                    all: false,
                })
                .collect::<Vec<_>>();
            (c, Value::Null, None)
        }
        Select::Since(_) | Select::Files(_) => {
            let (ch, since) = match &o.select {
                Select::Since(s) => (affected::changes_since(&o.root, s)?, s.clone()),
                Select::Files(f) => (affected::changes_from_files(&o.root, f), "HEAD".into()),
                Select::All => unreachable!(),
            };
            let res = affected::affected(&o.root, &m, &ch)?;
            let mut c = Vec::new();
            for f in res["files"].as_array().into_iter().flatten() {
                let (path, status) = (
                    f["path"].as_str().unwrap_or(""),
                    f["status"].as_str().unwrap_or(""),
                );
                let all = f["class"] == "affects-all";
                let reaches = f["class"] == "graph" && f["selects"] != "none";
                let ext = path.rsplit('.').next().unwrap_or("");
                if status == "D"
                    || path.starts_with("$repo/")
                    || !EXTS.contains(&ext)
                    || !(all || reaches)
                {
                    continue;
                }
                let base_path = match status {
                    "A" | "?" | "C" => None,
                    _ => Some(f["from"].as_str().unwrap_or(path).to_string()),
                };
                let entries = f["entries"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect();
                c.push(Candidate {
                    path: path.into(),
                    status: status.into(),
                    base_path,
                    entries,
                    all,
                });
            }
            let base = if ch.fail_all.is_some() {
                notes.push("react: no merge base, so nothing to compare with; fetch history (fetch-depth: 0) for alerts".into());
                Value::Null
            } else {
                let commit = ch
                    .merge_base
                    .clone()
                    .or(ch.base.clone())
                    .unwrap_or_default();
                json!({ "since": since, "commit": commit.chars().take(7).collect::<String>() })
            };
            (c, base, Some(ch))
        }
    };
    cands.sort_by(|a, b| a.path.cmp(&b.path));
    cands.retain(|c| !exclude.iter().any(|g| glob_match(g, &c.path)));
    let mut files = Vec::new();
    for c in cands {
        if files.len() == MAX_FILES {
            skipped.push(
                json!({ "path": c.path, "why": format!("beyond the first {MAX_FILES} files") }),
            );
            continue;
        }
        let Ok(bytes) = fs::read(o.root.join(&c.path)) else {
            skipped.push(json!({ "path": c.path, "why": "unreadable" }));
            continue;
        };
        if String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).contains("@flow") {
            skipped.push(json!({ "path": c.path, "why": "a Flow file" }));
            continue;
        }
        let parser = parser(&c.path);
        let mut f = json!({
            "path": c.path, "status": c.status, "entries": c.entries, "all": c.all, "parser": parser,
            "head": side(&o.cache, key, parser, &bytes), "base": null, "compare": false,
        });
        if let Some(ch) = changes.as_ref().filter(|_| !base.is_null()) {
            match &c.base_path {
                None => f["compare"] = json!(true),
                Some(bp) => match ch.base_bytes(bp) {
                    Some(b) => {
                        f["base"] = side(&o.cache, key, parser, &b);
                        f["compare"] = json!(true);
                        if *bp != c.path {
                            f["from"] = json!(bp);
                        }
                    }
                    None => notes.push(format!(
                        "react: {}: the base side cannot be read, so it is not compared",
                        c.path
                    )),
                },
            }
        }
        files.push(f);
    }
    let beyond = skipped
        .iter()
        .filter(|s| s["why"].as_str().is_some_and(|w| w.starts_with("beyond")))
        .count();
    if beyond > 0 {
        notes.push(format!(
            "react: {beyond} files beyond the first {MAX_FILES} not analysed"
        ));
    }
    Ok(json!({ "v": 1, "base": base, "files": files, "skipped": skipped, "notes": notes }))
}
