//! The text record of a render: `<id>.boxes.json` beside `<id>.png`, written by the capture when
//! text capture is on (packages/pxsig/src/lib/capture/boxes.mjs). A baseline written from that
//! render stores it as its `boxes` section, deflated (docs/spec.md, section 5). Nothing here reads
//! the record's runs or boxes: they are labels for a later step, never part of the gate.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use pxsig_core::psig::{Section, MAX_INFLATED};
use serde_json::{json, Map, Value};

/// The text record that belongs to a render: `<dir>/<id>.boxes.json` beside `<dir>/<id>.png`,
/// when the file exists.
pub fn beside(png: &Path) -> Option<PathBuf> {
    let f = png.with_extension("boxes.json");
    f.is_file().then_some(f)
}

/// The `boxes` section for a text record: the file, read and checked (a JSON object, `v` 1, a
/// `runs` array), then deflated, its run count in the table entry. Any other file is an error, so
/// a baseline never stores what is not a text record.
pub fn section(file: &Path) -> Result<Section> {
    let len = fs::metadata(file)
        .with_context(|| format!("reading {}", file.display()))?
        .len();
    if len > MAX_INFLATED {
        bail!(
            "{}: a text record over {MAX_INFLATED} bytes is not stored",
            file.display()
        );
    }
    let text = fs::read(file).with_context(|| format!("reading {}", file.display()))?;
    let v: Value =
        serde_json::from_slice(&text).with_context(|| format!("{} is not JSON", file.display()))?;
    let runs = match (v.get("v"), v.get("runs")) {
        (Some(ver), Some(Value::Array(runs))) if ver == &json!(1) => runs.len(),
        _ => bail!("{} is not a text record (v 1 with runs)", file.display()),
    };
    let mut keys = Map::new();
    keys.insert("runs".into(), json!(runs));
    Section::json("boxes", &v, Some(&keys)).map_err(|e| anyhow::anyhow!(e))
}

/// The extra sections for a baseline written from `png`: its text record's, when `boxes` names
/// one; none otherwise.
pub fn sections_for(boxes: Option<&Path>) -> Result<Vec<Section>> {
    boxes.map(section).into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pxsig-boxes-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_text_record_becomes_a_deflated_boxes_section_with_its_run_count() {
        let d = scratch("ok");
        let rec = json!({ "v": 1, "frame": { "w": 10, "h": 10 }, "styles": [],
            "runs": [{ "path": "0/#0", "s": "1 ", "st": 0, "boxes": [[0, 0, 5, 9]] }],
            "elements": [], "skipped": {}, "truncated": false });
        fs::write(d.join("a.boxes.json"), rec.to_string()).unwrap();
        fs::write(d.join("a.png"), b"x").unwrap();
        let f = beside(&d.join("a.png")).unwrap();
        let s = section(&f).unwrap();
        assert_eq!(s.name(), "boxes");
        assert_eq!(s.meta["encoding"], json!("deflate"));
        assert_eq!(s.meta["runs"], json!(1));
        let back: Value = serde_json::from_slice(&s.data().unwrap()).unwrap();
        assert_eq!(back, rec);
        assert!(beside(&d.join("b.png")).is_none(), "no record, no section");
        assert!(sections_for(None).unwrap().is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn anything_else_is_an_error() {
        let d = scratch("bad");
        for (name, body) in [
            ("a", "not json"),
            ("b", "[1, 2]"),
            ("c", r#"{ "v": 2, "runs": [] }"#),
            ("d", r#"{ "v": 1, "runs": {} }"#),
        ] {
            let f = d.join(format!("{name}.boxes.json"));
            fs::write(&f, body).unwrap();
            assert!(section(&f).is_err(), "{name}: {body}");
        }
        let _ = fs::remove_dir_all(&d);
    }
}
