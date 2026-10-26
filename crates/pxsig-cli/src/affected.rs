//! `pxsig affected`: which manifest entries can a change have touched?
//!
//! The TurboSnap idea, natively: scan `srcRoot` for relative imports, build the
//! reverse import graph, walk it from the changed files, and keep the entries
//! whose story file (`importPath`) was reached. A change under any
//! `affectsAll` prefix (tokens, theme provider, Storybook config, the pxsig
//! config itself) selects everything. Files outside `srcRoot` that match no
//! prefix select nothing.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::batch::Manifest;

const EXTS: [&str; 5] = ["ts", "tsx", "js", "mjs", "jsx"];

/// Changed files (repo-relative): committed since `since`, plus staged,
/// unstaged and untracked work.
pub fn git_changed(root: &Path, since: &str) -> Result<Vec<String>> {
    let run = |args: &[&str]| -> Result<String> {
        let out = Command::new("git").args(args).current_dir(root).output().context("running git")?;
        if !out.status.success() {
            bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    };
    let base = run(&["merge-base", since, "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_else(|_| since.to_string());
    let mut files: HashSet<String> = HashSet::new();
    for args in [
        vec!["diff", "--name-only", base.as_str(), "HEAD"],
        vec!["diff", "--name-only"],
        vec!["diff", "--name-only", "--cached"],
        vec!["ls-files", "--others", "--exclude-standard"],
    ] {
        files.extend(run(&args)?.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from));
    }
    let mut v: Vec<String> = files.into_iter().collect();
    v.sort();
    Ok(v)
}

fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Relative specifiers in a module: `from '…'`, `import '…'`, `import('…')`, `require('…')`.
pub fn specifiers(src: &str) -> Vec<String> {
    // Byte-level scan: keywords and quotes are ASCII, so UTF-8 elsewhere is skipped safely.
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let rest = &b[i..];
        let skip = if rest.starts_with(b"from") {
            4
        } else if rest.starts_with(b"import") {
            6
        } else if rest.starts_with(b"require") {
            7
        } else {
            i += 1;
            continue;
        };
        // must be a whole word
        if i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_' || b[i - 1] == b'$' || b[i - 1] == b'.') {
            i += 1;
            continue;
        }
        let mut j = i + skip;
        while j < b.len() && matches!(b[j], b' ' | b'\t' | b'\n' | b'\r' | b'(') {
            j += 1;
        }
        if j < b.len() && matches!(b[j], b'\'' | b'"' | b'`') {
            let q = b[j];
            if let Some(end) = b[j + 1..].iter().position(|&c| c == q || c == b'\n') {
                if b[j + 1 + end] == q {
                    let spec = String::from_utf8_lossy(&b[j + 1..j + 1 + end]);
                    if spec.starts_with('.') {
                        out.push(spec.into_owned());
                    }
                }
                i = j + 1 + end;
                continue;
            }
        }
        i += skip;
    }
    out
}

fn resolve_spec(from_dir: &Path, spec: &str, files: &HashSet<PathBuf>) -> Option<PathBuf> {
    let base = normalize(&from_dir.join(spec));
    if files.contains(&base) {
        return Some(base);
    }
    let s = base.to_string_lossy().into_owned();
    for e in EXTS {
        let p = PathBuf::from(format!("{s}.{e}"));
        if files.contains(&p) {
            return Some(p);
        }
    }
    for e in EXTS {
        let p = base.join(format!("index.{e}"));
        if files.contains(&p) {
            return Some(p);
        }
    }
    None
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() {
            if !matches!(name.as_str(), "node_modules" | "dist" | ".turbo" | "__pixels__") {
                walk(&p, out);
            }
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| EXTS.contains(&x)) {
            out.push(p);
        }
    }
}

/// Reverse import graph over `src_root` (paths relative to `root`).
pub fn reverse_graph(root: &Path, src_root: &str) -> HashMap<PathBuf, Vec<PathBuf>> {
    let mut abs = Vec::new();
    walk(&root.join(src_root), &mut abs);
    let rel: Vec<PathBuf> = abs.iter().filter_map(|p| p.strip_prefix(root).ok().map(normalize)).collect();
    let set: HashSet<PathBuf> = rel.iter().cloned().collect();
    let mut rev: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for (a, r) in abs.iter().zip(&rel) {
        let Ok(text) = fs::read_to_string(a) else { continue };
        let dir = r.parent().unwrap_or(Path::new(""));
        for spec in specifiers(&text) {
            if let Some(t) = resolve_spec(dir, &spec, &set) {
                rev.entry(t).or_default().push(r.clone());
            }
        }
    }
    rev
}

