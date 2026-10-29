//! Path normalisation, JSONC, `tsconfig.json` and `package.json` `exports` / `imports` matching.

use std::path::{Component, Path, PathBuf};

use serde_json::Value;

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
pub(super) fn strip_suffix(s: &str) -> &str {
    let s = s.split('?').next().unwrap_or(s);
    match s.char_indices().skip(1).find(|(_, c)| *c == '#') {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

pub(super) fn remote(s: &str) -> bool {
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
pub(super) struct Ts {
    pub(super) paths: Vec<(String, Vec<String>)>,
    pub(super) paths_base: PathBuf,
    pub(super) base_url: Option<PathBuf>,
}

/// One pattern map (`exports` subpaths, `imports`, tsconfig `paths`): the exact key, else the
/// `*` key with the longest prefix. Returns the value and what `*` matched.
pub(super) fn match_key<'a, V>(
    map: impl Iterator<Item = (&'a String, V)>,
    want: &str,
) -> Option<(V, String)> {
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
pub(super) fn conditions(v: &Value) -> Option<String> {
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

pub(super) fn exports_target(exports: &Value, sub: &str) -> Option<String> {
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
