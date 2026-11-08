//! Golden cases for the text classifier: synthetic records and changed-pixel masks, one per kind
//! and per rule (design 2026-11-07-text-aware-diffs §4, with the spike's fixes).

use super::*;
use serde_json::json;

const W: usize = 120;
const H: usize = 60;

fn style(color: &str) -> Value {
    json!({ "family": "Inter", "size": 13, "weight": 400, "style": "normal", "lineHeight": 18,
        "letterSpacing": 0, "wordSpacing": 0, "transform": "none", "decoration": "none",
        "color": color, "features": "normal", "variation": "normal", "loaded": true })
}

/// A record from `(string, style, boxes)` runs, paths `0/<n>/#0`.
fn rec(runs: &[(&str, usize, &[TextBox])]) -> Record {
    rec_with(runs, &[], false)
}

fn rec_with(
    runs: &[(&str, usize, &[TextBox])],
    els: &[(&str, TextBox)],
    truncated: bool,
) -> Record {
    let runs: Vec<Value> = runs
        .iter()
        .enumerate()
        .map(|(n, (s, st, b))| json!({ "path": format!("0/{n}/#0"), "s": s, "st": st, "boxes": b }))
        .collect();
    let els: Vec<Value> = els
        .iter()
        .map(|(p, b)| json!({ "path": p, "tag": "div", "box": b }))
        .collect();
    let v = json!({ "v": 1, "frame": { "w": W, "h": H },
        "styles": [style("rgb(0, 0, 0)"), style("rgb(200, 0, 0)")],
        "runs": runs, "elements": els, "truncated": truncated });
    Record::parse(v.to_string().as_bytes()).unwrap()
}

/// A mask with these whole-pixel rectangles changed.
fn mask(rects: &[(usize, usize, usize, usize)]) -> Vec<u8> {
    let mut m = vec![0u8; W * H];
    for &(x, y, w, h) in rects {
        for yy in y..y + h {
            for xx in x..x + w {
                m[yy * W + xx] = 1;
            }
        }
    }
    m
}

fn run(a: &Record, b: &Record, m: &[u8]) -> Compared {
    classify(
        a,
        b,
        Pixels::Mask {
            w: W,
            h: H,
            m,
            base: (W, H),
            cur: (W, H),
        },
        &Tolerances::default(),
    )
}

#[test]
fn copy_same_place_with_pixels_inside_is_copy() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Tote", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let c = run(&a, &b, &mask(&[(20, 6, 6, 8)]));
    assert_eq!(c.kind, Some(Kind::Copy));
    assert_eq!(c.kinds, vec![ChangeKind::Copy]);
    assert_eq!((c.outside_px, c.inside_px), (0, 48));
    let ch = &c.changes[0];
    assert_eq!(
        (ch.was.as_deref(), ch.now.as_deref()),
        (Some("Total"), Some("Tote"))
    );
    assert!(!ch.whitespace);
    assert_eq!(ch.dx, None, "a copy change in place has no move");
}

/// #256: each tile's figure gains a trailing space, so its unit moves right by the space's
/// advance; all tiles sit on one line. Each move is credited to its own tile's figure (the nearest
/// preceding copy change), not the first.
#[test]
fn the_256_tiles_are_copy_reflow_each_pushed_by_its_own_figure() {
    let a = rec(&[
        ("1", 0, &[[4.0, 10.0, 7.0, 12.0]]),
        ("new", 0, &[[14.0, 10.0, 20.0, 12.0]]),
        ("5", 0, &[[60.0, 10.0, 7.0, 12.0]]),
        ("of 9", 0, &[[70.0, 10.0, 24.0, 12.0]]),
    ]);
    let b = rec(&[
        ("1 ", 0, &[[4.0, 10.0, 11.28, 12.0]]),
        ("new", 0, &[[18.28, 10.0, 20.0, 12.0]]),
        ("5 ", 0, &[[60.0, 10.0, 11.28, 12.0]]),
        ("of 9", 0, &[[74.28, 10.0, 24.0, 12.0]]),
    ]);
    let c = run(&a, &b, &mask(&[(14, 10, 25, 12), (70, 10, 29, 12)]));
    assert_eq!(c.kind, Some(Kind::CopyReflow));
    assert_eq!(c.outside_px, 0);
    assert_eq!(c.counts.copy, 2);
    assert_eq!(c.counts.moved, 2);
    for ch in c.changes.iter().filter(|x| x.kind == ChangeKind::Moved) {
        assert_eq!(ch.dx, Some(4.28));
        let by = &c.changes[ch.pushed_by.unwrap()];
        assert!(by.whitespace, "{by:?}");
        let expected = if ch.s.as_deref() == Some("new") {
            "1 "
        } else {
            "5 "
        };
        assert_eq!(
            by.now.as_deref(),
            Some(expected),
            "nearest preceding copy change"
        );
    }
}

