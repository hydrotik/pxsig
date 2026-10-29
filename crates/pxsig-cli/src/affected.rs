//! `pxsig affected`: which manifest entries can a change have touched?
//!
//! The TurboSnap idea, natively, with one rule on top: **when the selection is unsure, it selects
//! everything, and says why.** Every changed path gets exactly one class, by the first rule that
//! matches (docs/ci.md, "How selection decides"):
//!
//! | # | class | selects |
//! | --- | --- | --- |
//! | 1 | `affects-all`: an `affectsAll` prefix | all |
//! | 2 | `baseline`: a `.psig` that is an entry's `sig` | that entry |
//! | 2′ | `baseline-other`: any other `.psig` (another suite's, or orphaned) | nothing here |
//! | 3 | `store-record`: `a11y.json`, a manifest, `approvals.ndjson`, `a11y-decisions.ndjson` | the entries whose records changed |
//! | 3′ | `store-other`: any other file in the store | all |
//! | 4 | `graph`: a module under `srcRoot` that reaches a story file | those entries |
//! | 4′ | `graph-no-entry`: a module nothing that leads to an entry imports (a test, a script) | nothing |
//! | 5 | `ignored`: `affects.ignore` | nothing |
//! | 6 | `untraced`: under `srcRoot`, not a module (an unimported `.json`, `.md`) | all (fail-safe) |
//! | 7 | `outside`: outside `srcRoot`, in the workspace | all (fail-safe) |
//! | 7′ | `outside-workspace`: elsewhere in the repository | all (fail-safe) |
//!
//! `ids` includes the fail-safe; `traced` does not (watch and staleness use it, decision 6.1f).
//! Paths are workspace-relative with `/`; a path outside the workspace is `$repo/<repo path>`.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::{json, Value};

use crate::batch::Manifest;

mod changes;
#[cfg(test)]
mod git_tests;
mod graph;
mod paths;
mod records;
#[cfg(test)]
mod repo_relative_tests;
#[cfg(test)]
mod resolver_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use changes::{changes_from_files, changes_since, Changes};
use graph::graph;
use paths::{glob_match, is_module, norm_str, normalize, under};
use records::{diff_a11y, diff_log, diff_manifest, other_suites, record_kind, Class, RecordDiff};

/// Modules: graph nodes, read for imports. A changed one that reaches no entry selects nothing.
const MODULES: [&str; 9] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "mdx"];

