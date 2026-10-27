//! The import resolver behind `pxsig affected` (docs/ci.md, "How selection decides"): what a
//! file names, and which file, folder or pattern each name stands for.
//!
//! Scanned: code (`ts tsx mts cts js jsx mjs cjs mdx`) for `from`, `import`, `import(`,
//! `require(`, `new URL('…', import.meta.url)`, `import.meta.glob`, `require.context` and `url(…)`
//! in string literals; styles (`css scss sass less pcss`) for `@import`, `@use`, `@forward`,
//! `from` and `url(…)`. Comments are read too: an extra edge can only select more.
//!
//! A specifier resolves, in order, as a relative path, a Node built-in (external),
//! `affects.aliases`, `tsconfig.json` `paths` and `baseUrl`, `package.json` `imports` (`#…`), or a
//! package: the project itself or a workspace package through `exports`, a build output mapped
//! back to its source. Anything in `node_modules` outside the workspace is external. Whatever is
//! left (`virtual:*`, an unknown alias, a non-literal `import(x)`) is **unresolved**, and the
//! caller adds the entries that reach the file holding it to every run (decision 6.1d).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;

use serde_json::Value;

/// Tried after a specifier with no extension, in this order.
const RESOLVE_EXTS: [&str; 9] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json"];
/// Read for imports as code.
pub const CODE: [&str; 9] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "mdx"];
/// Read for imports as a style sheet.
pub const STYLE: [&str; 5] = ["css", "scss", "sass", "less", "pcss"];
/// Folders a build writes into: a target there is built from the package's source.
const OUTPUT_DIRS: [&str; 4] = ["dist", "build", ".turbo", "__pixels__"];

const BUILTINS: [&str; 44] = [
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "sys",
    "timers",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
    "test",
    "sqlite",
];

/// What a file names, as written.
#[derive(Debug, Clone, PartialEq)]
pub enum Ref {
    /// `import … from 'x'`, `import('x')`, `require('x')`, `new URL('x', import.meta.url)`, CSS `@import`.
    Spec(String),
    /// `url(x)` in a style sheet or a string literal: relative unless it says otherwise.
    Url(String),
    /// `import.meta.glob(…)` patterns (negations dropped).
    Glob(Vec<String>),
    /// `require.context('dir', …)`: every file under `dir`.
    Context(String),
    /// A template literal: its static text up to the first `${`, and the text after the last `}`.
    Template { prefix: String, suffix: String },
}

#[derive(Debug, Clone)]
pub struct Found {
    pub r: Ref,
    pub line: usize,
}

impl Found {
    /// The specifier as written, for messages.
    pub fn text(&self) -> String {
        match &self.r {
            Ref::Spec(s) | Ref::Url(s) | Ref::Context(s) => s.clone(),
            Ref::Glob(p) => p.join(", "),
            Ref::Template { prefix, suffix } => format!("`{prefix}${{…}}{suffix}`"),
        }
    }
}

/// What a name stands for.
#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    /// A file: workspace-relative with `/`, or `$repo/<path>` outside the workspace.
    File(String),
    /// Every file under a folder, optionally only those ending in `suffix`.
    Under {
        dir: String,
        suffix: String,
    },
    /// Every file a workspace-relative glob matches.
    Glob(String),
    /// Outside what a change in this repository can reach (a package in `node_modules`, `node:fs`).
    External,
    /// Nothing to follow (`data:` URIs, `#fragment` references, an empty string).
    Skip,
    Remote(String),
    Unresolved(String),
}

fn word_before(b: &[u8], i: usize) -> bool {
    i > 0 && (b[i - 1].is_ascii_alphanumeric() || matches!(b[i - 1], b'_' | b'$' | b'.'))
}

fn skip_ws(b: &[u8], mut j: usize, parens: bool) -> usize {
    while j < b.len() && (matches!(b[j], b' ' | b'\t' | b'\n' | b'\r') || (parens && b[j] == b'('))
    {
        j += 1;
    }
    j
}

/// A quoted string at `j`: (text, end index after the closing quote). Template literals may span lines.
fn read_str(b: &[u8], j: usize) -> Option<(String, usize, u8)> {
    let q = *b.get(j)?;
    if !matches!(q, b'\'' | b'"' | b'`') {
        return None;
    }
    let mut k = j + 1;
    while k < b.len() {
        match b[k] {
            b'\\' => k += 2,
            c if c == q => {
                return Some((String::from_utf8_lossy(&b[j + 1..k]).into_owned(), k + 1, q))
            }
            b'\n' if q != b'`' => return None,
            _ => k += 1,
        }
    }
    None
}