#[test]
fn a_whitespace_copy_that_draws_nothing_is_kept_because_it_pushed_a_drawn_run() {
    let a = rec(&[
        ("1", 0, &[[4.0, 10.0, 7.0, 12.0]]),
        ("new", 0, &[[40.0, 10.0, 20.0, 12.0]]),
    ]);
    let b = rec(&[
        ("1 ", 0, &[[4.0, 10.0, 11.0, 12.0]]),
        ("new", 0, &[[44.0, 10.0, 20.0, 12.0]]),
    ]);
    let c = run(&a, &b, &mask(&[(40, 10, 24, 12)]));
    assert_eq!(c.kind, Some(Kind::CopyReflow));
    assert_eq!((c.counts.copy, c.counts.moved), (1, 1));
}

#[test]
fn a_move_with_no_copy_is_moved_and_a_rewrap_is_rewrapped() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Total", 0, &[[4.0, 20.0, 30.0, 12.0]])]);
    let c = run(&a, &b, &mask(&[(4, 4, 30, 28)]));
    assert_eq!(c.kind, Some(Kind::Moved));
    assert_eq!(c.changes[0].kind, ChangeKind::Moved);
    assert_eq!((c.changes[0].dx, c.changes[0].dy), (Some(0.0), Some(16.0)));
    assert!(!c.changes[0].pushed);

    let a = rec(&[("a long line", 0, &[[4.0, 4.0, 80.0, 12.0]])]);
    let b = rec(&[(
        "a long line",
        0,
        &[[4.0, 4.0, 40.0, 12.0], [4.0, 16.0, 38.0, 12.0]],
    )]);
    let c = run(&a, &b, &mask(&[(44, 4, 40, 12), (4, 16, 38, 12)]));
    assert_eq!(c.kinds, vec![ChangeKind::Rewrapped]);
    assert_eq!(c.kind, Some(Kind::Moved), "a rewrap not pushed by copy");
}

#[test]
fn a_copy_change_that_grows_a_line_pushes_the_runs_below() {
    let a = rec(&[
        ("Short", 0, &[[4.0, 4.0, 60.0, 12.0]]),
        ("below", 0, &[[4.0, 20.0, 30.0, 12.0]]),
    ]);
    let b = rec(&[
        (
            "Short, now two lines",
            0,
            &[[4.0, 4.0, 100.0, 12.0], [4.0, 16.0, 40.0, 12.0]],
        ),
        ("below", 0, &[[4.0, 32.0, 30.0, 12.0]]),
    ]);
    let c = run(
        &a,
        &b,
        &mask(&[(4, 4, 100, 12), (4, 16, 40, 12), (4, 28, 30, 16)]),
    );
    assert_eq!(c.kind, Some(Kind::CopyReflow));
    let moved = c
        .changes
        .iter()
        .find(|x| x.kind == ChangeKind::Moved)
        .unwrap();
    assert_eq!(moved.dy, Some(12.0));
    assert!(moved.pushed);
}

