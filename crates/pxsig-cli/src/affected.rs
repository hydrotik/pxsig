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
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::batch::{Manifest, StoreInfo};
use crate::resolve::{scan_code, scan_style, scanner, Resolver, Target};

/// Modules: graph nodes, read for imports. A changed one that reaches no entry selects nothing.
const MODULES: [&str; 9] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "mdx"];

/// One changed path: workspace-relative (or `$repo/…`), its git status (`A M D R C T U`, `?`
/// for untracked), and for a rename or copy the path it came from.
#[derive(Clone, Debug)]
pub struct Change {
    pub path: String,
    pub status: char,
    pub from: Option<String>,
}

/// What changed, and how to read the base side of a record file.
#[derive(Default, Debug)]
pub struct Changes {
    pub files: Vec<Change>,
    /// The commit record files are compared against (`git show <base>:<path>`).
    pub base: Option<String>,
    pub merge_base: Option<String>,
    pub warnings: Vec<String>,
    /// Set when the changes themselves cannot be trusted (no merge base): select all, with this reason.
    pub fail_all: Option<String>,
    /// `--files`: a record file equal to the base still selects every entry it names.
    pub explicit: bool,
    top: Option<PathBuf>,
    prefix: String,
}

fn git_raw(dir: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .context("running git")?;
    if !out.status.success() {
        bail!(
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(out.stdout)
}

fn git_line(dir: &Path, args: &[&str]) -> Result<String> {
    Ok(String::from_utf8_lossy(&git_raw(dir, args)?)
        .trim_end_matches(['\n', '\r'])
        .to_string())
}

/// The repository top level and the workspace's prefix inside it (`""` or `ws/`).
fn repo_of(root: &Path) -> Result<(PathBuf, String)> {
    let top = PathBuf::from(git_line(root, &["rev-parse", "--show-toplevel"])?);
    let prefix = git_line(root, &["rev-parse", "--show-prefix"])?;
    Ok((top, prefix))
}

/// A repository-relative path as the workspace sees it: inside it, workspace-relative; outside, `$repo/<path>`.
fn from_repo(prefix: &str, p: &str) -> String {
    match p.strip_prefix(prefix) {
        Some(rest) => rest.to_string(),
        None => format!("$repo/{p}"),
    }
}

/// `git diff --name-status -z` output: `S\0path\0`, or `R<score>\0old\0new\0` for renames and
/// copies. A rename contributes both paths: the new one, and the old one as deleted.
fn parse_name_status(raw: &[u8], prefix: &str, out: &mut Vec<Change>) {
    let mut it = raw
        .split(|&b| b == 0)
        .map(|t| String::from_utf8_lossy(t).into_owned());
    while let Some(st) = it.next() {
        let Some(status) = st.chars().next() else {
            continue;
        };
        if matches!(status, 'R' | 'C') {
            let (Some(old), Some(new)) = (it.next(), it.next()) else {
                break;
            };
            out.push(Change {
                path: from_repo(prefix, &new),
                status,
                from: Some(from_repo(prefix, &old)),
            });
            out.push(Change {
                path: from_repo(prefix, &old),
                status: if status == 'R' { 'D' } else { 'M' },
                from: None,
            });
        } else if let Some(p) = it.next() {
            out.push(Change {
                path: from_repo(prefix, &p),
                status,
                from: None,
            });
        }
    }
}

/// Changed files: committed since the merge base with `since`, plus staged, unstaged and
/// untracked work. With no merge base (a shallow clone), every entry is selected, never a diff
/// against `since` itself. `since` that does not resolve is an error (exit 2).
pub fn changes_since(root: &Path, since: &str) -> Result<Changes> {
    let (top, prefix) = repo_of(root)?;
    if git_raw(
        &top,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{since}^{{commit}}"),
        ],
    )
    .is_err()
    {
        bail!("git: `{since}` is not a commit here (fetch it, or pass another --since)");
    }
    let mut ch = Changes {
        top: Some(top.clone()),
        prefix: prefix.clone(),
        ..Default::default()
    };
    let mut files = Vec::new();
    match git_line(&top, &["merge-base", since, "HEAD"]) {
        Ok(base) => {
            parse_name_status(
                &git_raw(&top, &["diff", "--name-status", "-M", "-z", &base, "HEAD"])?,
                &prefix,
                &mut files,
            );
            ch.base = Some(base.clone());
            ch.merge_base = Some(base);
        }
        Err(_) => {
            let shallow = git_line(&top, &["rev-parse", "--is-shallow-repository"])
                .is_ok_and(|s| s == "true");
            let why = format!(
                "no merge base between {since} and HEAD{}: every entry selected",
                if shallow {
                    " (shallow clone: fetch with fetch-depth: 0)"
                } else {
                    ""
                }
            );
            eprintln!("[pxsig] {why}");
            ch.warnings.push(why.clone());
            ch.fail_all = Some(why);
            ch.base = Some("HEAD".into());
        }
    }
    parse_name_status(
        &git_raw(&top, &["diff", "--name-status", "-M", "-z"])?,
        &prefix,
        &mut files,
    );
    parse_name_status(
        &git_raw(&top, &["diff", "--name-status", "-M", "-z", "--cached"])?,
        &prefix,
        &mut files,
    );
    for p in git_raw(
        &top,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--full-name",
        ],
    )?
    .split(|&b| b == 0)
    {
        if !p.is_empty() {
            files.push(Change {
                path: from_repo(&prefix, &String::from_utf8_lossy(p)),
                status: '?',
                from: None,
            });
        }
    }
    ch.files = dedup(files);
    Ok(ch)
}