/// A specifier-shaped string: not empty, no whitespace or code punctuation (`from 'the dashboard'`
/// in prose, or `'Closed from')).toHaveAttribute('` across two string literals, is not one).
fn spec_like(s: &str) -> bool {
    let first = s
        .chars()
        .next()
        .is_some_and(|c| c.is_alphanumeric() || ".@#/~_$-".contains(c));
    first
        && !s
            .chars()
            .any(|c| c.is_whitespace() || "()[]{};,'\"<>|\\`".contains(c))
}

fn literal(text: String, quote: u8) -> Option<Ref> {
    if quote == b'`' {
        if let Some(open) = text.find("${") {
            let suffix = text
                .rfind('}')
                .map(|c| text[c + 1..].to_string())
                .unwrap_or_default();
            return Some(Ref::Template {
                prefix: text[..open].to_string(),
                suffix,
            });
        }
    }
    spec_like(&text).then_some(Ref::Spec(text))
}

struct Lines(Vec<usize>);
impl Lines {
    fn new(b: &[u8]) -> Self {
        Lines(
            std::iter::once(0)
                .chain(
                    b.iter()
                        .enumerate()
                        .filter(|(_, &c)| c == b'\n')
                        .map(|(i, _)| i + 1),
                )
                .collect(),
        )
    }
    fn at(&self, i: usize) -> usize {
        self.0.partition_point(|&s| s <= i)
    }
}

/// `url(…)` at `j` (just after `url(`): its content, unquoted. `None` for an empty or computed one.
fn read_url(b: &[u8], j: usize) -> Option<String> {
    let j = skip_ws(b, j, false);
    let raw = if let Some((s, _, _)) = read_str(b, j) {
        s
    } else {
        let end = b[j..].iter().position(|&c| c == b')' || c == b'\n')?;
        String::from_utf8_lossy(&b[j..j + end]).trim().to_string()
    };
    (spec_like(&raw) && !raw.contains("${") && !raw.contains("var(")).then_some(raw)
}

/// Everything a code module names.
pub fn scan_code(src: &str) -> Vec<Found> {
    let b = src.as_bytes();
    let lines = Lines::new(b);
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let rest = &b[i..];
        let push = |out: &mut Vec<Found>, r: Ref| {
            out.push(Found {
                r,
                line: lines.at(i),
            })
        };
        if word_before(b, i) {
            i += 1;
            continue;
        }
        if rest.starts_with(b"import.meta.glob") {
            let mut j = i + "import.meta.glob".len();
            while j < b.len() && b[j].is_ascii_alphanumeric() {
                j += 1; // globEager
            }
            if j < b.len() && b[j] == b'<' {
                j += b[j..].iter().position(|&c| c == b'>').unwrap_or(0) + 1;
            }
            let mut j = skip_ws(b, j, true);
            let mut pats = Vec::new();
            let list = b.get(j) == Some(&b'[');
            if list {
                j += 1;
            }
            loop {
                j = skip_ws(b, j, false);
                let Some((s, end, _)) = read_str(b, j) else {
                    break;
                };
                if !s.starts_with('!') {
                    pats.push(s);
                }
                j = skip_ws(b, end, false);
                if !list || b.get(j) != Some(&b',') {
                    break;
                }
                j += 1;
            }
            if !pats.is_empty() {
                push(&mut out, Ref::Glob(pats));
            }
            i = j.max(i + 1);
            continue;
        }
        if rest.starts_with(b"require.context") {
            let j = skip_ws(b, i + "require.context".len(), true);
            if let Some((s, end, _)) = read_str(b, j) {
                push(&mut out, Ref::Context(s));
                i = end;
                continue;
            }
        }
        if rest.starts_with(b"new URL(") {
            let j = skip_ws(b, i + "new URL(".len(), false);
            if let Some((s, end, q)) = read_str(b, j) {
                let tail = &b[end..b.len().min(end + 64)];
                let close = tail.iter().position(|&c| c == b')').unwrap_or(tail.len());
                if String::from_utf8_lossy(&tail[..close]).contains("import.meta.url") {
                    if let Some(r) = literal(s, q) {
                        push(&mut out, r);
                    }
                }
                i = end;
                continue;
            }
        }
        if rest.starts_with(b"url(") {
            if let Some(u) = read_url(b, i + 4) {
                push(&mut out, Ref::Url(u));
            }
            i += 4;
            continue;
        }
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
        let j0 = skip_ws(b, i + skip, false);
        let call = b.get(j0) == Some(&b'(');
        let j = skip_ws(b, j0, true);
        if let Some((s, end, q)) = read_str(b, j) {
            // A template literal is a specifier only in a call (`import(`…`)`); after `from` it is
            // prose in a comment (`from \`defaultValue\``).
            if q != b'`' || call {
                if let Some(r) = literal(s, q) {
                    push(&mut out, r);
                }
            }
            i = end;
            continue;
        }
        i += skip;
    }
    out
}

