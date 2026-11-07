//! The `.psig` container: one file per baseline holding the spec v1 record, its raw signature
//! bytes and (optionally) the baseline image, so a store needs no loose image files.
//!
//! ```text
//! "PSIG" · u16 LE container version · u32 LE header length
//! header    UTF-8 JSON (pretty): the record without `sig`, the section table, `encryption`
//! sections  in table order: `sig` (raw grid*grid*3 RGB bytes), then `image` (PNG bytes), then
//!           any other section (`boxes`: the text record, deflated JSON), kept as stored
//! ```
//!
//! The record inside is the spec v1 record: decoding a `.psig` and re-encoding its signature as
//! base64 gives back the `.pxsig.json` record it was packed from. Nothing here touches the
//! filesystem.

use std::io::{Read as _, Write as _};

use base64::Engine as _;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::record::PxsigRecord;

pub const MAGIC: &[u8; 4] = b"PSIG";
pub const CONTAINER_VERSION: u16 = 1;
const PREFIX: usize = 4 + 2 + 4;
/// The most bytes a deflated section may inflate to (a 5,000-run text record is about 2 MB).
pub const MAX_INFLATED: u64 = 32 << 20;

/// A decoded container.
#[derive(Debug, Clone)]
pub struct Psig {
    pub record: PxsigRecord,
    /// Raw `grid*grid*3` signature bytes.
    pub sig: Vec<u8>,
    /// The baseline image (PNG bytes), when the container carries one.
    pub image: Option<Vec<u8>>,
    /// Every section other than `sig` and `image`, in table order, as stored.
    pub sections: Vec<Section>,
    /// The full header, as stored.
    pub header: Value,
}

/// A section other than `sig` and `image`: its table entry and its bytes, both as stored, so a
/// file re-encoded with it keeps a section this version does not know byte for byte.
#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    /// The section's table entry: `name`, `length`, `sha256`, and its own keys (`type`, `encoding`).
    pub meta: Value,
    /// The stored bytes (deflated when `encoding` is `"deflate"`).
    pub body: Vec<u8>,
}

impl Section {
    /// A JSON section, always deflated (raw DEFLATE, RFC 1951). `keys` are added to its table entry
    /// (a `boxes` section's `runs`); one of the keys this function writes is ignored.
    pub fn json(
        name: &str,
        value: &Value,
        keys: Option<&Map<String, Value>>,
    ) -> Result<Self, String> {
        let raw = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        let mut z = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        z.write_all(&raw).map_err(|e| e.to_string())?;
        let body = z.finish().map_err(|e| e.to_string())?;
        let mut meta = json!({ "name": name, "type": "application/json", "encoding": "deflate" });
        for (k, v) in keys.into_iter().flatten() {
            if !["name", "type", "encoding", "length", "sha256"].contains(&k.as_str()) {
                meta[k] = v.clone();
            }
        }
        meta["length"] = json!(body.len());
        meta["sha256"] = json!(sha256_hex(&body));
        Ok(Self { meta, body })
    }

    /// The section's name.
    pub fn name(&self) -> &str {
        self.meta["name"].as_str().unwrap_or("")
    }

    /// The section's content: inflated when `encoding` is `"deflate"`, as stored when it is absent
    /// or `"identity"`. Any other encoding, or more than [`MAX_INFLATED`] bytes, is an error.
    pub fn data(&self) -> Result<Vec<u8>, String> {
        match self.meta.get("encoding").and_then(Value::as_str) {
            None | Some("identity") => Ok(self.body.clone()),
            Some("deflate") => {
                let mut out = Vec::new();
                flate2::read::DeflateDecoder::new(self.body.as_slice())
                    .take(MAX_INFLATED + 1)
                    .read_to_end(&mut out)
                    .map_err(|e| format!("section {} does not inflate: {e}", self.name()))?;
                if out.len() as u64 > MAX_INFLATED {
                    return Err(format!(
                        "section {} inflates past {MAX_INFLATED} bytes",
                        self.name()
                    ));
                }
                Ok(out)
            }
            Some(other) => Err(format!(
                "section {} has encoding {other:?}, not supported",
                self.name()
            )),
        }
    }
}

fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

/// Width and height from a PNG's IHDR, without decoding it.
pub fn png_dimensions(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" || &png[12..16] != b"IHDR" {
        return None;
    }
    let be = |i: usize| u32::from_be_bytes([png[i], png[i + 1], png[i + 2], png[i + 3]]);
    Some((be(16), be(20)))
}

/// Header keys this module writes itself. Any other top-level key (`env`, the environment the
/// baseline was rendered in) is the caller's: `encode` writes it through and `extras` hands it back,
/// so re-encoding a file never drops a key a newer version added.
pub const OWNED_KEYS: [&str; 6] = [
    "format",
    "container",
    "entry",
    "record",
    "encryption",
    "sections",
];

