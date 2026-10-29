//! Path helpers: normalising, the folder walk, repo-relative paths and glob matching.

use std::fs;
use std::path::{Component, Path, PathBuf};

use super::MODULES;

pub(super) fn normalize(p: &Path) -> PathBuf {
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

pub(super) fn norm_str(p: &str) -> String {
    let s = crate::io::to_slash(&normalize(Path::new(&p.replace('\\', "/"))));
    s.trim_end_matches('/').to_string()
}

pub(super) fn is_module(p: &Path) -> bool {
    p.extension()
        .and_then(|x| x.to_str())
        .is_some_and(|x| MODULES.contains(&x))
}

/// Folders never walked: dependencies, build output, pxsig's own files.
const SKIP_DIRS: [&str; 6] = [
    "node_modules",
    "dist",
    ".turbo",
    "__pixels__",
    "__pxsig__",
    ".git",
];

pub(super) fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                walk(&p, out);
            }
        } else {
            out.push(p);
        }
    }
}

/// A changed file as `--files` may give it (repo-relative or absolute, either separator on Windows),
/// as the repo-relative `/` path the graph uses. An absolute path outside `root` stays absolute.
/// Windows paths compare case-insensitively (`C:\Repo` and `c:\repo` are one folder).
pub fn repo_relative(root: &Path, f: &str) -> String {
    let windows = std::path::MAIN_SEPARATOR == '\\';
    let f = if windows {
        f.replace('\\', "/")
    } else {
        f.to_string()
    };
    if !Path::new(&f).is_absolute() {
        return f.trim_start_matches("./").to_string();
    }
    let root = if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|d| d.join(root))
            .unwrap_or_else(|_| root.to_path_buf())
    };
    let mut base = crate::io::to_slash(&normalize(&root));
    if !base.ends_with('/') {
        base.push('/');
    }
    let starts = if windows {
        f.to_lowercase().starts_with(&base.to_lowercase())
    } else {
        f.starts_with(&base)
    };
    match f.get(base.len()..) {
        Some(rest) if starts => rest.to_string(),
        _ => f,
    }
}

/// `affects.ignore` globs: `*` within a segment, `**` any depth, `?`, `{a,b}`; a trailing `/`
/// matches the folder's contents. Matched on `/` paths.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let pattern = if pattern.ends_with('/') {
        format!("{pattern}**")
    } else {
        pattern.to_string()
    };
    let path: Vec<char> = path.chars().collect();
    expand_braces(&pattern)
        .iter()
        .any(|p| glob_chars(&p.chars().collect::<Vec<_>>(), &path))
}

fn expand_braces(p: &str) -> Vec<String> {
    let Some(open) = p.find('{') else {
        return vec![p.to_string()];
    };
    let mut depth = 0;
    let mut close = None;
    let mut parts = Vec::new();
    let mut start = open + 1;
    for (i, c) in p[open..].char_indices().map(|(i, c)| (i + open, c)) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    parts.push(&p[start..i]);
                    close = Some(i);
                    break;
                }
            }
            ',' if depth == 1 => {
                parts.push(&p[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    let Some(close) = close else {
        return vec![p.to_string()];
    };
    let (head, tail) = (&p[..open], &p[close + 1..]);
    parts
        .iter()
        .flat_map(|alt| expand_braces(&format!("{head}{alt}{tail}")))
        .collect()
}

fn glob_chars(p: &[char], s: &[char]) -> bool {
    match p.first() {
        None => s.is_empty(),
        Some('*') if p.get(1) == Some(&'*') => {
            let rest = &p[2..];
            if rest.first() == Some(&'/') {
                // `**/`: nothing, or any run of whole segments
                glob_chars(&rest[1..], s)
                    || (1..=s.len()).any(|i| s[i - 1] == '/' && glob_chars(&rest[1..], &s[i..]))
            } else {
                (0..=s.len()).any(|i| glob_chars(rest, &s[i..]))
            }
        }
        Some('*') => {
            let mut i = 0;
            loop {
                if glob_chars(&p[1..], &s[i..]) {
                    return true;
                }
                if i == s.len() || s[i] == '/' {
                    return false;
                }
                i += 1;
            }
        }
        Some('?') => !s.is_empty() && s[0] != '/' && glob_chars(&p[1..], &s[1..]),
        Some(c) => s.first() == Some(c) && glob_chars(&p[1..], &s[1..]),
    }
}

pub(super) fn under(path: &str, dir: &str) -> bool {
    let dir = dir.trim_end_matches('/');
    !dir.is_empty() && (path == dir || path.strip_prefix(dir).is_some_and(|r| r.starts_with('/')))
}