/// Everything a style sheet names.
pub fn scan_style(src: &str) -> Vec<Found> {
    let b = src.as_bytes();
    let lines = Lines::new(b);
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let rest = &b[i..];
        let kw = [&b"@import"[..], b"@use", b"@forward", b"from"]
            .into_iter()
            .find(|k| rest.starts_with(k));
        if let Some(k) = kw {
            if k == b"from" && word_before(b, i) {
                i += 1;
                continue;
            }
            let j = skip_ws(b, i + k.len(), false);
            if let Some((s, end, _)) = read_str(b, j) {
                if spec_like(&s) {
                    out.push(Found {
                        r: Ref::Spec(s),
                        line: lines.at(i),
                    });
                }
                i = end;
                continue;
            }
            i += k.len();
            continue;
        }
        if rest.starts_with(b"url(") && !word_before(b, i) {
            if let Some(u) = read_url(b, i + 4) {
                out.push(Found {
                    r: Ref::Url(u),
                    line: lines.at(i),
                });
            }
            i += 4;
            continue;
        }
        i += 1;
    }
    out
}

pub fn ext_of(p: &str) -> &str {
    Path::new(p)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
}

/// The scanner for a file, by extension: `Some(true)` code, `Some(false)` style, `None` not read.
pub fn scanner(p: &str) -> Option<bool> {
    let e = ext_of(p);
    if CODE.contains(&e) {
        Some(true)
    } else if STYLE.contains(&e) {
        Some(false)
    } else {
        None
    }
}

pub fn normalize(p: &Path) -> PathBuf {
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

/// `?raw`, `?url`, `#hash` off (a leading `#` is a package import, kept).
fn strip_suffix(s: &str) -> &str {
    let s = s.split('?').next().unwrap_or(s);
    match s.char_indices().skip(1).find(|(_, c)| *c == '#') {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

fn remote(s: &str) -> bool {
    let l = s.to_ascii_lowercase();
    l.starts_with("http:") || l.starts_with("https:") || l.starts_with("//")
}

/// JSON with comments and trailing commas (tsconfig.json).
pub fn parse_jsonc(text: &str) -> Option<Value> {
    // One pass each: comments out, then commas before `}` or `]`; both skip strings.
    let pass = |b: &[u8], comments: bool| -> Vec<u8> {
        let mut out = Vec::with_capacity(b.len());
        let mut i = 0;
        while i < b.len() {
            match b[i] {
                b'"' => {
                    let start = i;
                    i += 1;
                    while i < b.len() && b[i] != b'"' {
                        i += if b[i] == b'\\' { 2 } else { 1 };
                    }
                    i = (i + 1).min(b.len());
                    out.extend_from_slice(&b[start..i]);
                }
                b'/' if comments && b.get(i + 1) == Some(&b'/') => {
                    while i < b.len() && b[i] != b'\n' {
                        i += 1;
                    }
                }
                b'/' if comments && b.get(i + 1) == Some(&b'*') => {
                    i += 2;
                    while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                        i += 1;
                    }
                    i += 2;
                }
                b',' if !comments
                    && matches!(
                        b[i + 1..].iter().find(|c| !c.is_ascii_whitespace()),
                        Some(b'}') | Some(b']')
                    ) =>
                {
                    i += 1
                }
                c => {
                    out.push(c);
                    i += 1;
                }
            }
        }
        out
    };
    serde_json::from_slice(&pass(&pass(text.as_bytes(), true), false)).ok()
}

/// `compilerOptions.paths` and `baseUrl` of one tsconfig, after `extends`.
#[derive(Default)]
struct Ts {
    paths: Vec<(String, Vec<String>)>,
    paths_base: PathBuf,
    base_url: Option<PathBuf>,
}

/// One pattern map (`exports` subpaths, `imports`, tsconfig `paths`): the exact key, else the
/// `*` key with the longest prefix. Returns the value and what `*` matched.
fn match_key<'a, V>(map: impl Iterator<Item = (&'a String, V)>, want: &str) -> Option<(V, String)> {
    let mut best: Option<(usize, V, String)> = None;
    for (k, v) in map {
        if k == want {
            return Some((v, String::new()));
        }
        if let Some((pre, post)) = k.split_once('*') {
            if want.len() >= pre.len() + post.len()
                && want.starts_with(pre)
                && want.ends_with(post)
                && best.as_ref().is_none_or(|b| pre.len() > b.0)
            {
                best = Some((
                    pre.len(),
                    v,
                    want[pre.len()..want.len() - post.len()].to_string(),
                ));
            }
        }
    }
    best.map(|(_, v, s)| (v, s))
}

