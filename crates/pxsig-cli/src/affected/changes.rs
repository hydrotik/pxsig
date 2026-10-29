//! The changed paths: from git (`--since`) or a file list (`--files`), workspace-relative.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::paths::repo_relative;

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
    pub(super) top: Option<PathBuf>,
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
pub(super) fn parse_name_status(raw: &[u8], prefix: &str, out: &mut Vec<Change>) {
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
    pub(super) fn base_text(&self, ws_path: &str) -> String {
        let (Some(top), Some(base)) = (&self.top, &self.base) else {
            return String::new();
        };
        git_raw(top, &["show", &format!("{base}:{}{ws_path}", self.prefix)])
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default()
    }
}
