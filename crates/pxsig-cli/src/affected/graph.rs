//! The import graph: every file under the graph roots and, for each, the files that import it.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

use crate::batch::Manifest;
use crate::resolve::{scan_code, scan_style, scanner, Resolver, Target};

use super::paths::{glob_match, norm_str, normalize, under, walk};

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