/// An `exports`/`imports` value under the conditions pxsig reads: `source`, `development`,
/// `import`, `default`, `require`, then any other but `types`.
fn conditions(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Array(a) => a.iter().find_map(conditions),
        Value::Object(o) => ["source", "development", "import", "default", "require"]
            .iter()
            .find_map(|k| o.get(*k).and_then(conditions))
            .or_else(|| {
                o.iter()
                    .filter(|(k, _)| k.as_str() != "types")
                    .find_map(|(_, v)| conditions(v))
            }),
        _ => None,
    }
}

fn exports_target(exports: &Value, sub: &str) -> Option<String> {
    let subpaths = exports
        .as_object()
        .filter(|o| o.keys().any(|k| k.starts_with('.')));
    let (v, star) = match subpaths {
        Some(o) => match_key(o.iter(), sub)?,
        None if sub == "." => (exports, String::new()),
        None => return None,
    };
    Some(conditions(v)?.replace('*', &star))
}

pub struct Resolver {
    root: PathBuf,
    real_root: Option<PathBuf>,
    top: Option<PathBuf>,
    /// `affects.aliases`, longest key first; targets workspace-relative.
    aliases: Vec<(String, String)>,
    deleted: HashSet<String>,
    ts: HashMap<PathBuf, Option<Rc<Ts>>>,
    pkg: HashMap<PathBuf, Option<Rc<Value>>>,
    /// Source roots of the workspace packages reached, for the caller to walk.
    pub roots: Vec<String>,
}

