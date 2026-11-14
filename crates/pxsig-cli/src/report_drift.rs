//! Drift in `pxsig report`: summary.md says how many entries pass while their render differs from
//! the baseline (`summary.drift`, which the CLI's lib/drift.mjs counts), since such an entry keeps
//! its old baseline. A line only: it changes no verdict, the summary's head and counts, or a JUnit
//! outcome. Past `drift.warnAt` (`warn`) the line says so.

use serde_json::Value;

/// The drift line (with its blank line after), or nothing when no passing entry differs.
pub fn lead(v: &Value) -> String {
    let d = &v["summary"]["drift"];
    let n = |k: &str| d[k].as_u64().unwrap_or(0);
    let (count, of, other) = (n("count"), n("of"), n("otherEnv"));
    if count + other == 0 {
        return String::new();
    }
    let pct = (d["share"].as_f64().unwrap_or(0.0) * 1000.0).round() / 10.0;
    let entries = if of == 1 { "entry" } else { "entries" };
    let other = if other > 0 {
        format!(" {other} more were rendered in a different environment than their baseline.")
    } else {
        String::new()
    };
    if d["warn"] == Value::Bool(true) {
        let at = &d["warnAt"];
        let share = (at["share"].as_f64().unwrap_or(0.0) * 100.0).round();
        format!(
            "⚠️ Drift: {count} of {of} passing {entries} ({pct}%) differ from their baseline, at or over `drift.warnAt` ({} entries and {share}%). A change the gate does not see, such as a color change in a small area, passes this way, and their baselines stay as they were: `pxsig list drift` lists them.{other}\n\n",
            at["count"].as_u64().unwrap_or(0)
        )
    } else {
        format!(
            "Drift: {count} of {of} passing {entries} ({pct}%) differ from their baseline, within the gate. Their baselines stay as they were (`pxsig list drift`).{other}\n\n"
        )
    }
}

#[cfg(test)]
mod tests {
    use crate::report::markdown;
    use serde_json::json;

    fn report(drift: serde_json::Value) -> serde_json::Value {
        json!({ "summary": { "drift": drift }, "rows": [{ "id": "a", "pass": true, "metrics": { "ssim": 1.0 } }] })
    }

    #[test]
    fn drift_is_one_line_and_says_when_it_is_past_warn_at() {
        let at = json!({ "count": 5, "share": 0.2 });
        let md = markdown(
            &report(
                json!({ "count": 12, "of": 161, "share": 0.075, "otherEnv": 2, "warnAt": at, "warn": false }),
            ),
            None,
        );
        assert!(
            md.contains("Drift: 12 of 161 passing entries (7.5%) differ from their baseline, within the gate. Their baselines stay as they were (`pxsig list drift`). 2 more were rendered in a different environment than their baseline.\n\n"),
            "{md}"
        );
        assert!(md.contains("| 1 | 1 | 0 |"), "counts unchanged: {md}");
        let md = markdown(
            &report(
                json!({ "count": 136, "of": 161, "share": 0.845, "otherEnv": 0, "warnAt": at, "warn": true }),
            ),
            None,
        );
        assert!(
            md.contains("⚠️ Drift: 136 of 161 passing entries (84.5%) differ from their baseline, at or over `drift.warnAt` (5 entries and 20%)."),
            "{md}"
        );
        assert!(md.starts_with("### ✅"), "the head stays: {md}");
        let none = report(
            json!({ "count": 0, "of": 161, "share": 0, "otherEnv": 0, "warnAt": at, "warn": false }),
        );
        assert!(!markdown(&none, None).contains("Drift"));
        let old = json!({ "rows": [{ "id": "a", "pass": true }] });
        assert!(
            !markdown(&old, None).contains("Drift"),
            "a report without it"
        );
    }
}