/// Changed files named by the caller (`--files`, MCP `files`, watch): workspace-relative,
/// absolute, or `$repo/…`. Record files are compared with `HEAD`.
pub fn changes_from_files(root: &Path, files: &[String]) -> Changes {
    let repo = repo_of(root).ok();
    let files = files
        .iter()
        .map(|f| f.trim())
        .filter(|f| !f.is_empty())
        .map(|f| {
            let mut p = repo_relative(root, &f.replace('\\', "/"));
            if Path::new(&p).is_absolute() || p.starts_with("../") {
                // The same folder by another name (a symlinked temp or workspace folder).
                if let Some(rest) = real_relative(root, &root.join(&p)) {
                    p = rest;
                }
            }
            if Path::new(&p).is_absolute() {
                if let Some((top, _)) = &repo {
                    p = format!("$repo/{}", repo_relative(top, &p));
                }
            }
            let status = if p.starts_with("$repo/") || root.join(&p).exists() {
                'M'
            } else {
                'D'
            };
            Change {
                path: p,
                status,
                from: None,
            }
        })
        .collect();
    let (top, prefix) = repo.map_or((None, String::new()), |(t, p)| (Some(t), p));
    Changes {
        files: dedup(files),
        base: top.as_ref().map(|_| "HEAD".into()),
        explicit: true,
        top,
        prefix,
        ..Default::default()
    }
}

/// `path` relative to `root` once both are resolved through symlinks (a deleted file: through its folder).
fn real_relative(root: &Path, path: &Path) -> Option<String> {
    let real = fs::canonicalize(path).ok().or_else(|| {
        Some(
            fs::canonicalize(path.parent()?)
                .ok()?
                .join(path.file_name()?),
        )
    })?;
    let rest = real.strip_prefix(fs::canonicalize(root).ok()?).ok()?;
    Some(crate::io::to_slash(rest))
}

fn dedup(files: Vec<Change>) -> Vec<Change> {
    let mut seen = HashSet::new();
    files
        .into_iter()
        .filter(|c| seen.insert(c.path.clone()))
        .collect()
}