impl Resolver {
    pub fn new(
        root: &Path,
        top: Option<PathBuf>,
        aliases: &[(String, String)],
        deleted: HashSet<String>,
    ) -> Self {
        let mut aliases = aliases.to_vec();
        aliases.sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
        let root = if root.is_absolute() {
            root.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|d| normalize(&d.join(root)))
                .unwrap_or_else(|_| root.to_path_buf())
        };
        Resolver {
            root: root.clone(),
            real_root: fs::canonicalize(&root).ok(),
            top,
            aliases,
            deleted,
            ts: HashMap::new(),
            pkg: HashMap::new(),
            roots: Vec::new(),
        }
    }

    /// The graph key for an absolute path: workspace-relative, `$repo/…`, or `None` outside the
    /// repository or inside `node_modules`.
    pub fn key_of(&self, abs: &Path) -> Option<String> {
        let abs = normalize(abs);
        let rel = abs.strip_prefix(normalize(&self.root)).ok().or_else(|| {
            self.real_root
                .as_ref()
                .and_then(|r| abs.strip_prefix(r).ok())
        });
        let key = match rel {
            Some(r) => crate::io::to_slash(r),
            None => {
                let top = self.top.as_ref()?;
                let r = abs
                    .strip_prefix(normalize(top))
                    .ok()
                    .map(Path::to_path_buf)
                    .or_else(|| {
                        fs::canonicalize(top)
                            .ok()
                            .and_then(|t| abs.strip_prefix(&t).ok().map(Path::to_path_buf))
                    })?;
                format!("$repo/{}", crate::io::to_slash(&r))
            }
        };
        (!key.split('/').any(|s| s == "node_modules")).then_some(key)
    }

    pub fn abs_of(&self, key: &str) -> PathBuf {
        match (key.strip_prefix("$repo/"), &self.top) {
            (Some(rest), Some(top)) => top.join(rest),
            _ => self.root.join(key),
        }
    }

    fn package_json(&mut self, dir: &Path) -> Option<Rc<Value>> {
        if let Some(v) = self.pkg.get(dir) {
            return v.clone();
        }
        let v = fs::read_to_string(dir.join("package.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .map(Rc::new);
        self.pkg.insert(dir.to_path_buf(), v.clone());
        v
    }

    /// The nearest folder at or above `dir` with a package.json that satisfies `want`.
    fn nearest_package(
        &mut self,
        dir: &Path,
        want: impl Fn(&Value) -> bool,
    ) -> Option<(PathBuf, Rc<Value>)> {
        let mut d = Some(dir);
        while let Some(x) = d {
            if x.file_name().is_some_and(|n| n == "node_modules") {
                return None;
            }
            if let Some(v) = self.package_json(x) {
                if want(&v) {
                    return Some((x.to_path_buf(), v));
                }
            }
            d = x.parent();
        }
        None
    }

    /// The folder `node_modules/<name>` resolves to from `dir`, through links.
    fn installed(&self, dir: &Path, name: &str) -> Option<PathBuf> {
        dir.ancestors()
            .map(|d| d.join("node_modules").join(name))
            .find(|p| p.join("package.json").is_file())
            .and_then(|p| fs::canonicalize(p).ok())
    }

    fn tsconfig(&mut self, file_dir: &Path) -> Option<Rc<Ts>> {
        if let Some(v) = self.ts.get(file_dir) {
            return v.clone();
        }
        let root = normalize(&self.root);
        let mut found = None;
        for d in file_dir.ancestors() {
            let p = d.join("tsconfig.json");
            if p.is_file() {
                found = Some(p);
                break;
            }
            if normalize(d) == root {
                break;
            }
        }
        let v = found.map(|p| {
            let mut ts = Ts::default();
            self.load_ts(&p, &mut ts, 0);
            Rc::new(ts)
        });
        self.ts.insert(file_dir.to_path_buf(), v.clone());
        v
    }

    /// Fold a tsconfig and what it extends into `ts` (the file's own values win).
    fn load_ts(&mut self, path: &Path, ts: &mut Ts, depth: usize) {
        let Some(v) = fs::read_to_string(path).ok().and_then(|t| parse_jsonc(&t)) else {
            return;
        };
        let dir = path.parent().unwrap_or(Path::new("")).to_path_buf();
        if depth < 10 {
            let ext = match &v["extends"] {
                Value::String(s) => vec![s.clone()],
                Value::Array(a) => a
                    .iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect(),
                _ => vec![],
            };
            for e in ext {
                let p = if e.starts_with('.') || Path::new(&e).is_absolute() {
                    Some(dir.join(&e))
                } else {
                    let (name, sub) = split_package(&e);
                    self.installed(&dir, &name).map(|p| {
                        if sub == "." {
                            p.join("tsconfig.json")
                        } else {
                            p.join(&sub[2..])
                        }
                    })
                };
                if let Some(p) = p {
                    let p = if p.is_file() {
                        p
                    } else {
                        PathBuf::from(format!("{}.json", p.display()))
                    };
                    self.load_ts(&p, ts, depth + 1);
                }
            }
        }
        let co = &v["compilerOptions"];
        if let Some(b) = co["baseUrl"].as_str() {
            ts.base_url = Some(normalize(&dir.join(b)));
        }
        if let Some(o) = co["paths"].as_object() {
            ts.paths = o
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        v.as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect(),
                    )
                })
                .collect();
            ts.paths_base = dir;
        }
    }

    /// What `f`, found in the file at `from` (a graph key), names.
    pub fn resolve(&mut self, from: &str, f: &Found, style: bool) -> Target {
        let from_abs = self.abs_of(from);
        let dir = from_abs.parent().unwrap_or(Path::new("")).to_path_buf();
        match &f.r {
            Ref::Glob(pats) => {
                // One edge per pattern: the first that is not relative decides.
                if let Some(p) = pats.iter().find(|p| !p.starts_with('.')) {
                    return Target::Unresolved(format!("glob `{p}` is not relative"));
                }
                let keys: Vec<String> = pats
                    .iter()
                    .filter_map(|p| {
                        self.key_of(&dir.join(p))
                            .map(|k| k.trim_end_matches('/').to_string())
                    })
                    .collect();
                match keys.len() {
                    0 => Target::External,
                    _ => Target::Glob(if keys.len() == 1 {
                        keys[0].clone()
                    } else {
                        format!("{{{}}}", keys.join(","))
                    }),
                }
            }
            Ref::Context(d) => match self.key_of(&dir.join(d)) {
                Some(k) if d.starts_with('.') => Target::Under {
                    dir: k,
                    suffix: String::new(),
                },
                _ => Target::Unresolved(format!("require.context(`{d}`) is not relative")),
            },
            Ref::Template { prefix, suffix } => {
                if !prefix.starts_with("./") && !prefix.starts_with("../") {
                    return Target::Unresolved(
                        "a template literal with no relative static prefix".into(),
                    );
                }
                let folder = &prefix[..prefix.rfind('/').unwrap_or(0)];
                match self.key_of(&dir.join(folder)) {
                    Some(k) => Target::Under {
                        dir: k,
                        suffix: strip_suffix(suffix).to_string(),
                    },
                    None => Target::External,
                }
            }
            Ref::Spec(s) | Ref::Url(s) => {
                let url = matches!(f.r, Ref::Url(_));
                if remote(s) {
                    return Target::Remote(s.clone());
                }
                if s.starts_with("data:") || (url && s.starts_with('#')) || s.starts_with("about:")
                {
                    return Target::Skip;
                }
                let s = strip_suffix(s);
                if s.is_empty() {
                    return Target::Skip;
                }
                let relative = s.starts_with("./") || s.starts_with("../") || s == "." || s == "..";
                if relative || (url && !s.starts_with('/') && !s.contains(':')) {
                    return self.file(&dir.join(s), style);
                }
                if s.starts_with('/') {
                    return Target::Unresolved(
                        "a root-relative path (served, not imported)".into(),
                    );
                }
                if style {
                    // CSS `@import 'x.css'` is relative first; Sass `~pkg` is a package.
                    if let t @ Target::File(_) = self.file(&dir.join(s), true) {
                        return t;
                    }
                }
                self.bare(
                    if style { s.trim_start_matches('~') } else { s },
                    &dir,
                    style,
                )
            }
        }
    }

    fn bare(&mut self, s: &str, dir: &Path, style: bool) -> Target {
        let builtin = s.strip_prefix("node:").unwrap_or(s);
        if s.starts_with("node:") || BUILTINS.contains(&builtin.split('/').next().unwrap_or("")) {
            return Target::External;
        }
        if let Some((k, v)) = self
            .aliases
            .iter()
            .find(|(k, _)| {
                s == k
                    || s.strip_prefix(k.as_str())
                        .is_some_and(|r| r.starts_with('/') || k.ends_with('/'))
            })
            .cloned()
        {
            let rest = s[k.len()..].trim_start_matches('/');
            let abs = self.root.join(&v).join(rest);
            return match self.file(&abs, style) {
                Target::Unresolved(_) => {
                    Target::Unresolved(format!("affects.aliases `{k}` → {v}: no such file"))
                }
                t => t,
            };
        }
        if s.starts_with('#') {
            return self.imports(s, dir, style);
        }
        if s.contains(':') {
            return Target::Unresolved("a virtual or scheme specifier".into());
        }
        if let Some(ts) = self.tsconfig(dir) {
            let base = ts.base_url.clone().unwrap_or_else(|| ts.paths_base.clone());
            if let Some((targets, star)) = match_key(ts.paths.iter().map(|(k, v)| (k, v)), s) {
                for t in targets.clone() {
                    if let t @ (Target::File(_) | Target::Under { .. }) =
                        self.file(&base.join(t.replace('*', &star)), style)
                    {
                        return t;
                    }
                }
            }
            if let Some(b) = ts.base_url.clone() {
                if let t @ Target::File(_) = self.file(&b.join(s), style) {
                    return t;
                }
            }
        }
        self.package(s, dir, style)
    }

    fn imports(&mut self, s: &str, dir: &Path, style: bool) -> Target {
        let Some((pkg, v)) = self.nearest_package(dir, |v| v["imports"].is_object()) else {
            return Target::Unresolved("no package.json `imports`".into());
        };
        let Some(t) = match_key(v["imports"].as_object().unwrap().iter(), s)
            .and_then(|(v, star)| conditions(v).map(|t| t.replace('*', &star)))
        else {
            return Target::Unresolved("package.json `imports` does not list it".into());
        };
        if t.starts_with("./") {
            self.file(&pkg.join(t), style)
        } else {
            self.package(&t, &pkg, style)
        }
    }

    fn package(&mut self, s: &str, dir: &Path, style: bool) -> Target {
        let (name, sub) = split_package(s);
        let me = self
            .nearest_package(dir, |v| v["name"].as_str() == Some(name.as_str()))
            .map(|(d, _)| d);
        let Some(pkg) = me.or_else(|| self.installed(dir, &name)) else {
            return Target::Unresolved(format!("package `{name}` is not installed"));
        };
        if self.key_of(&pkg).is_none() {
            return Target::External;
        }
        let Some(v) = self.package_json(&pkg) else {
            return Target::External;
        };
        let src = src_root(&pkg);
        if let Some(k) = self.key_of(&src) {
            self.roots.push(k);
        }
        let target = if !v["exports"].is_null() {
            match exports_target(&v["exports"], &sub) {
                Some(t) => pkg.join(t),
                None => {
                    return Target::Unresolved(format!("`exports` of {name} does not list {sub}"))
                }
            }
        } else if sub == "." {
            pkg.join(
                v["source"]
                    .as_str()
                    .or(v["module"].as_str())
                    .or(v["main"].as_str())
                    .unwrap_or("index"),
            )
        } else {
            pkg.join(&sub[2..])
        };
        self.file(&target, style)
    }

    /// A path on disk: the file itself, `<p>.<ext>`, `<p>/index.<ext>`, the TypeScript source for
    /// a `.js` name, Sass partials; a build output maps to the package source it is built from.
    fn file(&mut self, abs: &Path, style: bool) -> Target {
        let abs = normalize(abs);
        let s = abs.to_string_lossy().into_owned();
        let mut cands = vec![abs.clone()];
        cands.extend(
            RESOLVE_EXTS
                .iter()
                .map(|e| PathBuf::from(format!("{s}.{e}"))),
        );
        cands.extend(RESOLVE_EXTS.iter().map(|e| abs.join(format!("index.{e}"))));
        for (from, to) in [
            ("js", &["ts", "tsx"][..]),
            ("mjs", &["mts"]),
            ("cjs", &["cts"]),
            ("jsx", &["tsx"]),
        ] {
            if let Some(stem) = s.strip_suffix(&format!(".{from}")) {
                cands.extend(to.iter().map(|t| PathBuf::from(format!("{stem}.{t}"))));
            }
        }
        if style {
            let name = abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let parent = abs.parent().unwrap_or(Path::new(""));
            for e in ["scss", "sass", "css", "less"] {
                cands.push(PathBuf::from(format!("{s}.{e}")));
                cands.push(parent.join(format!("_{name}.{e}")));
                cands.push(parent.join(format!("_{name}")));
                cands.push(abs.join(format!("_index.{e}")));
                cands.push(abs.join(format!("index.{e}")));
            }
        }
        for c in &cands {
            if c.is_file() {
                return match self.key_of(c) {
                    Some(k) => self.out_of_build(c, &k).unwrap_or(Target::File(k)),
                    None => Target::External,
                };
            }
        }
        for c in &cands {
            if let Some(k) = self.key_of(c) {
                if self.deleted.contains(&k) {
                    return Target::File(k);
                }
            }
        }
        match self.key_of(&abs) {
            Some(k) => self
                .out_of_build(&abs, &k)
                .unwrap_or_else(|| Target::Unresolved("no such file".into())),
            None => Target::External,
        }
    }

    /// A path inside a package's build output (`dist/…`): its source file by mirroring
    /// (`dist/a/index.mjs` → `src/a/index.ts`), else every file of the package's source root.
    fn out_of_build(&mut self, abs: &Path, key: &str) -> Option<Target> {
        let segs: Vec<&str> = key.split('/').collect();
        let at = segs.iter().position(|s| OUTPUT_DIRS.contains(s))?;
        let out_dir = self.abs_of(&segs[..at].join("/"));
        let (pkg, _) = self.nearest_package(&out_dir, |_| true)?;
        let src = src_root(&pkg);
        let src_key = self.key_of(&src)?;
        self.roots.push(src_key.clone());
        let inner = segs[at + 1..].join("/");
        let stem = inner
            .split_once('.')
            .map_or(inner.as_str(), |(a, _)| a)
            .to_string();
        let mut cands = vec![src.join(&inner)];
        cands.extend(
            RESOLVE_EXTS
                .iter()
                .chain(["css.ts", "mdx"].iter())
                .map(|e| src.join(format!("{stem}.{e}"))),
        );
        if let Some(k) = cands
            .iter()
            .find(|c| c.is_file())
            .and_then(|c| self.key_of(c))
        {
            return Some(Target::File(k));
        }
        let _ = abs;
        Some(Target::Under {
            dir: src_key,
            suffix: String::new(),
        })
    }
}

