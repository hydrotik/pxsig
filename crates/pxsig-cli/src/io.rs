//! File IO for the CLI: PNG decode/encode, record writes, and the diff artifacts
//! (`<stem>.{baseline,current,diff}.png` + `<stem>.diff.html`, and the batch
//! `index.html` gallery).

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde_json::Value;

use pxsig_core::{CompareResult, PixelDiff, PxsigRecord};

/// A path as pxsig prints it in JSON: `/`-separated on every OS (Windows gives `\`).
pub fn to_slash(p: &Path) -> String {
    let s = p.to_string_lossy();
    if std::path::MAIN_SEPARATOR == '\\' {
        s.replace('\\', "/")
    } else {
        s.into_owned()
    }
}

/// Decode any PNG to 8-bit RGBA (palette/gray/RGB expanded, 16-bit stripped).
pub fn decode_png(path: &Path) -> Result<(Vec<u8>, usize, usize)> {
    let bytes = fs::read(path).with_context(|| format!("PNG not found: {}", path.display()))?;
    decode_png_bytes(&bytes, path)
}

/// Decode PNG bytes (a file's, or the image section of a `.psig`); `path` only labels errors.
pub fn decode_png_bytes(bytes: &[u8], path: &Path) -> Result<(Vec<u8>, usize, usize)> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .with_context(|| format!("decoding {}", path.display()))?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buf)
        .with_context(|| format!("decoding {}", path.display()))?;
    let (w, h) = (info.width as usize, info.height as usize);
    if w == 0 || h == 0 {
        bail!("PNG has zero dimensions: {}", path.display());
    }
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buf
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&v| [v, v, v, 255]).collect(),
        png::ColorType::Indexed => bail!("unexpanded indexed PNG: {}", path.display()),
    };
    Ok((rgba, w, h))
}

/// Width and height from the PNG header, without decoding pixels.
pub fn png_size(path: &Path) -> Result<((), usize, usize)> {
    let file = File::open(path).with_context(|| format!("PNG not found: {}", path.display()))?;
    let info = png::Decoder::new(std::io::BufReader::new(file))
        .read_info()
        .with_context(|| format!("reading {}", path.display()))?
        .info()
        .clone();
    Ok(((), info.width as usize, info.height as usize))
}

fn encode_png(path: &Path, w: usize, h: usize, rgba: &[u8]) -> Result<()> {
    let file = File::create(path).with_context(|| format!("writing {}", path.display()))?;
    let mut enc = png::Encoder::new(BufWriter::new(file), w as u32, h as u32);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()?.write_image_data(rgba)?;
    Ok(())
}

/// True for a `.psig` container path (otherwise a spec v1 `.pxsig.json`).
pub fn is_psig_path(p: &Path) -> bool {
    p.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("psig"))
}

/// Write a baseline: a `.psig` container (record + image + entry + extra header keys such as `env`)
/// or a spec v1 `.pxsig.json` (which has no header, so `extra` is not written there).
pub fn write_baseline(
    out: &Path,
    record: &PxsigRecord,
    image: Option<&[u8]>,
    entry: Option<&Value>,
    extra: Option<&serde_json::Map<String, Value>>,
) -> Result<()> {
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir)?;
    }
    let bytes = if is_psig_path(out) {
        pxsig_core::psig::encode(record, image, entry, extra).map_err(|e| anyhow::anyhow!(e))?
    } else {
        (serde_json::to_string_pretty(record)? + "\n").into_bytes()
    };
    // Write then rename, so a reader never sees half a baseline.
    let tmp = out.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, bytes).with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, out).with_context(|| format!("writing {}", out.display()))
}

/// `foo.png` → `foo.psig` (the default when `--out` is omitted).
pub fn default_sig_path(png: &Path) -> PathBuf {
    let s = png.to_string_lossy();
    let lower = s.to_lowercase();
    match lower.strip_suffix(".png") {
        Some(_) => PathBuf::from(format!("{}.psig", &s[..s.len() - 4])),
        None => PathBuf::from(format!("{s}.psig")),
    }
}

pub fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `<id>.pxsig.json` or `<id>.psig` → `<id>`.
pub fn stem_of(sig: &Path) -> String {
    let name = file_name(sig);
    let lower = name.to_lowercase();
    for ext in [".pxsig.json", ".psig"] {
        if lower.ends_with(ext) {
            return name[..name.len() - ext.len()].to_string();
        }
    }
    name
}

/// ISO-8601 UTC with milliseconds, like JS `Date#toISOString`.
pub fn iso_now() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        d.subsec_millis()
    )
}

/// Render a JSON value the way a JS template literal would (`1`, not `1.0`).
fn js_display(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
            _ => n.to_string(),
        },
        other => other.to_string(),
    }
}

