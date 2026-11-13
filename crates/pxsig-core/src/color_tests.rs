//! The color rule on synthetic badges: the changes the luminance rules miss fail, and the noise
//! the gate is calibrated against (a 0.4px shift, brightness ×1.004, opacity 0.99) passes.
use super::*;
use crate::compare::{compare_with_detail, GateThresholds};
use crate::detail::{detail_of, DetailGate, DetailParams};
use crate::signature::signature_of;

const W: usize = 900;
const H: usize = 600;
const GRID: usize = 64;
const GREY: [u8; 3] = [241, 242, 245];
const GREY_BORDER: [u8; 3] = [220, 222, 228];
const GREEN_TEXT: [u8; 3] = [22, 101, 52];
const RED_TEXT: [u8; 3] = [153, 27, 27];

/// A white 900×600 page with one 40×16 badge at (400, 300): a fill, a 1px border and "text"
/// (1px vertical strokes every 3px across its middle).
fn badge(fill: [u8; 3], border: [u8; 3], text: [u8; 3]) -> Vec<u8> {
    let (x0, y0, bw, bh) = (400, 300, 40, 16);
    let mut d = vec![255u8; W * H * 4];
    let mut put = |x: usize, y: usize, c: [u8; 3]| {
        d[(y * W + x) * 4..(y * W + x) * 4 + 3].copy_from_slice(&c)
    };
    for y in y0..y0 + bh {
        for x in x0..x0 + bw {
            let edge = y == y0 || y == y0 + bh - 1 || x == x0 || x == x0 + bw - 1;
            put(x, y, if edge { border } else { fill });
        }
    }
    for x in (x0 + 5..x0 + bw - 5).step_by(3) {
        for y in y0 + 4..y0 + bh - 4 {
            put(x, y, text);
        }
    }
    d
}

/// A busier page for the noise cases: a gradient header, rows of strokes, a dark panel, a badge.
fn ui() -> Vec<u8> {
    let mut d = badge(GREY, GREY_BORDER, GREEN_TEXT);
    for y in 0..H {
        for x in 0..W {
            let i = (y * W + x) * 4;
            let c = if y < 48 {
                let v = 200 + (x * 40 / W) as u8;
                [v, v, 255]
            } else if (100..260).contains(&y) && (40..400).contains(&x) {
                if (x / 2) % 3 == 0 && (y % 20) < 10 {
                    [230, 230, 240]
                } else {
                    [30, 40, 60]
                }
            } else if (100..260).contains(&y) && (500..860).contains(&x) && y % 24 == 0 {
                [200, 200, 205]
            } else {
                continue;
            };
            d[i..i + 3].copy_from_slice(&c);
        }
    }
    d
}

/// The project's gate (threshold 24, 3 cells, SSIM 0.99, 2%, the detail channel) with the color
/// rule's defaults.
fn gate() -> GateThresholds {
    GateThresholds {
        threshold: 24.0,
        min_cells: 3,
        detail: Some(DetailGate::default()),
        color: Some(ColorGate::default()),
        ..GateThresholds::default()
    }
}

/// Today's gate, then the color rule, as `pxsig check` runs them.
fn run(base: &[u8], cur: &[u8], g: &GateThresholds) -> CompareResult {
    let b = signature_of(base, W, H, GRID);
    let detail = detail_of(base, W, H, DetailParams::default());
    let mut r = compare_with_detail(
        &b.sig,
        &b.ahash,
        &b.dhash,
        &b.sha256,
        GRID,
        Some(&detail),
        cur,
        W,
        H,
        g,
    );
    if let Some(c) = &g.color {
        apply_color(&mut r, Some((base, W, H)), (W, H), (cur, W, H), c);
    }
    r
}

/// Today's gate alone.
fn without_color(base: &[u8], cur: &[u8]) -> CompareResult {
    run(
        base,
        cur,
        &GateThresholds {
            color: None,
            ..gate()
        },
    )
}

fn map(d: &[u8], f: impl Fn(f64) -> f64) -> Vec<u8> {
    let mut o = d.to_vec();
    for px in o.as_chunks_mut::<4>().0 {
        for c in &mut px[..3] {
            *c = f(*c as f64).round().clamp(0.0, 255.0) as u8;
        }
    }
    o
}

