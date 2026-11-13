//! Masks in `pxsig report`: summary.md says which entries the masks fail whatever any approval
//! does (`masksBlocked`: over half the capture together, or on the story root), which changed their
//! masks (`masksChanged`, for a person to review), and which are masked over a quarter of the
//! capture (`masksCoverage`, all masks together; `batch/masks.rs`), since such masks let most
//! changes under them pass. Lines only: they change no verdict, the summary's head and counts, or a
//! JUnit outcome; each failing entry also shows its reasons in the table of changed entries.

use serde_json::Value;

/// Entries named in a line; the rest are counted.
const NAMED: usize = 5;

/// One line over `rows` that `pick` names (with what it says of each), or nothing when none does.
fn line(
    rows: &[&Value],
    esc: fn(&str) -> String,
    pick: impl Fn(&Value) -> Option<String>,
    head: (&str, &str),
    tail: &str,
) -> String {
    let hits: Vec<String> = rows
        .iter()
        .filter(|r| r["skipped"] != Value::Bool(true))
        .filter_map(|r| {
            let what = pick(r)?;
            Some(format!(
                "`{}` ({what})",
                esc(r["id"].as_str().unwrap_or(""))
            ))
        })
        .collect();
    if hits.is_empty() {
        return String::new();
    }
    let more = hits.len().saturating_sub(NAMED);
    format!(
        "Masks: {} {} {tail}: {}{}.\n\n",
        hits.len(),
        if hits.len() == 1 { head.0 } else { head.1 },
        hits[..hits.len().min(NAMED)].join("; "),
        if more > 0 {
            format!("; {more} more")
        } else {
            String::new()
        }
    )
}

fn pct(v: &Value) -> String {
    format!("{:.0}%", v.as_f64().unwrap_or(0.0) * 100.0)
}

/// The masks lines (each with its blank line after), or nothing when no row has any of them.
pub fn lead(rows: &[&Value], esc: fn(&str) -> String) -> String {
    let blocked = line(
        rows,
        esc,
        |r| {
            r["masksBlocked"].as_object()?;
            let why = crate::batch::masks_blocked_reasons(&r["masksBlocked"]);
            Some(why.iter().map(|w| esc(w)).collect::<Vec<_>>().join("; "))
        },
        ("entry fails", "entries fail"),
        "on masks no approval passes until they are smaller (over 50% of the capture, on the story root, or not applied as asked)",
    );
    let changed = line(
        rows,
        esc,
        |r| {
            let ch = r["masksChanged"].as_object()?;
            let kinds: Vec<String> = ["added", "removed", "grew", "moved", "count"]
                .iter()
                .filter_map(|k| {
                    let n = ch.get(*k)?.as_array()?.len();
                    (n > 0)
                        .then(|| format!("{n} {}", if *k == "count" { "changed count" } else { k }))
                })
                .collect();
            Some(kinds.join(", "))
        },
        ("entry changed its", "entries changed their"),
        "masks, for a person to review before approving",
    );
    let large = line(
        rows,
        esc,
        |r| {
            let c = r["masksCoverage"].as_f64().filter(|c| *c > 0.25)?;
            r["masksBlocked"].is_null().then(|| pct(&c.into()))
        },
        ("entry is", "entries are"),
        "masked over 25% of the capture, which hides most changes under the masks",
    );
    format!("{blocked}{changed}{large}")
}

#[cfg(test)]
mod tests {
    use crate::report::markdown;
    use serde_json::json;

    #[test]
    fn masks_lines_name_blocked_changed_and_large_entries_and_change_no_count() {
        // Mask audit 13: summary.md never said a pull request changed masks; and the 25% line
        // weighs all of an entry's masks together (audit 5).
        let rows = json!({ "rows": [
            { "id": "clock--live", "pass": true, "metrics": { "ssim": 1.0 }, "masksCoverage": 0.31,
              "masksLarge": [] },
            { "id": "card--x", "pass": false, "metrics": { "ssim": 1.0, "changedCells": 0 },
              "reasons": ["masks changed: 1 added"], "masksCoverage": 0.1,
              "masksChanged": { "added": [".a|b"], "removed": [], "grew": [], "moved": [], "count": [] } },
            { "id": "page--all", "pass": false, "metrics": { "ssim": 1.0, "changedCells": 0 },
              "reasons": ["masks cover 88% of the capture, over 50%"], "masksCoverage": 0.88,
              "masksBlocked": { "coverage": 0.88, "root": ["#storybook-root > *"] } },
        ] });
        let md = markdown(&rows, None);
        assert!(
            md.contains("Masks: 1 entry fails on masks no approval passes until they are smaller (over 50% of the capture, on the story root, or not applied as asked): `page--all` (masks cover 88% of the capture, over 50%; a mask covers the story root: #storybook-root > *)."),
            "{md}"
        );
        assert!(
            md.contains("Masks: 1 entry changed its masks, for a person to review before approving: `card--x` (1 added)."),
            "{md}"
        );
        assert!(
            md.contains("Masks: 1 entry is masked over 25% of the capture, which hides most changes under the masks: `clock--live` (31%)."),
            "{md}"
        );
        assert!(md.contains("masks changed: 1 added"), "{md}");
        assert!(md.contains("| 3 | 1 | 2 |"), "counts unchanged: {md}");
        let plain = json!({ "rows": [{ "id": "a", "pass": true, "metrics": { "ssim": 1.0 } }] });
        assert!(!markdown(&plain, None).contains("Masks:"));
    }
}