/// `@scope/name/sub/path` → (`@scope/name`, `./sub/path`); no subpath → `.`.
fn split_package(s: &str) -> (String, String) {
    let n = if s.starts_with('@') { 2 } else { 1 };
    let parts: Vec<&str> = s.splitn(n + 1, '/').collect();
    let name = parts[..parts.len().min(n)].join("/");
    let sub = if parts.len() > n {
        format!("./{}", parts[n])
    } else {
        ".".into()
    };
    (name, sub)
}

/// A package's source root: `src/` when it has one, else the package folder.
fn src_root(pkg: &Path) -> PathBuf {
    let s = pkg.join("src");
    if s.is_dir() {
        s
    } else {
        pkg.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specs(src: &str) -> Vec<Ref> {
        scan_code(src).into_iter().map(|f| f.r).collect()
    }

    #[test]
    fn reads_every_form() {
        let src = r#"
            import React from 'react';
            import { Button } from '../Button';
            export * from "./Card.css";
            const L = React.lazy(() => import('./Lazy'));
            const x = require('./legacy');
            import raw from './a.md?raw';
            const u = new URL('./worker.js', import.meta.url);
            const g = import.meta.glob(['./icons/*.svg', '!./icons/x.svg']);
            const ctx = require.context('./locales', true, /\.json$/);
            const i = import(`./icons/${name}.svg`);
            const font = { src: "url('./fonts/a.woff2') format('woff2')" };
            // taken from 'the dashboard' — prose, not a specifier
        "#;
        assert_eq!(
            specs(src),
            vec![
                Ref::Spec("react".into()),
                Ref::Spec("../Button".into()),
                Ref::Spec("./Card.css".into()),
                Ref::Spec("./Lazy".into()),
                Ref::Spec("./legacy".into()),
                Ref::Spec("./a.md?raw".into()),
                Ref::Spec("./worker.js".into()),
                Ref::Glob(vec!["./icons/*.svg".into()]),
                Ref::Context("./locales".into()),
                Ref::Template {
                    prefix: "./icons/".into(),
                    suffix: ".svg".into()
                },
                Ref::Url("./fonts/a.woff2".into()),
            ]
        );
        assert_eq!(
            scan_code("a\nb\nimport './x';").first().map(|f| f.line),
            Some(3)
        );
    }

    #[test]
    fn reads_style_sheets() {
        let src = "@import 'base.css';\n@use \"sass:math\";\n@forward './tokens';\n.a { background: url(img/a.png); composes: b from './b.css'; }\n.c { background: url(\"https://x.test/a.png\"); mask: url(#m); }";
        let got: Vec<Ref> = scan_style(src).into_iter().map(|f| f.r).collect();
        assert_eq!(
            got,
            vec![
                Ref::Spec("base.css".into()),
                Ref::Spec("sass:math".into()),
                Ref::Spec("./tokens".into()),
                Ref::Url("img/a.png".into()),
                Ref::Spec("./b.css".into()),
                Ref::Url("https://x.test/a.png".into()),
                Ref::Url("#m".into()),
            ]
        );
    }

    #[test]
    fn jsonc_and_patterns() {
        let v = parse_jsonc("{ // c\n \"a\": [1, 2,], /* b */ \"s\": \"x // not a comment\", }")
            .unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "a": [1, 2], "s": "x // not a comment" })
        );
        let ex = serde_json::json!({ ".": { "types": "./d.ts", "import": "./dist/index.mjs" }, "./icons/*": "./dist/icons/*.js", "./x": null });
        assert_eq!(exports_target(&ex, "."), Some("./dist/index.mjs".into()));
        assert_eq!(
            exports_target(&ex, "./icons/a"),
            Some("./dist/icons/a.js".into())
        );
        assert_eq!(exports_target(&ex, "./x"), None);
        assert_eq!(exports_target(&ex, "./nope"), None);
        assert_eq!(
            exports_target(
                &serde_json::json!({ "source": "./src/i.ts", "default": "./dist/i.js" }),
                "."
            ),
            Some("./src/i.ts".into())
        );
        assert_eq!(split_package("@a/b/c/d"), ("@a/b".into(), "./c/d".into()));
        assert_eq!(split_package("lodash"), ("lodash".into(), ".".into()));
        assert_eq!(strip_suffix("./a.svg?url#x"), "./a.svg");
        assert_eq!(strip_suffix("#internal/a"), "#internal/a");
    }
}