impl Changes {
    /// The base side of a workspace file (empty when absent there, or when there is no git).
    fn base_text(&self, ws_path: &str) -> String {
        let (Some(top), Some(base)) = (&self.top, &self.base) else {
            return String::new();
        };
        git_raw(top, &["show", &format!("{base}:{}{ws_path}", self.prefix)])
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default()
    }
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

fn norm_str(p: &str) -> String {
    let s = crate::io::to_slash(&normalize(Path::new(&p.replace('\\', "/"))));
    s.trim_end_matches('/').to_string()
}

fn is_module(p: &Path) -> bool {
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

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
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

/// An import that names nothing pxsig can follow.
pub struct Unresolved {
    pub file: String,
    pub spec: String,
    pub line: usize,
    pub why: String,
}

/// The import graph: every file under the graph roots (`srcRoot`, every `affectsAll` folder, alias
/// targets, and the source root of each workspace package an import reaches), and for each file
/// the files that import it. `deleted` files join the node set, so a file that still names one
/// counts as its importer.
pub struct Graph {
    pub nodes: HashSet<PathBuf>,
    pub rev: HashMap<PathBuf, Vec<PathBuf>>,
    pub unresolved: Vec<Unresolved>,
    /// `(file, url, line)`: remote URLs, which no repository change reflects.
    pub remote: Vec<(String, String, usize)>,
}

pub fn graph(
    root: &Path,
    m: &Manifest,
    src_root: &str,
    top: Option<PathBuf>,
    deleted: &[String],
) -> Graph {
    let aliases: Vec<(String, String)> = m
        .affects_aliases
        .iter()
        .map(|(k, v)| (k.clone(), norm_str(v)))
        .collect();
    let mut r = Resolver::new(root, top, &aliases, deleted.iter().cloned().collect());
    let mut nodes: HashSet<String> = deleted.iter().cloned().collect();
    let mut walked: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    let mut roots: Vec<String> = vec![src_root.to_string()];
    roots.extend(m.affects_all.iter().map(|a| norm_str(a)));
    roots.extend(aliases.iter().map(|(_, v)| v.clone()));
    let mut edges: Vec<(String, String)> = Vec::new();
    let mut patterns: Vec<(Target, String)> = Vec::new();
    let (mut unresolved, mut remote) = (Vec::new(), Vec::new());
    fn add(nodes: &mut HashSet<String>, queue: &mut VecDeque<String>, k: String) {
        if scanner(&k).is_some() && !nodes.contains(&k) {
            queue.push_back(k.clone());
        }
        nodes.insert(k);
    }
    loop {
        while let Some(d) = roots.pop() {
            if d.starts_with("$repo/") || !walked.insert(d.clone()) {
                continue;
            }
            let abs = r.abs_of(&d);
            if abs.is_file() {
                add(&mut nodes, &mut queue, d);
            } else {
                let mut files = Vec::new();
                walk(&abs, &mut files);
                for f in files {
                    if let Some(k) = r.key_of(&f) {
                        add(&mut nodes, &mut queue, k);
                    }
                }
            }
        }
        let Some(f) = queue.pop_front() else { break };
        let Some(code) = scanner(&f) else { continue };
        let Ok(text) = fs::read_to_string(r.abs_of(&f)) else {
            continue;
        };
        if text.len() > 4 << 20 {
            continue;
        }
        for x in if code {
            scan_code(&text)
        } else {
            scan_style(&text)
        } {
            match r.resolve(&f, &x, !code) {
                Target::File(k) => {
                    add(&mut nodes, &mut queue, k.clone());
                    edges.push((k, f.clone()));
                }
                t @ (Target::Under { .. } | Target::Glob(_)) => {
                    let dir = match &t {
                        Target::Under { dir, .. } => dir.clone(),
                        Target::Glob(g) => {
                            let fixed = &g[..g.find(['*', '?', '{', '[']).unwrap_or(g.len())];
                            fixed[..fixed.rfind('/').unwrap_or(0)].to_string()
                        }
                        _ => unreachable!(),
                    };
                    roots.push(dir);
                    patterns.push((t, f.clone()));
                }
                Target::Remote(u) => remote.push((f.clone(), u, x.line)),
                Target::Unresolved(why) => unresolved.push(Unresolved {
                    file: f.clone(),
                    spec: x.text(),
                    line: x.line,
                    why,
                }),
                Target::External | Target::Skip => {}
            }
        }
        roots.append(&mut r.roots);
    }
    for (t, importer) in &patterns {
        for n in &nodes {
            let hit = match t {
                Target::Under { dir, suffix } => under(n, dir) && n.ends_with(suffix.as_str()),
                Target::Glob(g) => glob_match(g, n),
                _ => false,
            };
            if hit && n != importer {
                edges.push((n.clone(), importer.clone()));
            }
        }
    }
    let key = |k: &str| normalize(Path::new(k));
    let mut rev: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for (t, from) in edges {
        rev.entry(key(&t)).or_default().push(key(&from));
    }
    Graph {
        nodes: nodes.iter().map(|n| key(n)).collect(),
        rev,
        unresolved,
        remote,
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

fn under(path: &str, dir: &str) -> bool {
    let dir = dir.trim_end_matches('/');
    !dir.is_empty() && (path == dir || path.strip_prefix(dir).is_some_and(|r| r.starts_with('/')))
}

/// What a record file's change selects.
enum RecordDiff {
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

fn diff_a11y(base: &str, now: &str) -> RecordDiff {
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

fn diff_manifest(base: &str, now: &str) -> RecordDiff {
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

fn diff_log(base: &str, now: &str, name: &str) -> RecordDiff {
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
struct OtherSuites {
    by_id: HashMap<String, String>,
    by_sig: HashMap<String, String>,
    size: HashMap<String, usize>,
}

fn other_suites(root: &Path, store: Option<&StoreInfo>) -> OtherSuites {
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
fn record_kind(s: &StoreInfo, p: &str) -> Option<(&'static str, Option<String>)> {
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
type Class = (&'static str, &'static str, Option<usize>, String);

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs() {
        assert!(glob_match("docs/**", "docs/a/b.md"));
        assert!(glob_match("docs/", "docs/a.md"));
        assert!(glob_match("**/*.md", "README.md"));
        assert!(glob_match("**/*.md", "src/a/B.llm-context.md"));
        assert!(!glob_match("*.md", "src/a.md"));
        assert!(glob_match("*.png", "logo.png"));
        assert!(glob_match("packages/{a,b}/**", "packages/b/x.ts"));
        assert!(!glob_match("packages/{a,b}/**", "packages/c/x.ts"));
        assert!(glob_match(
            "**/{jest,tsdown}.config.*",
            "packages/x/jest.config.cjs"
        ));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "a/c"));
        assert!(glob_match("$repo/other/**", "$repo/other/x"));
        assert!(!glob_match("other/**", "$repo/other/x"));
    }

    #[test]
    fn name_status_keeps_both_sides_of_a_rename() {
        let mut out = Vec::new();
        parse_name_status(
            b"R100\0ws/src/a.ts\0ws/src/b.ts\0M\0ws/src/c.ts\0A\0top.txt\0",
            "ws/",
            &mut out,
        );
        let got: Vec<(String, char, Option<String>)> = out
            .into_iter()
            .map(|c| (c.path, c.status, c.from))
            .collect();
        assert_eq!(
            got,
            vec![
                ("src/b.ts".into(), 'R', Some("src/a.ts".into())),
                ("src/a.ts".into(), 'D', None),
                ("src/c.ts".into(), 'M', None),
                ("$repo/top.txt".into(), 'A', None),
            ]
        );
    }

    #[test]
    fn record_diffs() {
        let RecordDiff::Ids { ids, .. } =
            diff_a11y(r#"{"a":["x"],"b":[]}"#, r#"{"a":["x","y"],"c":[]}"#)
        else {
            panic!()
        };
        assert_eq!(ids, vec!["a", "b", "c"]);
        assert!(matches!(diff_a11y("{", "{}"), RecordDiff::All(_)));
        let RecordDiff::Ids { ids, removed } = diff_manifest(
            r#"{"stories":[{"id":"a","sig":"1"},{"id":"b"}]}"#,
            r#"{"stories":[{"id":"a","sig":"2"},{"id":"c"}]}"#,
        ) else {
            panic!()
        };
        assert_eq!(
            (ids, removed),
            (
                vec!["a".to_string(), "c".to_string()],
                vec!["b".to_string()]
            )
        );
        assert!(matches!(
            diff_manifest(r#"{"grid":1,"stories":[]}"#, r#"{"grid":2,"stories":[]}"#),
            RecordDiff::All(_)
        ));
        let RecordDiff::Ids { ids, .. } = diff_log(
            "{\"id\":\"a\"}\n",
            "{\"id\":\"a\"}\n{\"id\":\"b\"}\n{\"id\":\"b\"}\n",
            "approvals.ndjson",
        ) else {
            panic!()
        };
        assert_eq!(ids, vec!["b"]);
        assert!(matches!(
            diff_log("{\"id\":\"a\"}\n", "{\"id\":\"z\"}\n", "approvals.ndjson"),
            RecordDiff::All(_)
        ));
        assert!(matches!(
            diff_log("", "not json\n", "approvals.ndjson"),
            RecordDiff::All(_)
        ));
    }
}

#[cfg(test)]
mod repo_relative_tests {
    use super::repo_relative;
    use std::path::Path;

    #[test]
    fn changed_files_become_repo_relative() {
        assert_eq!(
            repo_relative(Path::new("/r/repo"), "src/a.tsx"),
            "src/a.tsx"
        );
        assert_eq!(
            repo_relative(Path::new("/r/repo"), "./src/a.tsx"),
            "src/a.tsx"
        );
        #[cfg(not(windows))]
        {
            assert_eq!(
                repo_relative(Path::new("/r/repo"), "/r/repo/src/a.tsx"),
                "src/a.tsx"
            );
            assert_eq!(
                repo_relative(Path::new("/r/repo/"), "/r/repo/src/a.tsx"),
                "src/a.tsx"
            );
            assert_eq!(
                repo_relative(Path::new("/r/repo"), "/elsewhere/a.tsx"),
                "/elsewhere/a.tsx"
            );
        }
        #[cfg(windows)]
        {
            assert_eq!(
                repo_relative(Path::new("C:\\Repo"), "c:\\repo\\src\\a.tsx"),
                "src/a.tsx"
            );
            assert_eq!(
                repo_relative(Path::new("C:\\Repo"), "src\\a.tsx"),
                "src/a.tsx"
            );
        }
    }
}

/// Fixture repositories built with git in a temp folder.
#[cfg(test)]
mod git_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static N: AtomicUsize = AtomicUsize::new(0);

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "pxsig-affected-{}-{}-{name}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    fn init(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        git(dir, &["config", "user.name", "test"]);
        git(dir, &["config", "commit.gpgsign", "false"]);
        git(dir, &["config", "core.autocrlf", "false"]);
    }

    fn commit(dir: &Path, msg: &str) {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-q", "-m", msg]);
    }

    /// A workspace: a story importing a component, a test, a data file, a store with records.
    fn workspace(ws: &Path) {
        write(ws, "src/Button/Button.tsx", "export const B = 1;\n");
        write(
            ws,
            "src/Button/Button.stories.tsx",
            "import { B } from './Button';\n",
        );
        write(
            ws,
            "src/Button/Button.test.tsx",
            "import { B } from './Button';\n",
        );
        write(ws, "src/Ünïcode/Card.stories.tsx", "export {};\n");
        write(ws, "src/data.json", "{}\n");
        write(ws, ".pxsig/baselines/Button/b.psig", "x");
        write(ws, ".pxsig/a11y.json", "{\"b\":[]}\n");
        write(ws, ".pxsig/approvals.ndjson", "{\"id\":\"b\"}\n");
        write(
            ws,
            ".pxsig/manifest.json",
            "{\"stories\":[{\"id\":\"b\",\"sig\":\".pxsig/baselines/Button/b.psig\"}]}\n",
        );
        write(
            ws,
            ".pxsig/manifest.matrix.json",
            "{\"stories\":[{\"id\":\"b@m\",\"sig\":\".pxsig/baselines/Button/b@m.psig\"}]}\n",
        );
        write(ws, ".pxsig/.gitignore", "renders/\n");
        write(ws, "README.md", "hi\n");
    }

    fn manifest(ignore: &[&str]) -> Manifest {
        serde_json::from_value(json!({
            "srcRoot": "src",
            "affectsAll": ["pxsig.config.json", ".storybook"],
            "affectsIgnore": ignore,
            "store": {
                "dir": ".pxsig", "a11y": ".pxsig/a11y.json", "approvals": ".pxsig/approvals.ndjson",
                "a11yDecisions": ".pxsig/a11y-decisions.ndjson",
                "manifests": { "": ".pxsig/manifest.json", "matrix": ".pxsig/manifest.matrix.json" }
            },
            "stories": [
                { "id": "b", "sig": ".pxsig/baselines/Button/b.psig", "importPath": "src/Button/Button.stories.tsx" },
                { "id": "c", "sig": ".pxsig/baselines/U/c.psig", "importPath": "src/Ünïcode/Card.stories.tsx" }
            ]
        }))
        .unwrap()
    }

    fn class_of(v: &Value, path: &str) -> String {
        v["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"] == path)
            .map(|f| f["class"].as_str().unwrap().to_string())
            .unwrap_or_else(|| panic!("{path} not in {v}"))
    }

    fn ids(v: &Value, key: &str) -> Vec<String> {
        let mut a: Vec<String> = v[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        a.sort();
        a
    }

    #[test]
    fn every_class() {
        let ws = tmp("classes");
        init(&ws);
        workspace(&ws);
        commit(&ws, "base");
        let m = manifest(&["docs/**", "**/*.md"]);
        let run = |files: &[&str]| {
            affected(
                &ws,
                &m,
                &changes_from_files(
                    &ws,
                    &files.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                ),
            )
            .unwrap()
        };

        let v = run(&["src/Button/Button.tsx"]);
        assert_eq!(
            (
                class_of(&v, "src/Button/Button.tsx"),
                ids(&v, "ids"),
                v["all"].clone()
            ),
            ("graph".into(), vec!["b".to_string()], json!(false))
        );
        let v = run(&["src/Button/Button.test.tsx"]);
        assert_eq!(
            (class_of(&v, "src/Button/Button.test.tsx"), ids(&v, "ids")),
            ("graph-no-entry".into(), vec![])
        );
        let v = run(&["src/Ünïcode/Card.stories.tsx"]);
        assert_eq!(ids(&v, "ids"), vec!["c"]);
        let v = run(&[".pxsig/baselines/Button/b.psig"]);
        assert_eq!(
            (
                class_of(&v, ".pxsig/baselines/Button/b.psig"),
                ids(&v, "ids"),
                ids(&v, "baselines")
            ),
            (
                "baseline".into(),
                vec!["b".to_string()],
                vec!["b".to_string()]
            )
        );
        let v = run(&[
            ".pxsig/baselines/Button/b@m.psig",
            ".pxsig/baselines/Gone/z.psig",
        ]);
        assert_eq!(
            class_of(&v, ".pxsig/baselines/Button/b@m.psig"),
            "baseline-other"
        );
        assert_eq!(v["otherSuites"]["matrix"], 1);
        assert!(v["files"][1]["why"].as_str().unwrap().contains("orphaned"));
        assert_eq!(ids(&v, "ids"), Vec::<String>::new());

        // Unchanged record named explicitly: every entry it names.
        let v = run(&[".pxsig/a11y.json"]);
        assert_eq!(
            (class_of(&v, ".pxsig/a11y.json"), ids(&v, "ids")),
            ("store-record".into(), vec!["b".to_string()])
        );
        let v = run(&[".pxsig/.gitignore"]);
        assert_eq!(
            (class_of(&v, ".pxsig/.gitignore"), v["all"].clone()),
            ("store-other".into(), json!(true))
        );
        assert_eq!(
            v["failSafe"],
            json!([]),
            "a store file is traced all, not the fail-safe"
        );

        // The fail-safe: untraced under srcRoot, outside srcRoot. `traced` leaves it out.
        let v = run(&["src/data.json", "src/Button/Button.tsx"]);
        assert_eq!(
            (
                class_of(&v, "src/data.json"),
                v["all"].clone(),
                ids(&v, "traced")
            ),
            ("untraced".into(), json!(true), vec!["b".to_string()])
        );
        assert_eq!(v["reason"], "src/data.json: nothing imports it");
        let v = run(&["package.json"]);
        assert_eq!(
            (class_of(&v, "package.json"), ids(&v, "ids").len()),
            ("outside".into(), 2)
        );
        let v = run(&[
            "docs/a.txt",
            "README.md",
            "src/Button/Button.llm-context.md",
        ]);
        assert_eq!(
            (v["all"].clone(), ids(&v, "ignored").len()),
            (json!(false), 3)
        );

        // The ignore list never hides a traced path, a baseline, a store file or an affects-all path.
        let m = manifest(&["**"]);
        let v = affected(
            &ws,
            &m,
            &changes_from_files(
                &ws,
                &[
                    "src/Button/Button.tsx".into(),
                    ".pxsig/baselines/Button/b.psig".into(),
                    ".pxsig/.gitignore".into(),
                    "pxsig.config.json".into(),
                ],
            ),
        )
        .unwrap();
        assert_eq!(class_of(&v, "src/Button/Button.tsx"), "graph");
        assert_eq!(class_of(&v, ".pxsig/baselines/Button/b.psig"), "baseline");
        assert_eq!(class_of(&v, ".pxsig/.gitignore"), "store-other");
        assert_eq!(class_of(&v, "pxsig.config.json"), "affects-all");
        let _ = fs::remove_dir_all(&ws);
    }

    /// A workspace for the resolver: one story per kind of import, each reaching one file.
    fn resolver_workspace(ws: &Path) {
        let story =
            |name: &str, body: &str| write(ws, &format!("src/{name}/{name}.stories.tsx"), body);
        write(ws, "src/data/a.json", "{}");
        story("Json", "import a from '../data/a.json';\n");
        write(ws, "src/icons/x.svg", "<svg/>");
        write(ws, "src/icons/y.svg", "<svg/>");
        story("Raw", "import t from '../docs/a.md?raw';\n");
        write(ws, "src/docs/a.md", "# a\n");
        write(
            ws,
            "src/styles/base.css",
            "@import './tokens.css';\n.a { background: url(img/bg.png); }\n",
        );
        write(ws, "src/styles/tokens.css", ":root {}\n");
        write(ws, "src/styles/img/bg.png", "png");
        story("Css", "import '../styles/base.css';\n");
        story(
            "Worker",
            "const w = new URL('../work/w.js', import.meta.url);\n",
        );
        write(ws, "src/work/w.js", "x\n");
        story("Glob", "const g = import.meta.glob('../icons/*.svg');\n");
        story(
            "Ctx",
            "const c = require.context('../locales', true, /json$/);\n",
        );
        write(ws, "src/locales/en/a.json", "{}");
        story("Tpl", "const i = (n) => import(`../flags/${n}.svg`);\n");
        write(ws, "src/flags/de.svg", "<svg/>");
        story("Esm", "import { e } from '../esm/e.js';\n");
        write(ws, "src/esm/e.ts", "export const e = 1;\n");
        story(
            "Font",
            "const face = { src: \"url('../fonts/a.woff2')\" };\n",
        );
        write(ws, "src/fonts/a.woff2", "font");
        // Bare specifiers: tsconfig paths, `#` imports, an alias, a self-import through `exports`
        // (dist mapped back to src), a workspace package, built-ins and an npm package.
        write(ws, "tsconfig.json", "{ \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"./src/lib/*\"] } }, // comment\n }");
        write(ws, "src/lib/l.ts", "export const l = 1;\n");
        story("Paths", "import { l } from '@lib/l';\n");
        write(ws, "package.json", "{ \"name\": \"me\", \"imports\": { \"#h/*\": \"./src/h/*.ts\" }, \"exports\": { \"./widgets/*\": { \"types\": \"./dist/widgets/*.d.ts\", \"import\": \"./dist/widgets/*.mjs\" } } }");
        write(ws, "src/h/h.ts", "export const h = 1;\n");
        story("Hash", "import { h } from '#h/h';\n");
        write(ws, "src/al/al.ts", "export const al = 1;\n");
        story("Alias", "import { al } from '~al/al';\n");
        write(ws, "src/widgets/w.tsx", "export const w = 1;\n");
        story("Self", "import { w } from 'me/widgets/w';\nimport fs from 'node:fs';\nimport p from 'path';\nimport r from 'react';\n");
        write(
            ws,
            "node_modules/react/package.json",
            "{ \"name\": \"react\" }",
        );
        write(
            ws,
            "packages/kit/package.json",
            "{ \"name\": \"kit\", \"main\": \"./dist/index.js\" }",
        );
        write(ws, "packages/kit/src/index.ts", "export const k = 1;\n");
        story("Virtual", "import s from 'virtual:status';\n");
        story("Accepted", "import s from 'virtual:other';\n");
        write(
            ws,
            ".storybook/preview.tsx",
            "import '../src/global.css.ts';\n",
        );
        write(ws, "src/global.css.ts", "export {};\n");
    }

    fn resolver_manifest() -> Manifest {
        let names = [
            "Json", "Raw", "Css", "Worker", "Glob", "Ctx", "Tpl", "Esm", "Font", "Paths", "Hash",
            "Alias", "Self", "Virtual", "Accepted", "Kit",
        ];
        let stories: Vec<Value> = names.iter().map(|n| json!({ "id": n.to_lowercase(), "sig": format!(".pxsig/baselines/{n}.psig"), "importPath": format!("src/{n}/{n}.stories.tsx") })).collect();
        serde_json::from_value(json!({
            "srcRoot": "src",
            "affectsAll": [".storybook"],
            "affectsAliases": { "~al": "src/al" },
            "affectsUnresolved": ["src/Accepted/**"],
            "stories": stories
        }))
        .unwrap()
    }

    #[test]
    fn the_resolver_follows_every_kind_of_import() {
        let ws = tmp("resolver");
        resolver_workspace(&ws);
        #[cfg(unix)]
        {
            fs::create_dir_all(ws.join("node_modules")).unwrap();
            std::os::unix::fs::symlink(ws.join("packages/kit"), ws.join("node_modules/kit"))
                .unwrap();
            write(&ws, "src/Kit/Kit.stories.tsx", "import { k } from 'kit';\n");
        }
        let m = resolver_manifest();
        let run = |f: &str| affected(&ws, &m, &changes_from_files(&ws, &[f.to_string()])).unwrap();
        for (file, id) in [
            ("src/data/a.json", "json"),
            ("src/docs/a.md", "raw"),
            ("src/styles/tokens.css", "css"),
            ("src/styles/img/bg.png", "css"),
            ("src/work/w.js", "worker"),
            ("src/icons/y.svg", "glob"),
            ("src/locales/en/a.json", "ctx"),
            ("src/flags/de.svg", "tpl"),
            ("src/esm/e.ts", "esm"),
            ("src/fonts/a.woff2", "font"),
            ("src/lib/l.ts", "paths"),
            ("src/h/h.ts", "hash"),
            ("src/al/al.ts", "alias"),
            ("src/widgets/w.tsx", "self"),
        ] {
            let v = run(file);
            assert_eq!(
                (class_of(&v, file), ids(&v, "traced")),
                ("graph".to_string(), vec![id.to_string()]),
                "{file}: {}",
                v["reason"]
            );
            // The unresolved `virtual:status` adds its story to every run; the accepted one adds nothing.
            assert_eq!(
                ids(&v, "ids"),
                {
                    let mut x = vec![id.to_string(), "virtual".to_string()];
                    x.sort();
                    x
                },
                "{file}"
            );
        }
        #[cfg(unix)]
        {
            let v = run("packages/kit/src/index.ts");
            assert_eq!(
                ids(&v, "traced"),
                vec!["kit"],
                "a workspace package's dist maps to its source: {}",
                v["reason"]
            );
        }
        let v = run("src/global.css.ts");
        assert_eq!(
            (v["all"].clone(), v["failSafe"].clone()),
            (json!(true), json!([])),
            "imported by an affects-all file: a traced all"
        );
        let v = run("src/Css/Css.stories.tsx");
        let u: Vec<(String, bool, String)> = v["unresolved"]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| {
                (
                    u["spec"].as_str().unwrap().to_string(),
                    u["accepted"].as_bool().unwrap(),
                    u["selects"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert!(
            u.contains(&("virtual:status".into(), false, "entries".into()))
                && u.contains(&("virtual:other".into(), true, "none".into())),
            "{u:?}"
        );
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn an_unresolved_import_in_an_affects_all_file_selects_all() {
        let ws = tmp("unresolved-all");
        write(&ws, "src/A/A.stories.tsx", "export {};\n");
        write(
            &ws,
            ".storybook/main.ts",
            "const s = import(`${dir}/status.mjs`);\n",
        );
        let mut m: Manifest = serde_json::from_value(json!({ "srcRoot": "src", "affectsAll": [".storybook"], "stories": [{ "id": "a", "sig": "a.psig", "importPath": "src/A/A.stories.tsx" }] })).unwrap();
        let v = affected(&ws, &m, &changes_from_files(&ws, &[])).unwrap();
        assert_eq!(
            (v["all"].clone(), v["failSafe"][0]["class"].clone()),
            (json!(true), json!("unresolved"))
        );
        m.affects_unresolved = vec![".storybook/main.ts".into()];
        let v = affected(&ws, &m, &changes_from_files(&ws, &[])).unwrap();
        assert_eq!(
            (v["all"].clone(), ids(&v, "ids")),
            (json!(false), Vec::<String>::new())
        );
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn records_against_the_merge_base() {
        let ws = tmp("records");
        init(&ws);
        workspace(&ws);
        commit(&ws, "base");
        git(&ws, &["checkout", "-q", "-b", "pr"]);
        write(
            &ws,
            ".pxsig/approvals.ndjson",
            "{\"id\":\"b\"}\n{\"id\":\"c\"}\n",
        );
        write(&ws, ".pxsig/a11y.json", "{\"b\":[\"x\"]}\n");
        commit(&ws, "approve");
        let m = manifest(&[]);
        let v = affected(&ws, &m, &changes_since(&ws, "main").unwrap()).unwrap();
        assert_eq!(ids(&v, "ids"), vec!["b", "c"]);
        assert_eq!(v["records"][".pxsig/approvals.ndjson"], json!(["c"]));
        assert_eq!(v["records"][".pxsig/a11y.json"], json!(["b"]));
        assert_eq!(v["all"], false);
        // A rewritten log selects everything.
        write(&ws, ".pxsig/approvals.ndjson", "{\"id\":\"c\"}\n");
        let v = affected(&ws, &m, &changes_since(&ws, "main").unwrap()).unwrap();
        assert_eq!(
            (v["all"].clone(), v["failSafe"].clone()),
            (json!(true), json!([]))
        );
        assert!(
            v["reason"].as_str().unwrap().contains("rewritten"),
            "{}",
            v["reason"]
        );
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn renames_keep_both_paths_and_unicode_names_match() {
        let ws = tmp("rename");
        init(&ws);
        workspace(&ws);
        commit(&ws, "base");
        git(&ws, &["checkout", "-q", "-b", "pr"]);
        git(
            &ws,
            &[
                "mv",
                "src/Ünïcode/Card.stories.tsx",
                "src/Ünïcode/Kärt.stories.tsx",
            ],
        );
        commit(&ws, "rename");
        let ch = changes_since(&ws, "main").unwrap();
        let paths: Vec<&str> = ch.files.iter().map(|c| c.path.as_str()).collect();
        assert!(
            paths.contains(&"src/Ünïcode/Card.stories.tsx")
                && paths.contains(&"src/Ünïcode/Kärt.stories.tsx"),
            "{paths:?}"
        );
        let v = affected(&ws, &manifest(&[]), &ch).unwrap();
        assert_eq!(
            ids(&v, "ids"),
            vec!["c"],
            "the old path is still entry c's importPath"
        );
        let renamed = v["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"] == "src/Ünïcode/Kärt.stories.tsx")
            .unwrap()
            .clone();
        assert_eq!(renamed["from"], "src/Ünïcode/Card.stories.tsx");
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn nested_workspace_paths_are_workspace_relative() {
        let repo = tmp("nested");
        init(&repo);
        let ws = repo.join("ws");
        workspace(&ws);
        write(&repo, "top.txt", "x\n");
        commit(&repo, "base");
        git(&repo, &["checkout", "-q", "-b", "pr"]);
        write(&ws, "src/Button/Button.tsx", "export const B = 2;\n");
        write(&repo, "top.txt", "y\n");
        commit(&repo, "edit");
        write(&ws, "src/new.json", "{}\n");
        let ch = changes_since(&ws, "main").unwrap();
        let v = affected(&ws, &manifest(&[]), &ch).unwrap();
        assert_eq!(class_of(&v, "src/Button/Button.tsx"), "graph");
        assert_eq!(class_of(&v, "src/new.json"), "untraced");
        assert_eq!(class_of(&v, "$repo/top.txt"), "outside-workspace");
        let v = affected(&ws, &manifest(&["$repo/top.txt", "src/*.json"]), &ch).unwrap();
        assert_eq!(
            (v["all"].clone(), ids(&v, "ids")),
            (json!(false), vec!["b".to_string()])
        );
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn no_merge_base_selects_everything() {
        let origin = tmp("origin");
        init(&origin);
        workspace(&origin);
        commit(&origin, "c1");
        git(&origin, &["checkout", "-q", "-b", "feature"]);
        write(&origin, "src/Button/Button.tsx", "export const B = 3;\n");
        commit(&origin, "c2");
        git(&origin, &["checkout", "-q", "main"]);
        write(&origin, "README.md", "main\n");
        commit(&origin, "c3");
        let clone = tmp("shallow");
        // file:// so --depth applies (a plain path makes a local, full clone); `C:/…` needs a third slash.
        let path = crate::io::to_slash(&origin);
        let url = if path.starts_with('/') {
            format!("file://{path}")
        } else {
            format!("file:///{path}")
        };
        git(
            &clone,
            &["clone", "-q", "--depth", "1", "--branch", "main", &url, "."],
        );
        git(
            &clone,
            &["fetch", "-q", "--depth", "1", "origin", "feature:feature"],
        );
        let ch = changes_since(&clone, "feature").unwrap();
        assert!(
            ch.fail_all
                .as_deref()
                .is_some_and(|w| w.contains("shallow clone")),
            "{:?}",
            ch.fail_all
        );
        let v = affected(&clone, &manifest(&[]), &ch).unwrap();
        assert_eq!(
            (
                v["all"].clone(),
                ids(&v, "ids").len(),
                v["failSafe"][0]["class"].clone()
            ),
            (json!(true), 2, json!("no-merge-base"))
        );
        assert!(
            changes_since(&clone, "no-such-ref").is_err(),
            "an unknown ref stays an error"
        );
        let _ = fs::remove_dir_all(&origin);
        let _ = fs::remove_dir_all(&clone);
    }
}