#[test]
fn a_font_fact_is_restyled_and_names_the_fact() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Total", 1, &[[4.0, 4.0, 30.0, 12.0]])]);
    let c = run(&a, &b, &mask(&[(4, 4, 30, 12)]));
    assert_eq!(c.kind, Some(Kind::Restyled));
    assert_eq!(c.changes[0].facts, vec!["color"]);
}

#[test]
fn added_and_removed_runs_count_like_copy() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[
        ("Total", 0, &[[4.0, 4.0, 30.0, 12.0]]),
        ("New", 0, &[[40.0, 4.0, 20.0, 12.0]]),
    ]);
    let c = run(&a, &b, &mask(&[(40, 4, 20, 12)]));
    assert_eq!(c.kind, Some(Kind::Copy));
    assert_eq!(c.kinds, vec![ChangeKind::Added]);
    assert_eq!(c.changes[0].s.as_deref(), Some("New"));
    let c = run(&b, &a, &mask(&[(40, 4, 20, 12)]));
    assert_eq!((c.kind, c.counts.removed), (Some(Kind::Copy), 1));
    assert_eq!(
        c.changes[0].bx,
        [40.0, 4.0, 20.0, 12.0],
        "a removed run's baseline box"
    );
}

#[test]
fn pixels_outside_text_are_pixel_with_the_text_facts_listed() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Total", 1, &[[4.0, 4.0, 30.0, 12.0]])]);
    let c = run(&a, &b, &mask(&[(4, 4, 30, 12), (80, 40, 10, 10)]));
    assert_eq!(c.kind, Some(Kind::Pixel));
    assert_eq!(c.kinds, vec![ChangeKind::Restyled]);
    assert_eq!(c.outside_px, 100);
    // Nothing in text differs: the change is outside text.
    let c = run(&a, &a, &mask(&[(80, 40, 10, 10)]));
    assert_eq!(
        (c.kind, c.kinds.len(), c.changes.len()),
        (Some(Kind::Pixel), 0, 0)
    );
}

#[test]
fn an_anti_aliasing_fringe_inside_edge_px_belongs_to_the_run() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Tote", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    // A 1px fringe right of the box and one 2px below it: within edgePx 2.
    let c = run(
        &a,
        &b,
        &mask(&[(20, 6, 6, 8), (34, 4, 1, 12), (4, 17, 30, 1)]),
    );
    assert_eq!((c.kind, c.outside_px), (Some(Kind::Copy), 0));
    // 3px away is outside.
    let c = run(&a, &b, &mask(&[(20, 6, 6, 8), (37, 4, 1, 12)]));
    assert_eq!((c.kind, c.outside_px), (Some(Kind::Pixel), 12));
}

#[test]
fn a_sub_pixel_move_inside_move_px_is_no_change() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Total", 0, &[[4.3, 4.3, 30.0, 12.0]])]);
    assert!(!differs(&a, &b, &Tolerances::default()));
    let c = run(&a, &b, &mask(&[]));
    assert_eq!((c.kind, c.change_count), (None, 0));
    let b = rec(&[("Total", 0, &[[4.6, 4.0, 30.0, 12.0]])]);
    assert!(
        differs(&a, &b, &Tolerances::default()),
        "0.6px is past movePx 0.5"
    );
}

#[test]
fn a_change_with_no_changed_pixel_gets_no_label() {
    let a = rec(&[("Behind a dialog", 0, &[[4.0, 4.0, 60.0, 12.0]])]);
    let b = rec(&[("Behind the dialog", 0, &[[4.0, 4.0, 64.0, 12.0]])]);
    let c = run(&a, &b, &mask(&[]));
    assert_eq!((c.kind, c.change_count, c.counts.copy), (None, 0, 0));
    let c = classify(&a, &b, Pixels::Unchanged, &Tolerances::default());
    assert_eq!((c.kind, c.change_count), (None, 0));
}

