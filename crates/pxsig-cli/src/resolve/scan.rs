//! What a file names: the specifier scanners for code and style sheets.

use std::path::Path;

use super::{Found, Ref, CODE, STYLE};

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