/// Entries (ids) affected by `ch`.
pub fn affected(root: &Path, m: &Manifest, ch: &Changes) -> Result<Value> {
    let src_root = norm_str(m.src_root.as_deref().unwrap_or("src"));
    let all_prefixes: Vec<String> = m.affects_all.iter().map(|p| norm_str(p)).collect();
    let store = m.store.as_ref();
    let this_suite = store.and_then(|s| s.suite.clone()).unwrap_or_default();
    let others = other_suites(root, store);
    let all_ids: Vec<String> = m.stories.iter().map(|s| s.id.clone()).collect();
    let in_manifest: HashSet<&str> = all_ids.iter().map(String::as_str).collect();
    let by_sig: HashMap<String, &str> = m
        .stories
        .iter()
        .map(|s| (norm_str(&s.sig), s.id.as_str()))
        .collect();
    let story_file =
        |s: &crate::batch::Entry| s.import_path.as_deref().map(|p| normalize(Path::new(p)));
    let story_files: HashSet<PathBuf> = m.stories.iter().filter_map(story_file).collect();

    let deleted: Vec<String> = ch
        .files
        .iter()
        .filter(|c| c.status == 'D' && !c.path.starts_with("$repo/"))
        .map(|c| norm_str(&c.path))
        .collect();
    let g = graph(root, m, &src_root, ch.top.clone(), &deleted);
    let reach = |start: &Path| -> HashSet<PathBuf> {
        let mut seen = HashSet::new();
        let mut q = VecDeque::from([normalize(start)]);
        while let Some(f) = q.pop_front() {
            if seen.insert(f.clone()) {
                if let Some(importers) = g.rev.get(&f) {
                    q.extend(importers.iter().cloned());
                }
            }
        }
        seen
    };

    let mut files_out = Vec::new();
    let mut ids: HashSet<String> = HashSet::new();
    let mut story_hits: HashSet<PathBuf> = HashSet::new();
    let mut traced_all: Option<String> = None;
    let mut fail_safe: Vec<Value> = Vec::new();
    let mut ignored = Vec::new();
    let mut baselines = Vec::new();
    let mut records: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut removed: Vec<String> = Vec::new();
    let mut other: BTreeMap<String, usize> = BTreeMap::new();
    if let Some(why) = &ch.fail_all {
        fail_safe.push(json!({ "path": null, "class": "no-merge-base", "why": why }));
    }

    for c in &ch.files {
        let p = c.path.as_str();
        let np = normalize(Path::new(p));
        let (class, selects, n, why): Class = if let Some(a) =
            all_prefixes.iter().find(|a| under(p, a))
        {
            traced_all.get_or_insert_with(|| format!("{p} changed (affects every story)"));
            (
                "affects-all",
                "all",
                None,
                format!("under {a}, which affects every entry"),
            )
        } else if p.ends_with(".psig") {
            let key = norm_str(p);
            if let Some(id) = by_sig.get(&key) {
                ids.insert(id.to_string());
                baselines.push(id.to_string());
                (
                    "baseline",
                    "entries",
                    Some(1),
                    format!("the baseline of {id}"),
                )
            } else if let Some(suite) = others.by_sig.get(&key) {
                *other.entry(suite.clone()).or_default() += 1;
                (
                    "baseline-other",
                    "none",
                    None,
                    format!("a baseline of suite {suite} (check it with --suite {suite})"),
                )
            } else {
                (
                    "baseline-other",
                    "none",
                    None,
                    "a baseline no manifest names (orphaned)".into(),
                )
            }
        } else if let Some((kind, suite)) = store.and_then(|s| record_kind(s, p)) {
            let base = ch.base_text(p);
            let now = fs::read_to_string(root.join(p)).unwrap_or_default();
            let base = if ch.explicit && base == now {
                String::new()
            } else {
                base
            };
            let d = match kind {
                "a11y" => diff_a11y(&base, &now),
                "manifest" => diff_manifest(&base, &now),
                _ => diff_log(
                    &base,
                    &now,
                    Path::new(p)
                        .file_name()
                        .and_then(|f| f.to_str())
                        .unwrap_or(p),
                ),
            };
            // a11y.json and the logs cover every suite; a manifest, its own.
            let mine = suite.as_ref().is_none_or(|s| *s == this_suite);
            match d {
                RecordDiff::All(why) if mine => {
                    traced_all.get_or_insert_with(|| format!("{p}: {why}"));
                    ("store-record", "all", None, why)
                }
                RecordDiff::All(why) => {
                    let s = suite.unwrap_or_default();
                    *other.entry(s.clone()).or_default() +=
                        others.size.get(&s).copied().unwrap_or(0);
                    ("store-record", "none", None, format!("{why} (suite {s})"))
                }
                RecordDiff::Ids {
                    ids: changed,
                    removed: gone,
                } => {
                    let mut here = Vec::new();
                    for id in changed {
                        if mine && in_manifest.contains(id.as_str()) {
                            here.push(id);
                        } else if let Some(s) = if mine {
                            others.by_id.get(&id)
                        } else {
                            suite.as_ref()
                        } {
                            *other.entry(s.clone()).or_default() += 1;
                        }
                    }
                    if mine {
                        removed.extend(gone);
                    }
                    ids.extend(here.iter().cloned());
                    let n = here.len();
                    records.insert(p.to_string(), here);
                    (
                        "store-record",
                        if n > 0 { "entries" } else { "none" },
                        Some(n),
                        format!("{n} entries' records changed"),
                    )
                }
            }
        } else if store.is_some_and(|s| under(p, &norm_str(&s.dir))) {
            traced_all.get_or_insert_with(|| format!("{p}: a store file pxsig does not trace"));
            (
                "store-other",
                "all",
                None,
                "a store file pxsig does not trace".into(),
            )
        } else if story_files.contains(&np)
            || g.rev.contains_key(&np)
            || (g.nodes.contains(&np) && is_module(&np))
        {
            let seen = reach(&np);
            if let Some(a) = seen
                .iter()
                .map(|f| crate::io::to_slash(f))
                .find(|f| all_prefixes.iter().any(|a| under(f, a)))
            {
                traced_all.get_or_insert_with(|| format!("{p} reaches {a} (affects every story)"));
                (
                    "graph",
                    "all",
                    None,
                    format!("reaches {a}, which affects every entry"),
                )
            } else {
                let hit: Vec<&crate::batch::Entry> = m
                    .stories
                    .iter()
                    .filter(|s| story_file(s).is_some_and(|f| seen.contains(&f)))
                    .collect();
                let files: HashSet<PathBuf> = hit.iter().filter_map(|s| story_file(s)).collect();
                ids.extend(hit.iter().map(|s| s.id.clone()));
                story_hits.extend(files.iter().cloned());
                if hit.is_empty() {
                    ("graph-no-entry", "none", None, "no story imports it".into())
                } else {
                    (
                        "graph",
                        "entries",
                        Some(hit.len()),
                        format!("{} story files import it", files.len()),
                    )
                }
            }
        } else if m.affects_ignore.iter().any(|g| glob_match(g, p)) {
            ignored.push(p.to_string());
            ("ignored", "none", None, "affects.ignore".into())
        } else {
            let (class, why) = if under(p, &src_root) {
                ("untraced", "nothing imports it")
            } else if p.starts_with("$repo/") || Path::new(p).is_absolute() {
                ("outside-workspace", "outside the workspace")
            } else {
                ("outside", "outside srcRoot")
            };
            fail_safe.push(json!({ "path": p, "class": class, "why": format!("{p}: {why}") }));
            (class, "all", None, why.to_string())
        };
        let mut f = json!({ "path": p, "status": c.status.to_string(), "class": class, "selects": selects, "why": why });
        if let Some(from) = &c.from {
            f["from"] = json!(from);
        }
        if let Some(n) = n {
            f["n"] = json!(n);
        }
        files_out.push(f);
    }

    // Unresolved imports (decision 6.1d): on every run, the entries that reach the file holding one;
    // all when that file is, or reaches, an affects-all file. `affects.unresolved` accepts them.
    let mut unresolved_out = Vec::new();
    let mut unresolved_ids: HashSet<String> = HashSet::new();
    for u in &g.unresolved {
        let accepted = m.affects_unresolved.iter().any(|p| glob_match(p, &u.file));
        let mut o = json!({ "file": u.file, "spec": u.spec, "line": u.line, "why": u.why, "accepted": accepted, "selects": "none" });
        if !accepted {
            let seen = reach(Path::new(&u.file));
            let why = format!(
                "{}:{}: `{}` does not resolve ({})",
                u.file, u.line, u.spec, u.why
            );
            if seen
                .iter()
                .map(|f| crate::io::to_slash(f))
                .any(|f| all_prefixes.iter().any(|a| under(&f, a)))
            {
                o["selects"] = json!("all");
                if !fail_safe
                    .iter()
                    .any(|f| f["path"] == u.file && f["class"] == "unresolved")
                {
                    fail_safe.push(json!({ "path": u.file, "class": "unresolved", "why": format!("{why}; it affects every entry") }));
                }
            } else {
                let hit: Vec<&str> = m
                    .stories
                    .iter()
                    .filter(|s| story_file(s).is_some_and(|f| seen.contains(&f)))
                    .map(|s| s.id.as_str())
                    .collect();
                if !hit.is_empty() {
                    o["selects"] = json!("entries");
                    o["n"] = json!(hit.len());
                    unresolved_ids.extend(hit.iter().map(|s| s.to_string()));
                }
            }
        }
        unresolved_out.push(o);
    }
    let remote: Vec<Value> = g
        .remote
        .iter()
        .map(|(file, url, line)| json!({ "file": file, "url": url, "line": line }))
        .collect();

    let traced: Vec<String> = if traced_all.is_some() {
        all_ids.clone()
    } else {
        all_ids
            .iter()
            .filter(|id| ids.contains(*id))
            .cloned()
            .collect()
    };
    let all = traced_all.is_some() || !fail_safe.is_empty();
    let selected: Vec<String> = if all {
        all_ids.clone()
    } else {
        all_ids
            .iter()
            .filter(|id| ids.contains(*id) || unresolved_ids.contains(*id))
            .cloned()
            .collect()
    };
    let mut files: Vec<String> = story_hits.iter().map(|p| crate::io::to_slash(p)).collect();
    files.sort();
    baselines.sort();
    removed.sort();
    let extra = [
        (baselines.len(), "baselines"),
        (records.values().map(Vec::len).sum::<usize>(), "records"),
    ]
    .iter()
    .filter(|(n, _)| *n > 0)
    .map(|(n, w)| format!("; {n} {w}"))
    .collect::<String>();
    let reason = if let Some(first) = fail_safe.first() {
        let why = first["why"].as_str().unwrap_or("").to_string();
        if fail_safe.len() > 1 {
            format!("{why} (+{} more)", fail_safe.len() - 1)
        } else {
            why
        }
    } else if let Some(r) = &traced_all {
        r.clone()
    } else if files.is_empty() && extra.is_empty() && !unresolved_ids.is_empty() {
        format!(
            "{} entries reach an unresolved import",
            unresolved_ids.len()
        )
    } else if files.is_empty() && !extra.is_empty() {
        extra.trim_start_matches("; ").to_string()
    } else if files.is_empty() {
        "no story imports a changed file".to_string()
    } else {
        format!("{} story files import a changed file{extra}", files.len())
    };
    let changed: Vec<&str> = ch.files.iter().map(|c| c.path.as_str()).collect();
    Ok(json!({
        "all": all,
        "reason": reason,
        "changed": changed,
        "ids": selected,
        "traced": traced,
        "storyFiles": files,
        "graphFiles": g.rev.len(),
        "mergeBase": ch.merge_base,
        "warnings": ch.warnings,
        "files": files_out,
        "baselines": baselines,
        "records": records,
        "removed": removed,
        "failSafe": fail_safe,
        "ignored": ignored,
        "otherSuites": other,
        "unresolved": unresolved_out,
        "remote": remote,
    }))
}
