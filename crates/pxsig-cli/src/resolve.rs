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
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::Value;

mod config;
mod lookup;
mod scan;
#[cfg(test)]
mod tests;

use config::{normalize, parse_jsonc, Ts};
pub use scan::{scan_code, scan_style, scanner};

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