/// Write `<stem>.{baseline,current,diff}.png` + `<stem>.diff.html`; returns
/// the html and heatmap paths.
pub fn write_diff_artifacts(
    out_dir: &Path,
    stem: &str,
    r: &CompareResult,
    metrics: &Value,
) -> Result<(String, String)> {
    fs::create_dir_all(out_dir)?;
    let grid = r.metrics.grid;
    let scale = ((512.0 / grid as f64).round() as usize).max(4);
    let side = grid * scale;

    let upscale = |cell: &dyn Fn(usize) -> [u8; 3]| -> Vec<u8> {
        let mut px = vec![0u8; side * side * 4];
        for y in 0..side {
            for x in 0..side {
                let [r, g, b] = cell((y / scale) * grid + x / scale);
                let i = (y * side + x) * 4;
                px[i..i + 4].copy_from_slice(&[r, g, b, 255]);
            }
        }
        px
    };
    let rgb = |sig: &[u8], c: usize| [sig[c * 3], sig[c * 3 + 1], sig[c * 3 + 2]];

    let baseline_png = out_dir.join(format!("{stem}.baseline.png"));
    let current_png = out_dir.join(format!("{stem}.current.png"));
    let diff_png = out_dir.join(format!("{stem}.diff.png"));
    let diff_html = out_dir.join(format!("{stem}.diff.html"));

    encode_png(
        &baseline_png,
        side,
        side,
        &upscale(&|c| rgb(&r.base_sig, c)),
    )?;
    encode_png(&current_png, side, side, &upscale(&|c| rgb(&r.cur_sig, c)))?;
    encode_png(
        &diff_png,
        side,
        side,
        &upscale(&|c| {
            let [cr, cg, cb] = rgb(&r.cur_sig, c);
            let lum = (0.299 * cr as f64 + 0.587 * cg as f64 + 0.114 * cb as f64) * 0.25;
            [
                (lum + r.heat[c] as f64).min(255.0) as u8,
                lum as u8,
                lum as u8,
            ]
        }),
    )?;

    let rows: String = metrics
        .as_object()
        .map(|o| {
            o.iter()
                .map(|(k, v)| format!("<tr><td class=v>{k}</td><td>{}</td></tr>", js_display(v)))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let html = format!(
        r#"<!doctype html><meta charset=utf-8><title>{stem} pixel diff</title>
<style>body{{font-family:system-ui;margin:16px}}figure{{display:inline-block;margin:0 12px 0 0;text-align:center}}
img{{image-rendering:pixelated;width:{side}px;border:1px solid #ccc}}figcaption{{font-size:12px}}
table{{border-collapse:collapse;margin-top:12px}}td,th{{border:1px solid #ccc;padding:4px 8px;font:13px ui-monospace,monospace;text-align:right}}
th{{background:#f4f5f6;text-align:left}}.v{{text-align:left}}</style>
<h1>{stem} — pixel fingerprint diff</h1>
<figure><img src="{b}"><figcaption>baseline (committed sig)</figcaption></figure>
<figure><img src="{c}"><figcaption>current render</figcaption></figure>
<figure><img src="{d}"><figcaption>diff heatmap (red = changed)</figcaption></figure>
<table><tr><th>metric</th><th>value</th></tr>
{rows}
</table>
"#,
        b = file_name(&baseline_png),
        c = file_name(&current_png),
        d = file_name(&diff_png),
    );
    fs::write(&diff_html, html)?;
    Ok((to_slash(&diff_html), to_slash(&diff_png)))
}

pub struct GalleryRow {
    pub id: String,
    pub ok: bool,
    pub ssim: Option<f64>,
    pub changed_pct: Option<f64>,
    pub edge_pct: Option<f64>,
    pub note: String,
}

/// The batch `index.html`: one row per entry, failures first.
pub fn write_gallery(out_dir: &Path, rows: &[GalleryRow]) -> Result<()> {
    let opt = |v: Option<f64>| {
        v.map(|x| js_display(&serde_json::json!(x)))
            .unwrap_or_default()
    };
    let failed = rows.iter().filter(|r| !r.ok).count();
    let body: String = rows
        .iter()
        .map(|r| {
            let link: String =
                r.id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
            format!(
                "<tr class=\"{cls}\"><td>{id}</td><td>{res}</td><td>{s}</td><td>{c}</td><td>{e}</td><td><a href=\"{link}.diff.html\">diff</a></td><td>{note}</td></tr>",
                cls = if r.ok { "pass" } else { "fail" },
                id = r.id,
                res = if r.ok { "PASS" } else { "FAIL" },
                s = opt(r.ssim),
                c = opt(r.changed_pct),
                e = opt(r.edge_pct),
                note = r.note,
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let html = format!(
        r#"<!doctype html><meta charset=utf-8><title>pxsig check</title>
<style>body{{font-family:system-ui;margin:16px}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:4px 8px;font:13px ui-monospace,monospace}}
.pass td:nth-child(2){{color:#1b7040}}.fail td:nth-child(2){{color:#c00;font-weight:700}}</style>
<h1>pixel fingerprint check</h1><p>{n} stories · {failed} failed</p>
<table><tr><th>story</th><th>result</th><th>ssim</th><th>changed%</th><th>edge%</th><th></th><th>note</th></tr>
{body}</table>
"#,
        n = rows.len()
    );
    fs::write(out_dir.join("index.html"), html)?;
    Ok(())
}

/// The changed-pixel mask as a PNG: magenta where changed, transparent elsewhere.
pub fn write_mask(path: &Path, d: &PixelDiff) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut px = vec![0u8; d.width * d.height * 4];
    for (i, m) in d.mask.iter().enumerate() {
        if *m != 0 {
            px[i * 4..i * 4 + 4].copy_from_slice(&[255, 0, 153, 255]);
        }
    }
    encode_png(path, d.width, d.height, &px)
}

/// Write RGBA as PNG (used by `trim`, which rewrites renders in place).
pub fn encode_png_pub(path: &Path, w: usize, h: usize, rgba: &[u8]) -> Result<()> {
    encode_png(path, w, h, rgba)
}

#[cfg(test)]
mod tests {
    use super::to_slash;
    use std::path::Path;

    #[test]
    fn printed_paths_use_forward_slashes() {
        assert_eq!(to_slash(Path::new("src/a/b.tsx")), "src/a/b.tsx");
        #[cfg(windows)]
        assert_eq!(
            to_slash(&Path::new("src").join("a").join("b.tsx")),
            "src/a/b.tsx"
        );
    }
}
