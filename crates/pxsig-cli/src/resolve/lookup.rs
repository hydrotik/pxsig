//! Which file, folder or pattern a specifier stands for: `Resolver::resolve` and its steps.

use std::path::{Path, PathBuf};

use super::config::{conditions, exports_target, match_key, normalize, remote, strip_suffix};
use super::{
    split_package, src_root, Found, Ref, Resolver, Target, BUILTINS, OUTPUT_DIRS, RESOLVE_EXTS,
};

impl Resolver {
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
