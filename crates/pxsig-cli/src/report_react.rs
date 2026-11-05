//! The React section of `summary.md`: quiet unless there is an alert (like the a11y default),
//! then one bullet per alert below the table. Alerts only: no lead block, no change to the head
//! line, no ADVISORY wording (that belongs to warn-mode gates).

use serde_json::Value;

/// Compiler alerts (`react.alerts` in check.json) and entries React was still committing in at
/// capture (`renders.settled: false` on a row).
pub fn section(v: &Value) -> String {
    let mut lines: Vec<String> = Vec::new();
    for a in v["react"]["alerts"].as_array().into_iter().flatten() {
        let text = a["text"].as_str().unwrap_or("").replace('\n', " ");
        let line = match a["name"]
            .as_str()
            .and_then(|n| text.strip_prefix(n).map(|rest| (n, rest)))
        {
            Some((name, rest)) => format!("- `{name}`{rest}"),
            None => format!("- {text}"),
        };
        lines.push(line);
    }
    let rows = v.get("rows").or_else(|| v.get("results"));
    for r in rows.and_then(Value::as_array).into_iter().flatten() {
        let renders = &r["renders"];
        if renders["settled"] == false {
            lines.push(format!(
                "- `{}`: React was still committing when pxsig captured it ({} commits).",
                r["id"].as_str().unwrap_or(""),
                renders["mount"]["commits"].as_u64().unwrap_or(0)
            ));
        }
    }
    if lines.is_empty() {
        return String::new();
    }
    format!("\n### React (alerts, not blocking)\n{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn quiet_without_an_alert() {
        assert_eq!(
            section(&json!({ "rows": [{ "id": "a", "pass": true }] })),
            ""
        );
        assert_eq!(
            section(
                &json!({ "react": { "alerts": [] }, "rows": [{ "id": "a", "renders": { "settled": true } }] })
            ),
            ""
        );
        // A row without React (`renders: null`) is not an alert.
        assert_eq!(
            section(&json!({ "rows": [{ "id": "a", "renders": null }] })),
            ""
        );
    }

    #[test]
    fn one_bullet_per_alert_with_the_name_in_code() {
        let v = json!({
            "react": { "alerts": [{
                "kind": "compiler", "name": "Button", "path": "src/Button/Button.tsx",
                "text": "Button (src/Button/Button.tsx): compiled at main, skipped now: Cannot access refs during render (refs, line 18). Reaches 12 entries."
            }] },
            "rows": [
                { "id": "button--primary@dark", "renders": { "settled": false, "mount": { "commits": 14 } } },
                { "id": "button--primary@light", "renders": { "settled": true, "mount": { "commits": 1 } } }
            ]
        });
        assert_eq!(
            section(&v),
            "\n### React (alerts, not blocking)\n\
             - `Button` (src/Button/Button.tsx): compiled at main, skipped now: Cannot access refs during render (refs, line 18). Reaches 12 entries.\n\
             - `button--primary@dark`: React was still committing when pxsig captured it (14 commits).\n"
        );
    }

    #[test]
    fn the_markdown_report_carries_the_section_only_with_an_alert() {
        let quiet = json!({ "rows": [{ "id": "a", "pass": true }] });
        assert!(!crate::report::markdown(&quiet, None).contains("### React"));
        let loud = json!({ "rows": [{ "id": "a", "pass": true, "renders": { "settled": false, "mount": { "commits": 3 } } }] });
        let md = crate::report::markdown(&loud, None);
        assert!(md.starts_with("### ✅ pxsig: no visual changes"), "{md}");
        assert!(md.ends_with("\n### React (alerts, not blocking)\n- `a`: React was still committing when pxsig captured it (3 commits).\n"), "{md}");
    }
}