/// The header's top-level keys this module does not own (see [`OWNED_KEYS`]).
pub fn extras(header: &Value) -> Map<String, Value> {
    header
        .as_object()
        .map(|o| {
            o.iter()
                .filter(|(k, _)| !OWNED_KEYS.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default()
}

/// Pack a record, its image, optional entry metadata (`id`, `story`, `mode`, `state`), extra
/// top-level header keys (`env`) and extra sections, written after `sig` and `image` in the order
/// given. An extra key that this module owns is ignored; a section named `sig` or `image`, without
/// a name, or named twice is an error.
pub fn encode(
    record: &PxsigRecord,
    image: Option<&[u8]>,
    entry: Option<&Value>,
    extra: Option<&Map<String, Value>>,
    more: &[Section],
) -> Result<Vec<u8>, String> {
    let (_, sig) = record.baseline()?;
    let mut rec = serde_json::to_value(record).map_err(|e| e.to_string())?;
    if let Value::Object(o) = &mut rec {
        o.remove("sig");
    }
    let mut sections =
        vec![json!({ "name": "sig", "length": sig.len(), "sha256": sha256_hex(&sig) })];
    if let Some(img) = image {
        let mut s = json!({ "name": "image", "type": "image/png", "length": img.len(), "sha256": sha256_hex(img) });
        if let Some((w, h)) = png_dimensions(img) {
            s["width"] = json!(w);
            s["height"] = json!(h);
        }
        sections.push(s);
    }
    let mut names: Vec<&str> = Vec::new();
    for s in more {
        let n = s.name();
        if n.is_empty() || n == "sig" || n == "image" || names.contains(&n) {
            return Err(format!(
                "section name {n:?} is reserved, empty or used twice"
            ));
        }
        names.push(n);
        let mut meta = s.meta.clone();
        meta["length"] = json!(s.body.len());
        meta["sha256"] = json!(sha256_hex(&s.body));
        sections.push(meta);
    }
    let mut header = Map::new();
    header.insert("format".into(), json!("psig"));
    header.insert("container".into(), json!(CONTAINER_VERSION));
    if let Some(e) = entry {
        header.insert("entry".into(), e.clone());
    }
    for (k, v) in extra.into_iter().flatten() {
        if !OWNED_KEYS.contains(&k.as_str()) {
            header.insert(k.clone(), v.clone());
        }
    }
    header.insert("record".into(), rec);
    header.insert("encryption".into(), json!("none"));
    header.insert("sections".into(), Value::Array(sections));
    let head =
        serde_json::to_string_pretty(&Value::Object(header)).map_err(|e| e.to_string())? + "\n";

    let rest = image.map_or(0, <[u8]>::len) + more.iter().map(|s| s.body.len()).sum::<usize>();
    let mut out = Vec::with_capacity(PREFIX + head.len() + sig.len() + rest);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&CONTAINER_VERSION.to_le_bytes());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(head.as_bytes());
    out.extend_from_slice(&sig);
    if let Some(img) = image {
        out.extend_from_slice(img);
    }
    for s in more {
        out.extend_from_slice(&s.body);
    }
    Ok(out)
}

/// True when `bytes` start with the container magic.
pub fn is_psig(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && &bytes[..4] == MAGIC
}

/// Read only the header (for `pxsig cat --header` and git's textconv).
pub fn header(bytes: &[u8]) -> Result<Value, String> {
    if !is_psig(bytes) {
        return Err("not a .psig file (bad magic)".into());
    }
    if bytes.len() < PREFIX {
        return Err("truncated .psig file".into());
    }
    let version = u16::from_le_bytes([bytes[4], bytes[5]]);
    if version != CONTAINER_VERSION {
        return Err(format!(
            "container version {version} is not supported (this tool reads {CONTAINER_VERSION})"
        ));
    }
    let len = u32::from_le_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]) as usize;
    let head = bytes
        .get(PREFIX..PREFIX + len)
        .ok_or("truncated .psig header")?;
    serde_json::from_slice(head).map_err(|e| format!("bad .psig header: {e}"))
}

