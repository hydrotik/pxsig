//! `pxsig report`: render a check result as Markdown (PR comment / job summary)
//! or JUnit XML (CI test reporters). Reads either the CLI's `check --json`
//! output (`results`) or a store's `reports/check.json` (`rows`).

use serde_json::Value;

fn rows(v: &Value) -> Vec<&Value> {
    v.get("rows").or_else(|| v.get("results")).and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
}

fn esc_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn esc_md(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

fn status(r: &Value) -> &'static str {
    if r["skipped"] == Value::Bool(true) {
        "skipped"
    } else if r["pass"] == Value::Bool(true) {
        if r["flaky"] == Value::Bool(true) { "flaky" } else { "pass" }
    } else {
        "fail"
    }
}

fn a11y_count(r: &Value) -> u64 {
    r["a11y"]["violations"].as_array().map(|a| a.len() as u64).unwrap_or(0)
}

pub fn markdown(v: &Value, link_base: Option<&str>) -> String {
    let rs = rows(v);
    let count = |s: &str| rs.iter().filter(|r| status(r) == s).count();
    let (pass, fail, flaky, skipped) = (count("pass"), count("fail"), count("flaky"), count("skipped"));
    let a11y_new: u64 = rs.iter().map(|r| r["a11y"]["new"].as_u64().unwrap_or(0)).sum();
    let mut out = advisory_lead(v);
    let head = if fail == 0 { "✅ pxsig: no visual changes" } else { "❌ pxsig: visual changes need review" };
    out.push_str(&format!("### {head}\n\n"));
    out.push_str("| Checked | Passed | Changed | Flaky | Skipped (unaffected) | New a11y violations |\n|---:|---:|---:|---:|---:|---:|\n");
    out.push_str(&format!("| {} | {pass} | {fail} | {flaky} | {skipped} | {a11y_new} |\n\n", rs.len() - skipped));
    if let Some(s) = v.get("summary") {
        let ms = s["totalMs"].as_f64().or(s["elapsedMs"].as_f64()).unwrap_or(0.0);
        if ms > 0.0 {
            out.push_str(&format!("<sub>{:.1} s total", ms / 1000.0));
            if let Some(r) = s["renderWallMs"].as_f64() {
                out.push_str(&format!(" · render {:.1} s", r / 1000.0));
            }
            if let Some(e) = s["rustEngineMs"].as_f64() {
                out.push_str(&format!(" · Rust engine {:.0} ms", e));
            }
            if let Some(a) = s["affected"].as_str() {
                out.push_str(&format!(" · {}", esc_md(a)));
            }
            out.push_str("</sub>\n\n");
        }
    }
    // The selection's fail-safe fired (`check --since/--changed`): say which path, so a reviewer sees
    // why every entry was checked and which `affects.ignore` entry would narrow it.
    if let Some(sa) = v["summary"].get("selectAll").filter(|x| x.is_object()) {
        let what = match sa["path"].as_str() {
            Some(p) => format!("`{}` (`{}`)", esc_md(p), sa["class"].as_str().unwrap_or("")),
            None => esc_md(sa["why"].as_str().unwrap_or("")),
        };
        let more = sa["more"].as_u64().unwrap_or(0);
        out.push_str(&format!(
            "All {} entries selected: {what}{}.\n\n",
            sa["entries"].as_u64().unwrap_or(0),
            if more > 0 { format!("; {more} more reasons in check.json") } else { String::new() }
        ));
    }
    // Renders made in a different environment than their baseline (decision 1.4): only when any were.
    let env_n = v["summary"]["envMismatch"].as_u64().unwrap_or(0);
    if env_n > 0 {
        let fields: Vec<String> = v["summary"]["envFields"].as_array().into_iter().flatten().filter_map(Value::as_str).map(esc_md).collect();
        let what = if fields.is_empty() { String::new() } else { format!(" ({})", fields.join(", ")) };
        out.push_str(&format!(
            "Environment: {env_n} of {} entries were rendered in a different environment than their baseline{what}. A change there can be the machine, not the code (`pxsig doctor`).\n\n",
            rs.len() - skipped
        ));
    }
    // Baselines the pull request changed, by how each was approved (decision 80). Names no person.
    if let Some(ap) = v["summary"].get("approvals").filter(|x| x.is_object()) {
        if ap["rewritten"].as_bool() == Some(true) {
            out.push_str("Baselines changed in this PR: the approval log was rewritten, not appended to (`pxsig approve verify --since` fails).\n\n");
        } else {
            let n = |k: &str| ap[k].as_u64().unwrap_or(0);
            let other = if n("other") > 0 { format!(", {} other", n("other")) } else { String::new() };
            let by_agent = ap["agents"].as_object().cloned().unwrap_or_default();
            let agents: Vec<String> = by_agent
                .iter()
                .map(|(k, c)| if by_agent.len() == 1 { esc_md(k) } else { format!("{} ({})", esc_md(k), c.as_u64().unwrap_or(0)) })
                .collect();
            let marked = if agents.is_empty() {
                String::new()
            } else {
                let total: u64 = ap["agents"].as_object().into_iter().flatten().filter_map(|(_, c)| c.as_u64()).sum();
                format!("; {total} with an assistant marker: {}", agents.join(", "))
            };
            out.push_str(&format!(
                "Baselines changed in this PR: {} ({} approved in the dashboard, {} in the terminal, {} via MCP{other}){marked}.\n\n",
                n("total"),
                n("dashboard"),
                n("terminal"),
                n("mcp"),
            ));
        }
    }
    let failing: Vec<&&Value> = rs.iter().filter(|r| status(r) == "fail").collect();
    if !failing.is_empty() {
        out.push_str("| Story | Mode | ssim | Changed cells | Detail tiles | Why |\n|---|---|---:|---:|---:|---|\n");
        for r in failing.iter().take(50) {
            let id = r["story"].as_str().or(r["id"].as_str()).unwrap_or("");
            let key = r["id"].as_str().unwrap_or("");
            let name = match link_base {
                Some(b) => format!("[`{id}`]({b}#inspect={key})"),
                None => format!("`{id}`"),
            };
            let tiles = r["detail"]["changedTiles"].as_u64().unwrap_or(0) + r["detail"]["newEdgeTiles"].as_u64().unwrap_or(0);
            let why = r["reasons"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; ")).or_else(|| r["error"].as_str().map(String::from)).unwrap_or_default();
            out.push_str(&format!(
                "| {name} | {} | {} | {} | {tiles} | {} |\n",
                r["mode"].as_str().unwrap_or("default"),
                r["metrics"]["ssim"],
                r["metrics"]["changedCells"],
                esc_md(&why)
            ));
        }
        if failing.len() > 50 {
            out.push_str(&format!("\n…and {} more.\n", failing.len() - 50));
        }
        out.push('\n');
    }
    let a11y: Vec<&&Value> = rs.iter().filter(|r| r["a11y"]["new"].as_u64().unwrap_or(0) > 0).collect();
    if !a11y.is_empty() {
        out.push_str("<details><summary>New accessibility violations</summary>\n\n");
        for r in a11y.iter().take(30) {
            let rules: Vec<&str> = r["a11y"]["violations"].as_array().map(|a| a.iter().filter_map(|x| x["id"].as_str()).collect()).unwrap_or_default();
            out.push_str(&format!("- `{}`: {} ({})\n", r["id"].as_str().unwrap_or(""), a11y_count(r), rules.join(", ")));
        }
        out.push_str("\n</details>\n");
    }
    out
}

/// Warn mode (`enforcement` in check.json): a lead block above the head, so a reader knows the run
/// was not blocking. The head and table below stay as they are: a would-fail run still reads "❌".
fn advisory_lead(v: &Value) -> String {
    let Some(e) = v.get("enforcement").filter(|x| x.is_object()) else { return String::new() };
    let names = |k: &str| -> Vec<String> { e[k].as_array().into_iter().flatten().filter_map(Value::as_str).map(esc_md).collect() };
    let configured = names("configured");
    let reasons: Vec<String> = e["reasons"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| format!("{} {}", r["count"].as_u64().unwrap_or(0), esc_md(r["what"].as_str().unwrap_or(""))))
        .collect();
    let expired = names("expired");
    let mut out = String::new();
    if !expired.is_empty() && configured.is_empty() {
        out.push_str(&format!(
            "> **Warn mode ended** on {}: {} {} enforced again.\n\n",
            esc_md(e["warnUntil"].as_str().unwrap_or("")),
            expired.join(", "),
            if expired.len() == 1 { "is" } else { "are" }
        ));
        return out;
    }
    let would = e["wouldFail"].as_bool() == Some(true) && !reasons.is_empty();
    if configured.is_empty() {
        // The a11y gate on its built-in warn: only here because a new violation appeared (decision 88).
        if would {
            out.push_str(&format!("> **ADVISORY** (a11y, warn by default): {}. Nothing was blocked.\n\n", reasons.join(", ")));
        }
        return out;
    }
    let verdict = if would {
        format!("This run would have failed: {}. Nothing was blocked.", reasons.join(", "))
    } else {
        "This run would have passed.".to_string()
    };
    let until = match (e["warnUntil"].as_str(), e["daysLeft"].as_u64()) {
        (Some(d), Some(n)) => format!(" Enforced from {} (in {n} day{}).", esc_md(d), if n == 1 { "" } else { "s" }),
        (Some(d), None) => format!(" Enforced from {}.", esc_md(d)),
        _ => String::new(),
    };
    out.push_str(&format!("> **ADVISORY: warn mode** ({}). {verdict}{until}\n\n", configured.join(", ")));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_environment_line_only_when_entries_mismatch() {
        let rows = json!([{ "id": "a", "pass": true }, { "id": "b", "pass": true }]);
        let none = json!({ "rows": rows, "summary": { "envMismatch": 0 } });
        assert!(!markdown(&none, None).contains("Environment:"));
        let some = json!({ "rows": rows, "summary": { "envMismatch": 2, "envFields": ["browser.version", "fonts.probe: Inter"] } });
        let md = markdown(&some, None);
        assert!(md.contains("Environment: 2 of 2 entries were rendered in a different environment than their baseline (browser.version, fonts.probe: Inter)"), "{md}");
    }

    #[test]
    fn the_advisory_lead_only_under_warn_mode() {
        let rows = json!([{ "id": "a", "pass": false, "changed": true }]);
        let enforce = json!({ "rows": rows });
        assert!(markdown(&enforce, None).starts_with("### ❌"), "no enforcement key: the report is as before");
        let warn = json!({ "rows": rows, "enforcement": { "configured": ["visual"], "wouldFail": true, "reasons": [{ "gate": "visual", "count": 1, "what": "changed" }], "warnUntil": "2026-12-31" } });
        let md = markdown(&warn, None);
        assert!(md.starts_with("> **ADVISORY: warn mode** (visual). This run would have failed: 1 changed. Nothing was blocked. Enforced from 2026-12-31.\n\n### ❌"), "{md}");
        let pass = json!({ "rows": [{ "id": "a", "pass": true }], "enforcement": { "configured": ["visual"], "wouldFail": false, "reasons": [] } });
        assert!(markdown(&pass, None).starts_with("> **ADVISORY: warn mode** (visual). This run would have passed.\n\n### ✅"));
        let quiet = json!({ "rows": [{ "id": "a", "pass": true }], "enforcement": { "configured": [], "wouldFail": true, "reasons": [{ "gate": "a11y", "count": 1, "what": "entry with new a11y violations" }] } });
        assert!(markdown(&quiet, None).starts_with("> **ADVISORY** (a11y, warn by default): 1 entry with new a11y violations. Nothing was blocked."));
    }

    #[test]
    fn junit_keeps_failures_and_marks_a_warned_visual_gate() {
        let rows = json!([{ "id": "a", "pass": false }]);
        let plain = junit(&json!({ "rows": rows }));
        assert!(!plain.contains("<properties>") && plain.contains("<failure"));
        let warned = junit(&json!({ "rows": rows, "enforcement": { "gates": { "visual": "warn" } } }));
        assert!(warned.contains("<properties><property name=\"pxsig.enforcement\" value=\"warn\"/></properties>") && warned.contains("<failure"), "{warned}");
    }
}

pub fn junit(v: &Value) -> String {
    let rs = rows(v);
    let failures = rs.iter().filter(|r| status(r) == "fail").count();
    let skipped = rs.iter().filter(|r| status(r) == "skipped").count();
    let mut out = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites name=\"pxsig\" tests=\"{}\" failures=\"{failures}\" skipped=\"{skipped}\">\n<testsuite name=\"visual\" tests=\"{}\" failures=\"{failures}\" skipped=\"{skipped}\">\n",
        rs.len(),
        rs.len()
    );
    // Warn mode on the visual gate (decision 10.10): failures stay failures; the suite says warn.
    if v["enforcement"]["gates"]["visual"].as_str() == Some("warn") {
        out.push_str("  <properties><property name=\"pxsig.enforcement\" value=\"warn\"/></properties>\n");
    }
    for r in rs {
        let id = esc_xml(r["id"].as_str().unwrap_or(""));
        let class = esc_xml(r["mode"].as_str().unwrap_or("default"));
        match status(r) {
            "fail" => {
                let why = r["reasons"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; ")).or_else(|| r["error"].as_str().map(String::from)).unwrap_or_default();
                out.push_str(&format!(
                    "  <testcase classname=\"{class}\" name=\"{id}\"><failure message=\"{}\">ssim {} · changed cells {}</failure></testcase>\n",
                    esc_xml(&why),
                    r["metrics"]["ssim"],
                    r["metrics"]["changedCells"]
                ));
            }
            "skipped" => out.push_str(&format!("  <testcase classname=\"{class}\" name=\"{id}\"><skipped message=\"unaffected by this change\"/></testcase>\n")),
            other => out.push_str(&format!(
                "  <testcase classname=\"{class}\" name=\"{id}\">{}</testcase>\n",
                if other == "flaky" { "<system-out>flaky: passed on retry</system-out>" } else { "" }
            )),
        }
    }
    out.push_str("</testsuite>\n</testsuites>\n");
    out
}
