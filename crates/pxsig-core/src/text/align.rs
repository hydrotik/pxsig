//! Runs in two records, aligned and turned into changes; pushes credited to copy changes; the
//! changes as a row lists them.

use std::collections::HashMap;

use super::{r2, Change, ChangeKind, Record, Run, TextBox, Tolerances, FACTS};

/// A change while it is classified: the runs it is about (`i` in the baseline, `j` in the render).
#[derive(Debug, Clone)]
pub(super) struct Ch {
    pub kind: ChangeKind,
    pub i: Option<usize>,
    pub j: Option<usize>,
    pub dx: f64,
    pub dy: f64,
    pub facts: Vec<&'static str>,
    pub whitespace: bool,
    /// A copy change whose first box moved too.
    pub start_moved: bool,
    /// The copy change (an index in the same list) whose growth explains this one's move.
    pub pushed_by: Option<usize>,
}

impl Ch {
    /// A change that moved and needs a push to explain it.
    pub fn moves(&self) -> bool {
        matches!(self.kind, ChangeKind::Moved | ChangeKind::Rewrapped)
            || (self.kind == ChangeKind::Copy && self.start_moved)
    }

    /// A change in the copy: a string changed, added or removed.
    pub fn copyish(&self) -> bool {
        matches!(
            self.kind,
            ChangeKind::Copy | ChangeKind::Added | ChangeKind::Removed
        )
    }
}

/// The biggest middle an alignment compares run by run (cells of its table); past it, runs are
/// paired by key and path only.
const MAX_CELLS: usize = 4_000_000;