#[test]
fn a_painted_box_resized_by_copy_is_part_of_the_reflow() {
    // A card whose description wraps to a second line: the card grows by the line's height.
    let els = [("0/9", [0.0, 0.0, 110.0, 30.0])];
    let a = rec_with(&[("Short", 0, &[[4.0, 4.0, 60.0, 12.0]])], &els, false);
    let grown = [("0/9", [0.0, 0.0, 110.0, 42.0])];
    let b = rec_with(
        &[(
            "Short, now two lines",
            0,
            &[[4.0, 4.0, 100.0, 12.0], [4.0, 16.0, 40.0, 12.0]],
        )],
        &grown,
        false,
    );
    // The bottom border moved from y 29 to y 41.
    let m = mask(&[
        (4, 4, 100, 12),
        (4, 16, 40, 12),
        (0, 29, 110, 1),
        (0, 41, 110, 1),
    ]);
    let c = run(&a, &b, &m);
    assert_eq!(c.kind, Some(Kind::CopyReflow));
    assert!(c.element_px > 0 && c.outside_px == c.element_px, "{c:?}");
    // Without the element boxes, the border's pixels are a pixel change.
    let c = run(
        &rec(&[("Short", 0, &[[4.0, 4.0, 60.0, 12.0]])]),
        &rec(&[(
            "Short, now two lines",
            0,
            &[[4.0, 4.0, 100.0, 12.0], [4.0, 16.0, 40.0, 12.0]],
        )]),
        &m,
    );
    assert_eq!(c.kind, Some(Kind::Pixel));
}

