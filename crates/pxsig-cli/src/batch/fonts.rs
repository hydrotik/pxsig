//! The fonts a render's text was drawn in (`<id>.fonts.json` beside the PNG, written by the
//! capture, `lib/capture/fonts.mjs`): a `.psig` baseline stores the record as its header's `fonts`,
//! so a later check can say when a render drew its text in other faces (docs/spec.md, section 5).
//! A render with no record (Firefox, WebKit, an older pxsig) writes no key.

use crate::io;
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// `<id>.fonts.json` beside `<id>.png`, when there is one.
pub fn beside(png: &Path) -> Option<PathBuf> {
    let f = png.with_extension("fonts.json");
    f.is_file().then_some(f)
}

/// The header's `fonts` for the render at `png`: its record, read and checked (`v` 1, a `used`
/// array whose faces each have a `family` or a `digest`, `glyphs` and `web`); None without one.
pub fn for_baseline(png: &Path) -> Result<Option<Value>> {
    let Some(file) = beside(png) else {
        return Ok(None);
    };
    // Named by its file name only: the message reaches the dashboard, and a full path names the user.
    let name = io::file_name(&file);
    let raw = fs::read(&file).with_context(|| format!("reading {name}"))?;
    let v: Value = serde_json::from_slice(&raw).with_context(|| format!("{name} is not JSON"))?;
    let faces = match (v.get("v"), v.get("used")) {
        (Some(ver), Some(Value::Array(u))) if ver == &Value::from(1) => u,
        _ => bail!("{name} is not a fonts record (v 1 with used)"),
    };
    let ok = |f: &Value| {
        (f["family"].is_string() ^ f["digest"].is_string())
            && f["glyphs"].is_u64()
            && f["web"].is_boolean()
    };
    if !faces.iter().all(ok) {
        bail!("{name}: each face needs a family or a digest, glyphs and web");
    }
    Ok(Some(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, body: &str) -> PathBuf {
        let png = dir.join("a--b.png");
        fs::write(&png, b"").unwrap();
        fs::write(dir.join("a--b.fonts.json"), body).unwrap();
        png
    }

    #[test]
    fn a_record_is_kept_as_written() {
        let d = crate::batch::tests::scratch("fonts-kept");
        let body = r#"{"v":1,"used":[{"family":"Inter","glyphs":3,"web":true},{"digest":"0a1b2c3d","glyphs":1,"web":false}],"elements":2}"#;
        let v = for_baseline(&write(&d, body)).unwrap().unwrap();
        assert_eq!(v, serde_json::from_str::<Value>(body).unwrap());
    }

    #[test]
    fn no_record_is_none_and_a_bad_one_is_an_error() {
        let d = crate::batch::tests::scratch("fonts-bad");
        let png = d.join("x.png");
        assert!(for_baseline(&png).unwrap().is_none());
        let both = r#"{"v":1,"used":[{"family":"A","digest":"0a1b2c3d","glyphs":1,"web":false}]}"#;
        let e = for_baseline(&write(&d, both)).unwrap_err().to_string();
        assert!(e.contains("a family or a digest"), "{e}");
        assert!(!e.contains(&*d.to_string_lossy()), "no path: {e}");
        let e = for_baseline(&write(&d, r#"{"v":2,"used":[]}"#))
            .unwrap_err()
            .to_string();
        assert!(e.contains("not a fonts record"), "{e}");
    }
}
