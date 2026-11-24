//! `pairs` and `rerecord`: a pair from one render matches, one from two does not, and a rerecord
//! writes only the record, only when every guard holds.

use super::*;
use std::fs;

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-pairs-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// A 32×32 render; `dot` sets one pixel to white.
fn png(path: &Path, shade: u8, dot: bool) {
    let mut px: Vec<u8> = (0..32 * 32)
        .flat_map(|i| [shade, (i % 251) as u8, 40, 255])
        .collect();
    if dot {
        px[..4].copy_from_slice(&[255, 255, 255, 255]);
    }
    io::encode_png_pub(path, 32, 32, &px).unwrap();
}

fn entry(id: &str) -> Entry {
    serde_json::from_value(json!({ "id": id, "sig": format!("{id}.psig") })).unwrap()
}

fn source(d: &Path, id: &str) -> PairSource {
    PairSource {
        id: id.into(),
        sig: d.join(format!("{id}.psig")),
        image: None,
    }
}

/// A baseline captured from `a.png`, then given `b.png` as its image (the old migrate's pairs),
/// with a masks key and a boxes-like section that must survive a rerecord.
fn mismatched(d: &Path) -> Vec<u8> {
    png(&d.join("a.png"), 10, false);
    png(&d.join("b.png"), 10, true);
    let out = d.join("x.psig");
    batch::capture_png(&d.join("a.png"), &out, 16, false, None, None).unwrap();
    let p = pxsig_core::psig::decode(&fs::read(&out).unwrap()).unwrap();
    let mut extra = pxsig_core::psig::extras(&p.header);
    extra.insert(
        "masks".into(),
        json!({ "masks": [{ "selector": ".clock" }] }),
    );
    let img = fs::read(d.join("b.png")).unwrap();
    io::write_baseline(
        &out,
        &p.record,
        Some(&img),
        Some(&json!({ "id": "x" })),
        Some(&extra),
        &[],
    )
    .unwrap();
    fs::read(&out).unwrap()
}

#[test]
fn a_pair_from_one_render_matches_and_one_from_two_does_not() {
    let d = scratch("match");
    png(&d.join("a.png"), 10, false);
    batch::capture_png(&d.join("a.png"), &d.join("a.psig"), 16, false, None, None).unwrap();
    let ok = pair_of(&source(&d, "a"), None).unwrap();
    assert_eq!(ok["match"], json!(true));
    mismatched(&d);
    let bad = pair_of(&source(&d, "x"), None).unwrap();
    assert_eq!(
        bad["match"],
        json!(false),
        "one pixel of the image differs from the record's render"
    );
    assert_ne!(bad["record"], bad["image"]);
}

#[test]
fn a_render_with_other_png_bytes_but_the_same_pixels_has_the_images_pixel_hash() {
    let d = scratch("pixels");
    mismatched(&d);
    fs::create_dir_all(d.join("latest")).unwrap();
    // The same pixels, encoded again (other bytes).
    let (px, w, h) = io::decode_png(&d.join("b.png")).unwrap();
    io::encode_png_pub(&d.join("latest/x.png"), w, h, &px).unwrap();
    let r = pair_of(&source(&d, "x"), Some(&d.join("latest"))).unwrap();
    assert_eq!(r["latestPixels"], r["pixels"]);
    png(&d.join("latest/x.png"), 10, false);
    let r = pair_of(&source(&d, "x"), Some(&d.join("latest"))).unwrap();
    assert_ne!(r["latestPixels"], r["pixels"], "one pixel differs");
}

#[test]
fn a_spec_v1_record_is_checked_against_a_png_file() {
    let d = scratch("legacy");
    png(&d.join("a.png"), 10, false);
    png(&d.join("b.png"), 10, true);
    batch::capture_png(
        &d.join("a.png"),
        &d.join("a.pxsig.json"),
        16,
        false,
        None,
        None,
    )
    .unwrap();
    let mut s = PairSource {
        id: "a".into(),
        sig: d.join("a.pxsig.json"),
        image: Some(d.join("a.png")),
    };
    assert_eq!(pair_of(&s, None).unwrap()["match"], json!(true));
    s.image = Some(d.join("b.png"));
    assert_eq!(pair_of(&s, None).unwrap()["match"], json!(false));
}

#[test]
fn rerecord_writes_the_record_from_the_image_and_keeps_everything_else() {
    let d = scratch("rerecord");
    let before = mismatched(&d);
    let m: Manifest =
        serde_json::from_value(json!({ "grid": 16, "detail": false, "stories": [] })).unwrap();
    let r = rerecord_one(&m, &entry("x"), &d, &file_sha(&before)).unwrap();
    let after = fs::read(d.join("x.psig")).unwrap();
    assert_eq!(r["before"], json!(file_sha(&before)));
    assert_eq!(r["after"], json!(file_sha(&after)));
    let (old, new) = (
        pxsig_core::psig::decode(&before).unwrap(),
        pxsig_core::psig::decode(&after).unwrap(),
    );
    assert_eq!(new.image, old.image, "the image is byte for byte the same");
    assert_eq!(
        pxsig_core::psig::extras(&new.header),
        pxsig_core::psig::extras(&old.header)
    );
    assert_eq!(
        new.header["masks"],
        json!({ "masks": [{ "selector": ".clock" }] })
    );
    assert_eq!(new.header.get("entry"), old.header.get("entry"));
    assert_eq!(
        pair_of(&source(&d, "x"), None).unwrap()["match"],
        json!(true)
    );
    assert_eq!(r["recordAfter"], json!(new.record.sha256));
    assert_eq!(r["recordBefore"], json!(old.record.sha256));
}

#[test]
fn rerecord_refuses_changed_bytes_a_matching_pair_and_no_image() {
    let d = scratch("refuse");
    let before = mismatched(&d);
    let m: Manifest = serde_json::from_value(json!({ "grid": 16, "stories": [] })).unwrap();
    let e = rerecord_one(&m, &entry("x"), &d, &"0".repeat(64)).unwrap_err();
    assert!(format!("{e:#}").contains("changed since it was planned"));
    assert_eq!(
        fs::read(d.join("x.psig")).unwrap(),
        before,
        "nothing written"
    );
    png(&d.join("a.png"), 10, false);
    batch::capture_png(&d.join("a.png"), &d.join("a.psig"), 16, false, None, None).unwrap();
    let a = fs::read(d.join("a.psig")).unwrap();
    let e = rerecord_one(&m, &entry("a"), &d, &file_sha(&a)).unwrap_err();
    assert!(format!("{e:#}").contains("already matches"));
    batch::capture_png(&d.join("a.png"), &d.join("n.psig"), 16, false, None, None).unwrap();
    let p = pxsig_core::psig::decode(&fs::read(d.join("n.psig")).unwrap()).unwrap();
    io::write_baseline(&d.join("n.psig"), &p.record, None, None, None, &[]).unwrap();
    let n = fs::read(d.join("n.psig")).unwrap();
    let e = rerecord_one(&m, &entry("n"), &d, &file_sha(&n)).unwrap_err();
    assert!(format!("{e:#}").contains("no baseline image"));
}