/// The longest common subsequence of two key lists: equal prefix and suffix first, a table for
/// the middle.
fn lcs<T: PartialEq>(a: &[T], b: &[T]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    let mut s = 0;
    while s < a.len() && s < b.len() && a[s] == b[s] {
        pairs.push((s, s));
        s += 1;
    }
    let (mut ea, mut eb) = (a.len(), b.len());
    let mut tail = Vec::new();
    while ea > s && eb > s && a[ea - 1] == b[eb - 1] {
        ea -= 1;
        eb -= 1;
        tail.push((ea, eb));
    }
    let (n, m) = (ea - s, eb - s);
    if n > 0 && m > 0 && n * m <= MAX_CELLS {
        let w = m + 1;
        let mut l = vec![0u32; (n + 1) * w];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                l[i * w + j] = if a[s + i] == b[s + j] {
                    l[(i + 1) * w + j + 1] + 1
                } else {
                    l[(i + 1) * w + j].max(l[i * w + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < n && j < m {
            if a[s + i] == b[s + j] {
                pairs.push((s + i, s + j));
                i += 1;
                j += 1;
            } else if l[(i + 1) * w + j] >= l[i * w + j + 1] {
                i += 1;
            } else {
                j += 1;
            }
        }
    }
    pairs.extend(tail.into_iter().rev());
    pairs
}

/// A record's keys that only one run has: a shared key pairs nothing reliably.
fn unique_keys(r: &Record) -> Vec<Option<&str>> {
    let mut n: HashMap<&str, usize> = HashMap::new();
    for k in r.runs.iter().filter_map(|x| x.key.as_deref()) {
        *n.entry(k).or_default() += 1;
    }
    r.runs
        .iter()
        .map(|x| x.key.as_deref().filter(|k| n[k] == 1))
        .collect()
}

/// Pairs the runs still unpaired whose `by` value is equal, in document order.
fn pair_by<'a>(
    ma: &mut [Option<usize>],
    mb: &mut [Option<usize>],
    ka: &[Option<&'a str>],
    kb: &[Option<&'a str>],
) {
    let mut idx: HashMap<&str, Vec<usize>> = HashMap::new();
    for (j, k) in kb.iter().enumerate() {
        if let (None, Some(k)) = (mb[j], k) {
            idx.entry(k).or_default().push(j);
        }
    }
    for (i, k) in ka.iter().enumerate() {
        let Some(list) = k.filter(|_| ma[i].is_none()).and_then(|k| idx.get(k)) else {
            continue;
        };
        if let Some(&j) = list.iter().find(|&&j| mb[j].is_none()) {
            ma[i] = Some(j);
            mb[j] = Some(i);
        }
    }
}

fn near(x: f64, y: f64, t: &Tolerances) -> bool {
    (x - y).abs() <= t.move_px
}

pub(super) fn right(b: &[TextBox]) -> f64 {
    b.last().map_or(0.0, |x| x[0] + x[2])
}

pub(super) fn bottom(b: &[TextBox]) -> f64 {
    b.iter().map(|x| x[1] + x[3]).fold(f64::MIN, f64::max)
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The font facts that differ between two runs' styles.
fn facts(a: &Record, ra: &Run, b: &Record, rb: &Run) -> Vec<&'static str> {
    let (sa, sb) = (a.styles.get(ra.st), b.styles.get(rb.st));
    FACTS
        .into_iter()
        .filter(|f| sa.and_then(|s| s.get(f)) != sb.and_then(|s| s.get(f)))
        .collect()
}

/// Every change between the records: pairs not the same (render order), then runs added, then
/// runs removed.
pub(super) fn changes(a: &Record, b: &Record, t: &Tolerances) -> Vec<Ch> {
    fn key(r: &Run) -> (&str, &str) {
        (r.path.as_str(), r.s.as_str())
    }
    fn path(r: &Record) -> Vec<Option<&str>> {
        r.runs.iter().map(|x| Some(x.path.as_str())).collect()
    }
    let pairs = lcs(
        &a.runs.iter().map(key).collect::<Vec<_>>(),
        &b.runs.iter().map(key).collect::<Vec<_>>(),
    );
    let (mut ma, mut mb) = (vec![None; a.runs.len()], vec![None; b.runs.len()]);
    for (i, j) in pairs {
        ma[i] = Some(j);
        mb[j] = Some(i);
    }
    pair_by(&mut ma, &mut mb, &unique_keys(a), &unique_keys(b));
    pair_by(&mut ma, &mut mb, &path(a), &path(b));

    let mut out = Vec::new();
    let blank = |kind, i, j| Ch {
        kind,
        i,
        j,
        dx: 0.0,
        dy: 0.0,
        facts: Vec::new(),
        whitespace: false,
        start_moved: false,
        pushed_by: None,
    };
    for (j, i) in mb.iter().enumerate() {
        let Some(i) = *i else {
            out.push(blank(ChangeKind::Added, None, Some(j)));
            continue;
        };
        let (ra, rb) = (&a.runs[i], &b.runs[j]);
        let facts = facts(a, ra, b, rb);
        let (dx, dy) = (
            rb.boxes[0][0] - ra.boxes[0][0],
            rb.boxes[0][1] - ra.boxes[0][1],
        );
        let count = ra.boxes.len() == rb.boxes.len();
        let zip = || ra.boxes.iter().zip(&rb.boxes);
        let in_place = count && zip().all(|(p, q)| (0..4).all(|k| near(p[k], q[k], t)));
        let rigid = count
            && zip().all(|(p, q)| {
                near(p[2], q[2], t)
                    && near(p[3], q[3], t)
                    && near(q[0] - p[0], dx, t)
                    && near(q[1] - p[1], dy, t)
            });
        let kind = if ra.s != rb.s {
            ChangeKind::Copy
        } else if !facts.is_empty() {
            ChangeKind::Restyled
        } else if in_place {
            continue;
        } else if rigid {
            ChangeKind::Moved
        } else {
            ChangeKind::Rewrapped
        };
        out.push(Ch {
            whitespace: kind == ChangeKind::Copy && collapse(&ra.s) == collapse(&rb.s),
            start_moved: kind == ChangeKind::Copy && !(near(dx, 0.0, t) && near(dy, 0.0, t)),
            dx,
            dy,
            facts,
            ..blank(kind, Some(i), Some(j))
        });
    }
    out.extend(
        ma.iter()
            .enumerate()
            .filter(|(_, j)| j.is_none())
            .map(|(i, _)| blank(ChangeKind::Removed, Some(i), None)),
    );
    out
}

/// How a copy change moves what follows it: its last line, and how far its end moved right
/// (`dw`) and its bottom down (`dh`). A run added grows by its extent; a run removed shrinks by it.
pub(super) fn growth(c: &Ch, a: &Record, b: &Record) -> Option<(TextBox, f64, f64)> {
    let ext = |bx: &[TextBox]| (right(bx) - bx[0][0], bottom(bx) - bx[0][1]);
    match (c.kind, c.i, c.j) {
        (ChangeKind::Copy, Some(i), Some(j)) => {
            let (pa, pb) = (&a.runs[i].boxes, &b.runs[j].boxes);
            Some((*pb.last()?, right(pb) - right(pa), bottom(pb) - bottom(pa)))
        }
        (ChangeKind::Added, _, Some(j)) => {
            let bx = &b.runs[j].boxes;
            let (w, h) = ext(bx);
            Some((*bx.last()?, w, h))
        }
        (ChangeKind::Removed, Some(i), _) => {
            let bx = &a.runs[i].boxes;
            let (w, h) = ext(bx);
            Some((*bx.last()?, -w, -h))
        }
        _ => None,
    }
}

/// Credits each moved run to the nearest preceding copy change whose growth explains its move:
/// on that change's line (the boxes overlap vertically) by its `dw`, or below it by its `dh`.
pub(super) fn push(chs: &mut [Ch], a: &Record, b: &Record, t: &Tolerances) {
    let pushers: Vec<usize> = (0..chs.len()).filter(|&k| chs[k].copyish()).collect();
    for c in 0..chs.len() {
        if !chs[c].moves() {
            continue;
        }
        let (Some(ci), Some(cj)) = (chs[c].i, chs[c].j) else {
            continue;
        };
        // How far before `c` each pusher is, in its own record's order.
        let mut before: Vec<(usize, usize)> = pushers
            .iter()
            .filter(|&&k| k != c)
            .filter_map(|&k| match (chs[k].j, chs[k].i) {
                (Some(kj), _) => (kj < cj).then(|| (cj - kj, k)),
                (None, Some(ki)) => (ki < ci).then(|| (ci - ki, k)),
                _ => None,
            })
            .collect();
        before.sort_unstable();
        let r0 = b.runs[cj].boxes[0];
        for (_, k) in before {
            let Some((line, dw, dh)) = growth(&chs[k], a, b) else {
                continue;
            };
            let overlap = (r0[1] + r0[3]).min(line[1] + line[3]) - r0[1].max(line[1]) > 0.0;
            let on_line = near(chs[c].dy, 0.0, t) && near(chs[c].dx, dw, t) && overlap;
            let below = near(chs[c].dy, dh, t) && !near(dh, 0.0, t);
            if on_line || below {
                chs[c].pushed_by = Some(k);
                break;
            }
        }
    }
}

/// The changes as a row lists them: runs moved the same way by the same push folded into the
/// first (`same`), then largest first (by box area; document order on a tie).
pub(super) fn listed(chs: &[Ch], a: &Record, b: &Record, t: &Tolerances) -> Vec<Change> {
    let mut folded_into: Vec<Option<usize>> = vec![None; chs.len()];
    let mut same = vec![0usize; chs.len()];
    for c in 0..chs.len() {
        if chs[c].kind != ChangeKind::Moved {
            continue;
        }
        let first = (0..c).find(|&f| {
            folded_into[f].is_none()
                && chs[f].kind == ChangeKind::Moved
                && chs[f].pushed_by == chs[c].pushed_by
                && near(chs[f].dx, chs[c].dx, t)
                && near(chs[f].dy, chs[c].dy, t)
        });
        if let Some(f) = first {
            folded_into[c] = Some(f);
            same[f] += 1;
        }
    }
    let area = |c: &Ch| {
        let sum = |bx: &[TextBox]| bx.iter().map(|x| x[2] * x[3]).sum::<f64>();
        let sa = c.i.map_or(0.0, |i| sum(&a.runs[i].boxes));
        let sb = c.j.map_or(0.0, |j| sum(&b.runs[j].boxes));
        sa.max(sb)
    };
    let mut order: Vec<usize> = (0..chs.len())
        .filter(|&c| folded_into[c].is_none())
        .collect();
    order.sort_by(|&p, &q| area(&chs[q]).total_cmp(&area(&chs[p])).then(p.cmp(&q)));
    let at: HashMap<usize, usize> = order.iter().enumerate().map(|(n, &c)| (c, n)).collect();
    order
        .iter()
        .map(|&c| {
            let ch = &chs[c];
            let run =
                ch.j.map_or_else(|| &a.runs[ch.i.unwrap_or(0)], |j| &b.runs[j]);
            let was = ch.i.map(|i| a.runs[i].s.clone());
            let copy = ch.kind == ChangeKind::Copy;
            let moved = ch.moves() || ch.kind == ChangeKind::Restyled;
            Change {
                kind: ch.kind,
                now: copy.then(|| run.s.clone()),
                s: (!copy).then(|| run.s.clone()),
                was: was.filter(|_| copy),
                whitespace: ch.whitespace,
                facts: ch.facts.clone(),
                dx: moved.then(|| r2(ch.dx)),
                dy: moved.then(|| r2(ch.dy)),
                pushed: ch.pushed_by.is_some(),
                pushed_by: ch.pushed_by.and_then(|k| at.get(&k).copied()),
                same: (same[c] > 0).then_some(same[c]),
                key: run.key.clone(),
                path: run.path.clone(),
                bx: run.boxes[0].map(r2),
            }
        })
        .collect()
}
