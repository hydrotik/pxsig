//! Large masks in `pxsig report`: summary.md says which entries have a mask over a quarter of the
//! capture (`masksLarge`, `batch/masks.rs`), since such a mask lets most changes under it pass. A
//! warning only: it changes no verdict, the summary's head and counts, or a JUnit outcome. A mask
//! change itself is a row's reason (`masks changed: …`) and shows in the table of changed entries.

use serde_json::Value;

/// Entries named in the warning line; the rest are counted.
const NAMED: usize = 5;

/// The warning line (with its blank line after), or nothing when no row has a large mask.
pub fn lead(rows: &[&Value], esc: fn(&str) -> String) -> String {
    let large: Vec<(&str, Vec<String>)> = rows
        .iter()
        .filter(|r| r["skipped"] != Value::Bool(true))
        .filter_map(|r| {
            let masks = r["masksLarge"].as_array().filter(|a| !a.is_empty())?;
            let sels = masks
                .iter()
                .map(|m| {
                    let pct = m["area"].as_f64().unwrap_or(0.0) * 100.0;
                    format!("`{}` {pct:.0}%", esc(m["selector"].as_str().unwrap_or("")))
                })
                .collect();
            Some((r["id"].as_str().unwrap_or(""), sels))
        })
        .collect();
    if large.is_empty() {
        return String::new();
    }
    let named: Vec<String> = large
        .iter()
        .take(NAMED)
        .map(|(id, sels)| format!("`{}` ({})", esc(id), sels.join(", ")))
        .collect();
    let more = large.len().saturating_sub(NAMED);
    format!(
        "Masks: {} {} a mask over 25% of the capture, which hides most changes under it: {}{}.\n\n",
        large.len(),
        if large.len() == 1 {
            "entry has"
        } else {
            "entries have"
        },
        named.join("; "),
        if more > 0 {
            format!("; {more} more")
        } else {
            String::new()
        }
    )
}

#[cfg(test)]
mod tests {
    use crate::report::markdown;
    use serde_json::json;

    #[test]
    fn a_large_mask_is_one_warning_line_and_changes_no_count() {
        let rows = json!({ "rows": [
            { "id": "clock--live", "pass": true, "metrics": { "ssim": 1.0 },
              "masksLarge": [{ "selector": "[data-volatile]", "source": "attribute", "area": 0.62 }] },
            { "id": "card--x", "pass": false, "metrics": { "ssim": 1.0, "changedCells": 0 },
              "reasons": ["masks changed: 1 added"], "masksChanged": { "added": [".a|b"], "removed": [], "grew": [] } },
        ] });
        let md = markdown(&rows, None);
        assert!(
            md.contains("Masks: 1 entry has a mask over 25% of the capture, which hides most changes under it: `clock--live` (`[data-volatile]` 62%)."),
            "{md}"
        );
        assert!(md.contains("masks changed: 1 added"), "{md}");
        assert!(md.contains("| 2 | 1 | 1 |"), "counts unchanged: {md}");
        let plain = json!({ "rows": [{ "id": "a", "pass": true, "metrics": { "ssim": 1.0 } }] });
        assert!(!markdown(&plain, None).contains("Masks:"));
    }
}
