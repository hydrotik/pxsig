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
    let mut out = String::new();
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

pub fn junit(v: &Value) -> String {
    let rs = rows(v);
    let failures = rs.iter().filter(|r| status(r) == "fail").count();
    let skipped = rs.iter().filter(|r| status(r) == "skipped").count();
    let mut out = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites name=\"pxsig\" tests=\"{}\" failures=\"{failures}\" skipped=\"{skipped}\">\n<testsuite name=\"visual\" tests=\"{}\" failures=\"{failures}\" skipped=\"{skipped}\">\n",
        rs.len(),
        rs.len()
    );
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