/// The calibration's noise: content moved 0.4px right (bilinear), brightness ×1.004, opacity 0.99.
fn noise(d: &[u8]) -> [(&'static str, Vec<u8>); 3] {
    let mut shift = d.to_vec();
    for y in 0..H {
        for x in 1..W {
            for c in 0..3 {
                let (i, j) = ((y * W + x) * 4 + c, (y * W + x - 1) * 4 + c);
                shift[i] = (0.6 * d[i] as f64 + 0.4 * d[j] as f64).round() as u8;
            }
        }
    }
    [
        ("subpixel", shift),
        ("brightness", map(d, |c| (c * 1.004).min(255.0))),
        ("opacity", map(d, |c| c * 0.99 + 255.0 * 0.01)),
    ]
}

#[test]
fn ciede2000_matches_the_published_test_data() {
    // Sharma, Wu and Dalal (2005), table 1: pairs 1, 7, 13, 17, 25 and 34.
    let cases = [
        ([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425),
        ([50.0, 0.0, 0.0], [50.0, -1.0, 2.0], 2.3669),
        ([50.0, 2.5, 0.0], [56.0, -27.0, -3.0], 31.9030),
        ([50.0, 2.5, 0.0], [50.0, 0.0, -2.5], 4.3065),
        (
            [60.2574, -34.0099, 36.2677],
            [60.4626, -34.1751, 39.4387],
            1.2644,
        ),
        (
            [22.7233, 20.0904, -46.6940],
            [23.0331, 14.9730, -42.5619],
            2.0373,
        ),
    ];
    for (p, q, want) in cases {
        let got = delta_e00(p, q);
        assert!((got - want).abs() < 1e-4, "{p:?} {q:?}: {got} != {want}");
        assert!((delta_e00(q, p) - want).abs() < 1e-4, "symmetric");
    }
    let white = lab([255, 255, 255]);
    assert!((white[0] - 100.0).abs() < 1e-3 && white[1].abs() < 1e-2 && white[2].abs() < 1e-2);
    assert_eq!(delta_e00(white, white), 0.0);
}

#[test]
fn a_grey_badge_turning_green_fails_on_its_flat_wash() {
    // #327's wash: grey (241,242,245) to the design system's success tint (ΔE00 7.8).
    let base = badge(GREY, GREY_BORDER, GREEN_TEXT);
    let cur = badge([222, 233, 226], [187, 214, 196], GREEN_TEXT);
    assert!((delta_e00(lab(GREY), lab([222, 233, 226])) - 7.8).abs() < 0.05);
    assert!(without_color(&base, &cur).pass, "today's gate passes it");
    let r = run(&base, &cur, &gate());
    assert!(!r.pass);
    let m = r.color.as_ref().unwrap();
    assert!(m.flat_area.unwrap() >= 64, "{m:?}");
    assert_eq!(
        r.reasons[0],
        format!(
            "color ΔE00 7.8 over {} px (flat area) >= 3",
            m.flat_area.unwrap()
        )
    );
}

#[test]
fn text_turning_from_green_to_red_fails_on_its_cells() {
    // The strokes are never flat, so only the cell check sees them.
    let base = badge(GREY, GREY_BORDER, GREEN_TEXT);
    let cur = badge(GREY, GREY_BORDER, RED_TEXT);
    assert!(without_color(&base, &cur).pass, "today's gate passes it");
    let r = run(&base, &cur, &gate());
    assert!(!r.pass);
    let m = r.color.as_ref().unwrap();
    assert!(m.flat_area.unwrap() < 64, "{m:?}");
    let cells = m.cells.unwrap();
    assert!(cells >= 3, "{m:?}");
    assert_eq!(r.reasons, [format!("color cells {cells} >= 3 (ΔE00 >= 5)")]);
}

#[test]
fn the_calibration_noise_passes() {
    for page in [
        badge(GREY, GREY_BORDER, GREEN_TEXT),
        badge([22, 163, 74], [22, 163, 74], [255; 3]),
        ui(),
    ] {
        for (name, cur) in noise(&page) {
            let r = run(&page, &cur, &gate());
            assert!(r.pass, "{name}: {:?} {:?}", r.reasons, r.color);
            let m = r.color.as_ref().unwrap();
            assert!(
                m.flat_area.unwrap() < 64 && m.cells.unwrap() < 3,
                "{name}: {m:?}"
            );
        }
    }
}

#[test]
fn identical_renders_measure_nothing() {
    let page = ui();
    let r = run(&page, &page, &gate());
    assert!(r.pass);
    assert_eq!(
        r.color,
        Some(ColorMetrics {
            flat_area: Some(0),
            cells: Some(0),
            ..ColorMetrics::default()
        })
    );
}

#[test]
fn a_result_that_failed_already_is_left_alone() {
    let base = badge(GREY, GREY_BORDER, GREEN_TEXT);
    let cur = badge([220, 38, 38], [220, 38, 38], [255; 3]);
    let r = run(&base, &cur, &gate());
    assert!(!r.pass);
    assert!(r.color.is_none(), "not measured");
    assert!(r.reasons.iter().all(|x| !x.starts_with("color")));
}

#[test]
fn the_settings_move_the_lines() {
    let base = badge(GREY, GREY_BORDER, GREEN_TEXT);
    let cur = badge([222, 233, 226], [187, 214, 196], GREEN_TEXT);
    let with = |c: ColorGate| {
        run(
            &base,
            &cur,
            &GateThresholds {
                color: Some(c),
                ..gate()
            },
        )
    };
    let area = with(ColorGate::default()).color.unwrap().flat_area.unwrap();
    let cells_off = ColorGate {
        min_cells: 0,
        ..ColorGate::default()
    };
    assert!(
        !with(ColorGate {
            min_area: area,
            ..cells_off
        })
        .pass,
        "at the line: fails"
    );
    assert!(
        with(ColorGate {
            min_area: area + 1,
            ..cells_off
        })
        .pass,
        "one more: passes"
    );
    assert!(
        with(ColorGate {
            delta_e: 8.0,
            ..cells_off
        })
        .pass,
        "a 7.8 wash under an 8 line"
    );
    let off = with(ColorGate {
        min_area: 0,
        min_cells: 0,
        ..ColorGate::default()
    });
    assert!(off.pass);
    assert_eq!(
        off.color.unwrap().flat_area,
        None,
        "0 turns the flat-area check off"
    );
}

#[test]
fn without_a_baseline_image_only_the_cells_are_checked() {
    let base = badge(GREY, GREY_BORDER, GREEN_TEXT);
    let cur = badge(GREY, GREY_BORDER, RED_TEXT);
    let b = signature_of(&base, W, H, GRID);
    let mut r = compare_with_detail(
        &b.sig,
        &b.ahash,
        &b.dhash,
        &b.sha256,
        GRID,
        None,
        &cur,
        W,
        H,
        &gate(),
    );
    apply_color(&mut r, None, (W, H), (&cur, W, H), &ColorGate::default());
    assert!(!r.pass);
    assert_eq!(r.color.unwrap().flat_area, None);
}

/// `d` (W × H) one pixel wider: a white column on the right, as a trimmed render grows.
fn wider(d: &[u8]) -> Vec<u8> {
    let mut o = Vec::with_capacity((W + 1) * H * 4);
    for y in 0..H {
        o.extend_from_slice(&d[y * W * 4..(y + 1) * W * 4]);
        o.extend_from_slice(&[255; 4]);
    }
    o
}

/// Today's gate on a render one pixel wider than the baseline, then the color rule.
fn run_wider(base: &[u8], cur: &[u8]) -> CompareResult {
    let b = signature_of(base, W, H, GRID);
    let detail = detail_of(base, W, H, DetailParams::default());
    let g = gate();
    let mut r = compare_with_detail(
        &b.sig,
        &b.ahash,
        &b.dhash,
        &b.sha256,
        GRID,
        Some(&detail),
        cur,
        W + 1,
        H,
        &g,
    );
    apply_color(
        &mut r,
        Some((base, W, H)),
        (W, H),
        (cur, W + 1, H),
        &ColorGate::default(),
    );
    r
}

#[test]
fn a_recolor_with_a_one_pixel_size_change_fails_on_the_region_both_cover() {
    let base = badge(GREY, GREY_BORDER, GREEN_TEXT);
    let cur = wider(&badge([222, 233, 226], [187, 214, 196], GREEN_TEXT));
    let r = run_wider(&base, &cur);
    assert!(!r.pass, "{:?}", r.color);
    let m = r.color.as_ref().unwrap();
    assert_eq!(
        m.cells, None,
        "the cells no longer cover the same pixels: not compared"
    );
    assert_eq!(
        r.reasons,
        [format!(
            "color ΔE00 7.8 over {} px (flat area) >= 3",
            m.flat_area.unwrap()
        )]
    );
}

#[test]
fn sub_pixel_noise_with_a_one_pixel_size_change_passes() {
    for page in [
        badge(GREY, GREY_BORDER, GREEN_TEXT),
        badge([22, 163, 74], [22, 163, 74], [255; 3]),
        ui(),
    ] {
        let [(_, shift), ..] = noise(&page);
        let r = run_wider(&page, &wider(&shift));
        assert!(r.pass, "{:?} {:?}", r.reasons, r.color);
        let m = r.color.as_ref().unwrap();
        assert!(m.flat_area.unwrap() < 64 && m.cells.is_none(), "{m:?}");
    }
}

#[test]
fn the_bound_never_skips_a_pair_that_reaches_the_line() {
    // Every 15th level of each channel against a spread of moves: wherever CIEDE2000 reaches a line,
    // the cheap bound says it may.
    let steps: Vec<u8> = (0..=255).step_by(15).collect();
    for &r in &steps {
        for &g in &steps {
            for &b in &steps {
                let p = lab([r, g, b]);
                for d in [
                    [1i16, 0, 0],
                    [0, 1, 0],
                    [0, 0, 1],
                    [3, -2, 4],
                    [-6, 5, -1],
                    [9, 9, -9],
                    [-20, 14, 30],
                ] {
                    let c = |v: u8, dv: i16| (v as i16 + dv).clamp(0, 255) as u8;
                    let q = lab([c(r, d[0]), c(g, d[1]), c(b, d[2])]);
                    let de = delta_e00(p, q);
                    for t in [0.5, 1.0, 3.0, 5.0, de] {
                        assert!(
                            de < t || may_reach(p, q, t),
                            "{r},{g},{b} {d:?} t {t}: {de}"
                        );
                    }
                }
            }
        }
    }
}