/// Decode and verify every section's length and sha256.
pub fn decode(bytes: &[u8]) -> Result<Psig, String> {
    let header = self::header(bytes)?;
    if header["encryption"] != json!("none") {
        return Err(format!(
            "encrypted .psig ({}) is not supported",
            header["encryption"]
        ));
    }
    let len = u32::from_le_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]) as usize;
    let mut at = PREFIX + len;
    let mut sig = None;
    let mut image = None;
    let mut sections = Vec::new();
    for s in header["sections"]
        .as_array()
        .ok_or("header has no section table")?
    {
        let n = s["length"].as_u64().ok_or("section without a length")? as usize;
        let body = bytes
            .get(at..at + n)
            .ok_or_else(|| format!("section {} is truncated", s["name"]))?;
        if s["sha256"].as_str() != Some(sha256_hex(body).as_str()) {
            return Err(format!("section {} fails its sha256", s["name"]));
        }
        match s["name"].as_str() {
            Some("sig") => sig = Some(body.to_vec()),
            Some("image") => image = Some(body.to_vec()),
            // Any other section is kept as stored, never interpreted here, so later versions can
            // add sections and re-encoding a file keeps them.
            _ => sections.push(Section {
                meta: s.clone(),
                body: body.to_vec(),
            }),
        }
        at += n;
    }
    let sig = sig.ok_or(".psig has no sig section")?;
    let mut rec = header["record"].clone();
    rec["sig"] = json!(base64::engine::general_purpose::STANDARD.encode(&sig));
    let record: PxsigRecord =
        serde_json::from_value(rec).map_err(|e| format!("bad record in .psig header: {e}"))?;
    let (_, check) = record.baseline()?;
    if check != sig {
        return Err("signature section does not match its record".into());
    }
    Ok(Psig {
        record,
        sig,
        image,
        sections,
        header,
    })
}

#[cfg(test)]
#[path = "psig_sections_tests.rs"]
mod sections_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signature::signature_of;

    fn record() -> PxsigRecord {
        let px: Vec<u8> = (0..32 * 32 * 4).map(|i| (i * 7 % 251) as u8).collect();
        PxsigRecord::from_signature(
            &signature_of(&px, 32, 32, 16),
            "a.png",
            "2026-10-18T00:00:00.000Z",
        )
    }

    #[test]
    fn round_trips_record_sig_and_image() {
        let r = record();
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x20\0\0\0\x10rest".to_vec();
        let entry = json!({ "id": "x--y", "mode": "dark" });
        let bytes = encode(&r, Some(&png), Some(&entry), None, &[]).unwrap();
        let p = decode(&bytes).unwrap();
        assert_eq!(
            serde_json::to_string(&p.record).unwrap(),
            serde_json::to_string(&r).unwrap()
        );
        assert_eq!(p.image.as_deref(), Some(png.as_slice()));
        assert_eq!(p.header["entry"]["id"], json!("x--y"));
        assert_eq!(p.header["sections"][1]["width"], json!(32));
    }

    #[test]
    fn signature_only_and_tamper_detection() {
        let r = record();
        let mut bytes = encode(&r, None, None, None, &[]).unwrap();
        assert!(decode(&bytes).unwrap().image.is_none());
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(decode(&bytes).unwrap_err().contains("sha256"));
        assert!(decode(b"PXSG0000000").is_err());
    }

    #[test]
    fn extra_header_keys_round_trip_and_owned_ones_are_ignored() {
        let r = record();
        let mut extra = Map::new();
        extra.insert("env".into(), json!({ "v": 1, "id": "0123456789abcdef" }));
        extra.insert("record".into(), json!("ignored"));
        let bytes = encode(&r, None, None, Some(&extra), &[]).unwrap();
        let p = decode(&bytes).unwrap();
        assert_eq!(p.header["env"]["id"], json!("0123456789abcdef"));
        assert_eq!(
            serde_json::to_string(&p.record).unwrap(),
            serde_json::to_string(&r).unwrap()
        );
        let back = extras(&p.header);
        assert_eq!(back.keys().collect::<Vec<_>>(), vec!["env"]);
    }

    #[test]
    fn an_unknown_top_level_key_is_read_and_ignored() {
        // A header written by a later version, with a key this one has never heard of.
        let r = record();
        let mut extra = Map::new();
        extra.insert("futureKey".into(), json!({ "x": [1, 2, 3] }));
        let bytes = encode(&r, None, None, Some(&extra), &[]).unwrap();
        let p = decode(&bytes).unwrap();
        assert_eq!(p.sig, r.baseline().unwrap().1);
        assert_eq!(extras(&p.header)["futureKey"]["x"][2], json!(3));
    }

    #[test]
    fn raw_sig_is_smaller_than_base64_at_grid_64() {
        let px: Vec<u8> = (0..128 * 128 * 4).map(|i| (i * 7 % 251) as u8).collect();
        let r = PxsigRecord::from_signature(
            &signature_of(&px, 128, 128, 64),
            "a.png",
            "2026-10-18T00:00:00.000Z",
        );
        let bytes = encode(&r, None, None, None, &[]).unwrap();
        assert!(bytes.len() < serde_json::to_string_pretty(&r).unwrap().len());
    }
}