#[test]
fn noise_px_allows_that_many_pixels_outside_text() {
    let a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let b = rec(&[("Tote", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let m = mask(&[(20, 6, 6, 8), (100, 50, 2, 2)]);
    let t = Tolerances {
        noise_px: 4,
        ..Tolerances::default()
    };
    let c = classify(
        &a,
        &b,
        Pixels::Mask {
            w: W,
            h: H,
            m: &m,
            base: (W, H),
            cur: (W, H),
        },
        &t,
    );
    assert_eq!((c.kind, c.outside_px), (Some(Kind::Copy), 4));
}

#[test]
fn a_unique_key_pairs_runs_whose_path_changed() {
    let mut a = rec(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let mut b = rec(&[("Totals", 0, &[[4.0, 4.0, 36.0, 12.0]])]);
    a.runs[0].key = Some("tile".into());
    b.runs[0].key = Some("tile".into());
    b.runs[0].path = "0/1/0/#0".into();
    let c = run(&a, &b, &mask(&[(30, 4, 8, 12)]));
    assert_eq!(c.kinds, vec![ChangeKind::Copy]);
    assert_eq!(c.changes[0].key.as_deref(), Some("tile"));
}

#[test]
fn runs_moved_the_same_way_by_the_same_push_fold_into_one_change() {
    let a = rec(&[
        ("1", 0, &[[4.0, 4.0, 7.0, 12.0]]),
        ("new", 0, &[[14.0, 4.0, 20.0, 12.0]]),
        ("of", 0, &[[36.0, 4.0, 12.0, 12.0]]),
        ("9", 0, &[[50.0, 4.0, 7.0, 12.0]]),
    ]);
    let b = rec(&[
        ("1 ", 0, &[[4.0, 4.0, 11.0, 12.0]]),
        ("new", 0, &[[18.0, 4.0, 20.0, 12.0]]),
        ("of", 0, &[[40.0, 4.0, 12.0, 12.0]]),
        ("9", 0, &[[54.0, 4.0, 7.0, 12.0]]),
    ]);
    let c = run(&a, &b, &mask(&[(14, 4, 47, 12)]));
    assert_eq!(c.kind, Some(Kind::CopyReflow));
    assert_eq!(c.counts.moved, 3);
    assert_eq!(c.change_count, 2, "one copy, one moved with two more");
    let moved = c
        .changes
        .iter()
        .find(|x| x.kind == ChangeKind::Moved)
        .unwrap();
    assert_eq!((moved.s.as_deref(), moved.same), (Some("new"), Some(2)));
}

#[test]
fn a_truncated_record_is_compared_and_says_so() {
    let a = rec_with(&[("Total", 0, &[[4.0, 4.0, 30.0, 12.0]])], &[], true);
    let b = rec(&[("Tote", 0, &[[4.0, 4.0, 30.0, 12.0]])]);
    let c = run(&a, &b, &mask(&[(20, 6, 6, 8)]));
    assert!(c.truncated);
    assert_eq!(c.kind, Some(Kind::Copy));
    let v = serde_json::to_value(run(&b, &b, &mask(&[]))).unwrap();
    assert!(v.get("truncated").is_none(), "{v}");
}

#[test]
fn the_row_shape_is_the_designs() {
    let a = rec(&[
        ("1", 0, &[[4.0, 10.0, 7.0, 12.0]]),
        ("new", 0, &[[14.0, 10.0, 20.0, 12.0]]),
    ]);
    let b = rec(&[
        ("1 ", 0, &[[4.0, 10.0, 11.28, 12.0]]),
        ("new", 0, &[[18.28, 10.0, 20.0, 12.0]]),
    ]);
    let v = serde_json::to_value(run(&a, &b, &mask(&[(14, 10, 25, 12)]))).unwrap();
    assert_eq!(
        v,
        json!({
            "kind": "copy-reflow", "kinds": ["copy", "moved"],
            "counts": { "runs": 2, "copy": 1, "moved": 1, "rewrapped": 0, "restyled": 0, "added": 0, "removed": 0 },
            "outsidePx": 0, "insidePx": 300, "elementPx": 0,
            "changes": [
                { "kind": "moved", "s": "new", "dx": 4.28, "dy": 0.0, "pushed": true, "pushedBy": 1,
                  "path": "0/1/#0", "box": [18.28, 10.0, 20.0, 12.0] },
                { "kind": "copy", "was": "1", "now": "1 ", "whitespace": true, "path": "0/0/#0",
                  "box": [4.0, 10.0, 11.28, 12.0] },
            ],
            "changeCount": 2,
        })
    );
}

#[test]
fn a_record_that_is_not_version_1_is_refused_and_a_run_without_a_box_is_left_out() {
    assert!(Record::parse(br#"{ "v": 2, "runs": [] }"#)
        .unwrap_err()
        .contains("version 2"));
    assert!(Record::parse(b"[]").is_err());
    let r = Record::parse(
        br#"{ "v": 1, "runs": [{ "path": "0/#0", "s": "a", "st": 0, "boxes": [] }] }"#,
    )
    .unwrap();
    assert!(r.runs.is_empty());
}

#[test]
fn a_capture_that_grew_by_a_copy_change_explains_the_strip_only_one_image_has() {
    // The render is 4px wider: its last 4 columns exist only in the render.
    let a = rec(&[
        ("1", 0, &[[4.0, 10.0, 7.0, 12.0]]),
        ("new", 0, &[[14.0, 10.0, 20.0, 12.0]]),
    ]);
    let b = rec(&[
        ("1 ", 0, &[[4.0, 10.0, 11.28, 12.0]]),
        ("new", 0, &[[18.28, 10.0, 20.0, 12.0]]),
    ]);
    let m = mask(&[(14, 10, 25, 12), (W - 4, 0, 4, H)]);
    let px = |base| Pixels::Mask {
        w: W,
        h: H,
        m: &m,
        base,
        cur: (W, H),
    };
    let c = classify(&a, &b, px((W - 4, H)), &Tolerances::default());
    assert_eq!(
        (c.kind, c.element_px),
        (Some(Kind::CopyReflow), 4 * H),
        "{c:?}"
    );
    // A growth no copy change explains stays a pixel change.
    let c = classify(&a, &b, px((W - 9, H)), &Tolerances::default());
    assert_eq!(c.kind, Some(Kind::Pixel));
}
