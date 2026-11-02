//! `detail-sweep` on small renders: the shape of a row per pair and build, the tiles that
//! moved, a render that shrank, and an unreadable render named by its key.

use super::*;
use std::fs;
use std::path::Path;

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pxsig-sweep-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// A `w`×`h` render: vertical stripes `stripe` px wide, dark on light; `ink` sets the dark shade.
fn png(path: &Path, w: usize, h: usize, stripe: usize, ink: u8) {
    let px: Vec<u8> = (0..w * h)
        .flat_map(|i| {
            let v = if (i % w / stripe).is_multiple_of(2) {
                ink
            } else {
                240
            };
            [v, v, v, 255]
        })
        .collect();
    io::encode_png_pub(path, w, h, &px).unwrap();
}

fn pair(key: &str, base: &Path, cur: &Path) -> Pair {
    Pair {
        key: key.into(),
        base: base.to_path_buf(),
        cur: cur.to_path_buf(),
    }
}

const ALL: Build = Build {
    tile: 16,
    block: 4,
    sel_energy: 0,
};
const NONE: Build = Build {
    tile: 16,
    block: 8,
    sel_energy: 255,
};

#[test]
fn a_row_per_pair_with_a_result_per_build() {
    let d = scratch("rows");
    let (base, moved) = (d.join("base.png"), d.join("moved.png"));
    png(&base, 32, 32, 4, 20);
    png(&moved, 32, 32, 4, 140);
    let input = SweepInput {
        pairs: vec![pair("same", &base, &base), pair("moved", &base, &moved)],
        builds: vec![ALL, NONE],
    };
    let out = run(&input).unwrap();
    let rows = out["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["key"], "same");
    assert_eq!(rows[1]["key"], "moved");
    for row in rows {
        let builds = row["builds"].as_array().unwrap();
        assert_eq!(builds.len(), 2);
        // 32×32 in 16 px tiles: 4 tiles. Every tile kept at selEnergy 0, none at 255.
        assert_eq!(builds[0]["tiles"], 4);
        assert_eq!(builds[0]["kept"], 4);
        assert_eq!(builds[1]["tiles"], 4);
        assert_eq!(builds[1]["kept"], 0);
        assert!(
            builds[0]["recordBytes"].as_u64().unwrap() > builds[1]["recordBytes"].as_u64().unwrap()
        );
        // Nothing kept: no block delta to report, and the same stripes give no energy rise.
        assert_eq!(builds[1]["moved"], json!([]));
    }
    // The same render against itself moved nowhere.
    assert_eq!(rows[0]["builds"][0]["moved"], json!([]));
    // Lighter stripes: every kept tile's blocks moved by more than 8, its energy fell.
    let moved = rows[1]["builds"][0]["moved"].as_array().unwrap();
    assert_eq!(moved.len(), 4, "{moved:?}");
    for t in moved {
        let (delta, rise) = (t[0].as_i64().unwrap(), t[1].as_i64().unwrap());
        assert!(delta > 8, "{t}");
        assert!(rise <= 0, "{t}");
    }
}

#[test]
fn tiles_past_a_shrunken_render_count_as_fully_moved() {
    let d = scratch("shrunk");
    let (base, small) = (d.join("base.png"), d.join("small.png"));
    png(&base, 32, 32, 4, 20);
    png(&small, 16, 16, 4, 20);
    let out = run(&SweepInput {
        pairs: vec![pair("shrunk", &base, &small)],
        builds: vec![ALL],
    })
    .unwrap();
    let moved = out["rows"][0]["builds"][0]["moved"].as_array().unwrap();
    // The top-left tile is unchanged; the three tiles outside the 16×16 render are 255, rise 0.
    assert_eq!(moved, &vec![json!([255, 0]); 3]);
}

#[test]
fn an_unreadable_render_is_an_error_named_by_its_key() {
    let d = scratch("missing");
    let base = d.join("base.png");
    png(&base, 16, 16, 4, 20);
    let e = run(&SweepInput {
        pairs: vec![pair("story--gone", &base, &d.join("gone.png"))],
        builds: vec![ALL],
    })
    .unwrap_err();
    assert!(format!("{e:#}").contains("story--gone"), "{e:#}");
}

#[test]
fn the_input_reads_camel_case_builds() {
    let inp: SweepInput = serde_json::from_value(json!({
        "pairs": [{ "key": "k", "base": "a.png", "cur": "b.png" }],
        "builds": [{ "tile": 16, "block": 4, "selEnergy": 12 }],
    }))
    .unwrap();
    assert_eq!(inp.pairs[0].key, "k");
    assert_eq!(inp.builds[0].sel_energy, 12);
    assert!(serde_json::from_value::<SweepInput>(json!({ "pairs": [] })).is_err());
}

#[test]
fn blocks_average_inside_the_image_and_read_white_outside_it() {
    // 6×4 luminance, 0..24 row-major; one 4 px tile of 2 px blocks.
    let lum: Vec<f32> = (0..24).map(|v| v as f32).collect();
    assert_eq!(
        blocks(&lum, 6, 4, 0, 0, 4, 2),
        vec![
            3.5f32.round(),
            5.5f32.round(),
            15.5f32.round(),
            17.5f32.round()
        ]
    );
    // The second tile starts at x 4: its right-hand blocks fall outside the 6 px width.
    assert_eq!(
        blocks(&lum, 6, 4, 1, 0, 4, 2),
        vec![7.5f32.round(), 255.0, 19.5f32.round(), 255.0]
    );
}
