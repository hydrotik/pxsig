//! The container's extra sections: written after `sig` and `image`, kept as stored, and read back.

use serde_json::{json, Map, Value};

use super::*;
use crate::record::PxsigRecord;
use crate::signature::signature_of;

fn record() -> PxsigRecord {
    let px: Vec<u8> = (0..32 * 32 * 4).map(|i| (i * 7 % 251) as u8).collect();
    PxsigRecord::from_signature(
        &signature_of(&px, 32, 32, 16),
        "a.png",
        "2026-10-18T00:00:00.000Z",
    )
}

fn boxes() -> Section {
    let runs = json!({ "v": 1, "runs": [{ "s": "1 " }, { "s": "new" }] });
    let mut keys = Map::new();
    keys.insert("runs".into(), json!(2));
    keys.insert("length".into(), json!(1)); // ignored: written from the body
    Section::json("boxes", &runs, Some(&keys)).unwrap()
}

#[test]
fn an_extra_section_is_written_after_the_image_and_read_back_as_stored() {
    let r = record();
    let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x20\0\0\0\x10rest".to_vec();
    let b = boxes();
    assert_eq!(b.meta["encoding"], json!("deflate"));
    assert_eq!(b.meta["runs"], json!(2));
    assert_eq!(b.meta["length"], json!(b.body.len()));
    let bytes = encode(&r, Some(&png), None, None, std::slice::from_ref(&b)).unwrap();
    assert!(bytes.ends_with(&b.body));
    let p = decode(&bytes).unwrap();
    assert_eq!(p.image.as_deref(), Some(png.as_slice()));
    assert_eq!(p.sections, vec![b.clone()]);
    let names: Vec<_> = p.header["sections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["sig", "image", "boxes"]);
    let v: Value = serde_json::from_slice(&p.sections[0].data().unwrap()).unwrap();
    assert_eq!(v["runs"][0]["s"], json!("1 "));
    // Writing back what was read gives the same bytes.
    let again = encode(&p.record, p.image.as_deref(), None, None, &p.sections).unwrap();
    assert_eq!(again, bytes);
    // The sig and image read exactly as they do with no extra section.
    let plain = decode(&encode(&r, Some(&png), None, None, &[]).unwrap()).unwrap();
    assert_eq!((plain.sig, plain.image), (p.sig, p.image));
}

#[test]
fn an_unknown_section_and_encoding_are_kept_and_only_data_refuses_them() {
    let r = record();
    let odd = Section {
        meta: json!({ "name": "later", "encoding": "zstd", "x": 1, "length": 0, "sha256": "" }),
        body: b"opaque".to_vec(),
    };
    let raw = Section {
        meta: json!({ "name": "plain", "type": "text/plain" }),
        body: b"as is".to_vec(),
    };
    let bytes = encode(&r, None, None, None, &[odd, raw]).unwrap();
    let p = decode(&bytes).unwrap();
    assert_eq!(p.sections[0].meta["x"], json!(1));
    assert_eq!(p.sections[0].meta["length"], json!(6));
    assert!(p.sections[0].data().unwrap_err().contains("zstd"));
    assert_eq!(p.sections[1].data().unwrap(), b"as is");
    assert_eq!(encode(&r, None, None, None, &p.sections).unwrap(), bytes);
}

#[test]
fn reserved_and_repeated_section_names_are_refused_and_tampering_is_caught() {
    let r = record();
    for name in ["sig", "image", ""] {
        let s = Section {
            meta: json!({ "name": name }),
            body: vec![1],
        };
        assert!(encode(&r, None, None, None, &[s]).is_err(), "{name:?}");
    }
    assert!(encode(&r, None, None, None, &[boxes(), boxes()]).is_err());
    let mut bytes = encode(&r, None, None, None, &[boxes()]).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    assert!(decode(&bytes)
        .unwrap_err()
        .contains("\"boxes\" fails its sha256"));
}

#[test]
fn inflating_stops_at_the_cap() {
    let zeros = vec![0u8; MAX_INFLATED as usize + 1];
    let mut z = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::fast());
    z.write_all(&zeros).unwrap();
    let s = Section {
        meta: json!({ "name": "boxes", "encoding": "deflate" }),
        body: z.finish().unwrap(),
    };
    assert!(s.data().unwrap_err().contains("inflates past"));
}
