//! The React analysis cache: one file's compile result per content hash, under
//! `<store>/cache/react/<k[0..2]>/<k>.json`.
//!
//! `k` = sha256 of `pxsig-react 1`, the compile key (backend and its version, the Babel version,
//! the options) as canonical JSON, the parser plugins and the file's bytes. The path is not in the
//! key: a result holds names and lines, the path is added at comparison, so a moved file is a hit.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// `v` with every object's keys sorted, so equal options always hash the same.
pub fn canonical(v: &Value) -> Value {
    match v {
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|k| (k.clone(), canonical(&o[k])))
                    .collect::<Map<String, Value>>(),
            )
        }
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// The cache key of one side of a file.
pub fn key(compile_key: &Value, parser: &[&str], bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b"pxsig-react 1\0");
    h.update(canonical(compile_key).to_string().as_bytes());
    h.update(b"\0");
    h.update(parser.join(",").as_bytes());
    h.update(b"\0");
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn path(dir: &Path, k: &str) -> PathBuf {
    dir.join(&k[..2]).join(format!("{k}.json"))
}

/// A cached result (`{ functions: […] }`), or `None`: absent, or corrupt (a miss either way).
pub fn read(dir: &Path, k: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(&fs::read_to_string(path(dir, k)).ok()?).ok()?;
    (v["v"] == 1 && v["result"]["functions"].is_array()).then(|| v["result"].clone())
}

/// Store a result; written to a temporary name and renamed, so a reader never sees half of one.
pub fn write(dir: &Path, k: &str, result: &Value) -> Result<()> {
    let out = path(dir, k);
    if let Some(d) = out.parent() {
        fs::create_dir_all(d).with_context(|| format!("creating {}", d.display()))?;
    }
    let tmp = out.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, json!({ "v": 1, "result": result }).to_string())
        .with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, &out).with_context(|| format!("writing {}", out.display()))
}
