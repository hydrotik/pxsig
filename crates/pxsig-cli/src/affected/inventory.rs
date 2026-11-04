//! Every module file under the graph roots that reaches an entry (React analysis, `--all`).

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use crate::batch::Manifest;

use super::changes::changes_from_files;
use super::graph::graph;
use super::paths::{is_module, norm_str, normalize};

/// `path → entry ids` for each workspace module file that at least one entry's story file
/// imports, directly or not (the story files themselves included), sorted by path.
pub fn inventory(root: &Path, m: &Manifest) -> BTreeMap<String, Vec<String>> {
    let src_root = norm_str(m.src_root.as_deref().unwrap_or("src"));
    let g = graph(root, m, &src_root, changes_from_files(root, &[]).top, &[]);
    let mut imports: HashMap<&PathBuf, Vec<&PathBuf>> = HashMap::new();
    for (file, importers) in &g.rev {
        for i in importers {
            imports.entry(i).or_default().push(file);
        }
    }
    let mut by_story: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
    for s in &m.stories {
        if let Some(p) = &s.import_path {
            by_story
                .entry(normalize(Path::new(p)))
                .or_default()
                .push(s.id.clone());
        }
    }
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (story, ids) in &by_story {
        let mut seen: HashSet<&PathBuf> = HashSet::new();
        let mut q = VecDeque::from([story]);
        while let Some(f) = q.pop_front() {
            if !seen.insert(f) {
                continue;
            }
            if let Some(next) = imports.get(f) {
                q.extend(next.iter().copied());
            }
        }
        for f in seen {
            let p = crate::io::to_slash(f);
            if is_module(f) && !p.starts_with("$repo/") && !p.starts_with("../") {
                out.entry(p).or_default().extend(ids.iter().cloned());
            }
        }
    }
    for ids in out.values_mut() {
        ids.sort();
        ids.dedup();
    }
    out
}
