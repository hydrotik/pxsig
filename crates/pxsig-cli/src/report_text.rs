//! Text labels in `pxsig report`: summary.md's table of changed entries names a row's text kind
//! after its reasons (`· text: copy, reflow`), in the words of `lib/text/say.mjs` (`TEXT_SUFFIX`; a
//! test there keeps the two in step). Labels only: a row's `textDiff` never changes a verdict, the
//! summary's head and counts, or a JUnit outcome.

use serde_json::Value;

/// The suffix after a row's reasons: ` · text: <kind>` when its text was compared and the kind is
/// copy, copy-reflow, moved or restyled; empty for `pixel`, none and the states that compare
/// nothing.
pub fn suffix(row: &Value) -> String {
    let t = &row["textDiff"];
    if t["state"].as_str() != Some("compared") {
        return String::new();
    }
    let kind = match t["kind"].as_str() {
        Some("copy") => "copy",
        Some("copy-reflow") => "copy, reflow",
        Some("moved") => "moved",
        Some("restyled") => "restyled",
        _ => return String::new(),
    };
    format!(" · text: {kind}")
}

#[cfg(test)]
mod tests {
    use crate::report::{junit, markdown};
    use serde_json::{json, Value};

    /// A failing row, a passing one, a flaky one and a skipped one; with `text`, each gains a
    /// `textDiff` (a copy change, an environment that differs, a pixel change, none).
    fn report(text: bool) -> Value {
        let mut rows = vec![
            json!({ "id": "card--default@dark", "story": "card--default", "mode": "dark", "pass": false,
                    "metrics": { "ssim": 0.97, "changedCells": 4 }, "reasons": ["detail 19 tiles changed >= 3"],
                    "a11y": { "violations": [{ "id": "color-contrast" }], "new": 1 } }),
            json!({ "id": "card--default@light", "story": "card--default", "mode": "light", "pass": true,
                    "metrics": { "ssim": 1.0, "changedCells": 0 } }),
            json!({ "id": "tile--x@dark", "story": "tile--x", "mode": "dark", "pass": true, "flaky": true,
                    "metrics": { "ssim": 1.0, "changedCells": 0 } }),
            json!({ "id": "tile--y@dark", "story": "tile--y", "mode": "dark", "pass": true, "skipped": true }),
        ];
        if text {
            let labels = [
                json!({ "v": 1, "state": "compared", "kind": "copy-reflow", "kinds": ["copy", "moved"],
                        "counts": { "runs": 4, "copy": 1, "moved": 1, "rewrapped": 0, "restyled": 0, "added": 0, "removed": 0 },
                        "outsidePx": 0, "insidePx": 80, "elementPx": 0, "changes": [], "changeCount": 2 }),
                json!({ "v": 1, "state": "env-differs" }),
                json!({ "v": 1, "state": "compared", "kind": "pixel", "kinds": [], "counts": { "runs": 1, "copy": 0, "moved": 0, "rewrapped": 0, "restyled": 0, "added": 0, "removed": 0 },
                        "outsidePx": 9, "insidePx": 0, "elementPx": 0, "changes": [], "changeCount": 0 }),
                json!({ "v": 1, "state": "compared", "kind": null, "kinds": [], "counts": { "runs": 1, "copy": 0, "moved": 0, "rewrapped": 0, "restyled": 0, "added": 0, "removed": 0 },
                        "changes": [], "changeCount": 0 }),
            ];
            for (r, t) in rows.iter_mut().zip(labels) {
                r["textDiff"] = t;
            }
        }
        json!({ "rows": rows, "summary": { "totalMs": 1200.0 } })
    }

    /// The summary up to its table of changed entries: the head, the counts and the timing.
    fn head(md: &str) -> &str {
        md.split("| Story |").next().unwrap_or(md)
    }

    #[test]
    fn junit_is_the_same_with_and_without_text_labels() {
        assert_eq!(junit(&report(false)), junit(&report(true)));
    }

    #[test]
    fn the_summary_head_and_counts_are_the_same_with_and_without_text_labels() {
        let (off, on) = (
            markdown(&report(false), None),
            markdown(&report(true), None),
        );
        assert_eq!(head(&off), head(&on));
        assert!(
            head(&on).contains("### ❌ pxsig: visual changes need review"),
            "{on}"
        );
        assert!(head(&on).contains("| 3 | 1 | 1 | 1 | 1 | 1 |"), "{on}");
        // One table row per failing entry, and the a11y list, either way.
        let count = |md: &str, s: &str| md.matches(s).count();
        assert_eq!(
            count(&off, "| `card--default` |"),
            count(&on, "| `card--default` |")
        );
        assert_eq!(count(&on, "| `card--default` |"), 1);
        let a11y = |md: &str| md.split("<details>").nth(1).map(String::from);
        assert_eq!(a11y(&off), a11y(&on));
    }

    #[test]
    fn a_changed_entry_names_its_text_kind_after_its_reasons() {
        let md = markdown(&report(true), None);
        assert!(
            md.contains("| detail 19 tiles changed >= 3 · text: copy, reflow |"),
            "{md}"
        );
        let plain = markdown(&report(false), None);
        assert!(
            plain.contains("| detail 19 tiles changed >= 3 |"),
            "{plain}"
        );
    }

    #[test]
    fn the_suffix_only_for_a_compared_text_kind() {
        let row = |t: Value| json!({ "textDiff": t });
        for (kind, want) in [
            ("copy", " · text: copy"),
            ("copy-reflow", " · text: copy, reflow"),
            ("moved", " · text: moved"),
            ("restyled", " · text: restyled"),
            ("pixel", ""),
        ] {
            assert_eq!(
                super::suffix(&row(json!({ "state": "compared", "kind": kind }))),
                want
            );
        }
        assert_eq!(
            super::suffix(&row(json!({ "state": "compared", "kind": null }))),
            ""
        );
        assert_eq!(super::suffix(&row(json!({ "state": "env-differs" }))), "");
        assert_eq!(super::suffix(&json!({ "id": "a" })), "");
    }
}