/// A changed file as `--files` may give it (repo-relative or absolute, either separator on Windows),
/// as the repo-relative `/` path the graph uses. An absolute path outside `root` stays absolute.
/// Windows paths compare case-insensitively (`C:\Repo` and `c:\repo` are one folder).
pub fn repo_relative(root: &Path, f: &str) -> String {
    let windows = std::path::MAIN_SEPARATOR == '\\';
    let f = if windows { f.replace('\\', "/") } else { f.to_string() };
    if !Path::new(&f).is_absolute() {
        return f.trim_start_matches("./").to_string();
    }
    let root = if root.is_absolute() { root.to_path_buf() } else { std::env::current_dir().map(|d| d.join(root)).unwrap_or_else(|_| root.to_path_buf()) };
    let mut base = crate::io::to_slash(&normalize(&root));
    if !base.ends_with('/') {
        base.push('/');
    }
    let starts = if windows { f.to_lowercase().starts_with(&base.to_lowercase()) } else { f.starts_with(&base) };
    match f.get(base.len()..) {
        Some(rest) if starts => rest.to_string(),
        _ => f,
    }
}

/// Entries (ids) affected by `changed` (repo-relative paths).
pub fn affected(root: &Path, m: &Manifest, changed: &[String]) -> Result<Value> {
    let all_hit: Vec<&String> =
        changed.iter().filter(|f| m.affects_all.iter().any(|p| f.starts_with(p.as_str()))).collect();
    if !all_hit.is_empty() {
        return Ok(json!({
            "all": true,
            "reason": format!("{} changed (affects every story)", all_hit[0]),
            "changed": changed,
            "ids": m.stories.iter().map(|s| &s.id).collect::<Vec<_>>(),
            "storyFiles": [],
        }));
    }
    let src_root = m.src_root.as_deref().unwrap_or("src");
    let rev = reverse_graph(root, src_root);
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut q: VecDeque<PathBuf> = changed.iter().map(|f| normalize(Path::new(f))).collect();
    while let Some(f) = q.pop_front() {
        if !seen.insert(f.clone()) {
            continue;
        }
        if let Some(importers) = rev.get(&f) {
            q.extend(importers.iter().cloned());
        }
    }
    let story_file = |s: &crate::batch::Entry| s.import_path.as_deref().map(|p| normalize(Path::new(p)));
    let ids: Vec<&String> =
        m.stories.iter().filter(|s| story_file(s).is_some_and(|p| seen.contains(&p))).map(|s| &s.id).collect();
    let mut files: Vec<String> = m
        .stories
        .iter()
        .filter_map(story_file)
        .filter(|p| seen.contains(p))
        .map(|p| crate::io::to_slash(&p))
        .collect();
    files.sort();
    files.dedup();
    Ok(json!({
        "all": false,
        "reason": if ids.is_empty() { "no story imports a changed file".to_string() } else { format!("{} story files import a changed file", files.len()) },
        "changed": changed,
        "ids": ids,
        "storyFiles": files,
        "graphFiles": rev.len(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_relative_specifiers_only() {
        let src = r#"
            import React from 'react';
            import { Button } from '../Button';
            export * from "./Card.css";
            const L = React.lazy(() => import('./Lazy'));
            const x = require('./legacy');
            const imported = 'not an import'; // — utf-8 from './nope
        "#;
        assert_eq!(specifiers(src), vec!["../Button", "./Card.css", "./Lazy", "./legacy"]);
    }
}

#[cfg(test)]
mod repo_relative_tests {
    use super::repo_relative;
    use std::path::Path;

    #[test]
    fn changed_files_become_repo_relative() {
        assert_eq!(repo_relative(Path::new("/r/repo"), "src/a.tsx"), "src/a.tsx");
        assert_eq!(repo_relative(Path::new("/r/repo"), "./src/a.tsx"), "src/a.tsx");
        #[cfg(not(windows))]
        {
            assert_eq!(repo_relative(Path::new("/r/repo"), "/r/repo/src/a.tsx"), "src/a.tsx");
            assert_eq!(repo_relative(Path::new("/r/repo/"), "/r/repo/src/a.tsx"), "src/a.tsx");
            assert_eq!(repo_relative(Path::new("/r/repo"), "/elsewhere/a.tsx"), "/elsewhere/a.tsx");
        }
        #[cfg(windows)]
        {
            assert_eq!(repo_relative(Path::new("C:\\Repo"), "c:\\repo\\src\\a.tsx"), "src/a.tsx");
            assert_eq!(repo_relative(Path::new("C:\\Repo"), "src\\a.tsx"), "src/a.tsx");
        }
    }
}
