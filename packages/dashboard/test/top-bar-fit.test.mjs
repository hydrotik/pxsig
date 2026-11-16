/**
 * The top bar's fit (src/parts/top-bar-fit.ts) on a model bar: a list whose links all show while
 * the room holds them and move into More otherwise, as an adapter's NavList does. Over widths, the
 * state it settles on keeps the collapse order (details, the label's cap, links into More, the
 * label truncating, compact controls), never shows fewer links or end controls on a wider bar,
 * and is the same whether the bar got there by narrowing or by widening.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPACT, DETAILS, FULL, cost, decide, same } from '../src/parts/top-bar-fit.ts';

/** A bar: brand mark and padding take `fixed`; the list needs `links` for every link, `more` for More and Help. */
const BAR = {
  fixed: 120,
  links: 520,
  more: 90,
  details: [190, 90, 120],
  compact: [
    [224, 80],
    [130, 70],
    [170, 16],
    [110, 16],
    [24, 12],
  ],
  scope: { natural: 300, cap: 210, min: 36 },
  tol: 8,
};

/** What the page would measure at `width` in state `s`. */
function measure(bar, width, s) {
  const m = {
    width,
    room: 0,
    details: bar.details,
    compact: bar.compact,
    scope: bar.scope,
    links: null,
    more: null,
    tol: bar.tol,
  };
  m.room = width - bar.fixed - cost(m, s);
  // The adapter: every link while they fit (within its own margin), else More.
  if (m.room >= bar.links + 2) m.links = bar.links;
  else m.more = bar.more;
  return m;
}

/** Decide until the state holds, from `start`, remembering the widths seen as the hook does. */
function settle(bar, width, start, known = { links: null, more: null }) {
  let s = start;
  for (let i = 0; i < 12; i++) {
    const m = measure(bar, width, s);
    if (m.links != null) known.links = m.links;
    if (m.more != null) known.more = m.more;
    const next = decide(m, s, known);
    if (same(next, s)) return { s, m, known };
    s = next;
  }
  throw new Error(`no settled state at ${width}px`);
}

const WIDTHS = Array.from({ length: (2200 - 420) / 4 + 1 }, (_, i) => 2200 - i * 4);
const linksShown = (r) => (r.m.links != null ? 7 : 1);
const endShown = (r) => DETAILS.length - r.s.shed + 4;

test('narrowing: details first, then the cap, links into More, the label, compact controls', () => {
  const known = { links: null, more: null };
  let s = FULL;
  /** @type {string[]} */
  const seen = [];
  for (const w of WIDTHS) {
    const r = settle(BAR, w, s, known);
    s = r.s;
    const phase =
      r.s.compact > 0
        ? `compact ${COMPACT[r.s.compact - 1]}`
        : typeof r.s.scope === 'number'
          ? 'label'
          : r.m.links == null
            ? 'more'
            : r.s.scope === 'cap' && r.s.shed === DETAILS.length
              ? 'cap'
              : `shed ${r.s.shed}`;
    if (seen.at(-1) !== phase) seen.push(phase);
    // The last check shows only while every link does.
    if (r.s.shed === 0)
      assert.ok(r.m.links != null, `${w}px: the last check shows with links in More`);
    // Once the links are in More, the list keeps only what More and Help need.
    if (r.s.compact > 0)
      assert.ok(r.m.room - (BAR.more + BAR.tol) < 1, `${w}px: spare room left in the list`);
  }
  assert.deepEqual(seen, [
    'shed 0',
    'shed 1',
    'shed 2',
    'cap',
    'more',
    'label',
    'compact picker',
    'compact review',
    'compact connection',
    'compact status',
    'compact tight',
  ]);
});

test('a wider bar never shows fewer links or end controls, and widening reverses narrowing', () => {
  const down = new Map();
  let s = FULL;
  const known = { links: null, more: null };
  for (const w of WIDTHS) {
    const r = settle(BAR, w, s, known);
    s = r.s;
    down.set(w, r);
  }
  for (let i = 1; i < WIDTHS.length; i++) {
    const [wide, narrow] = [down.get(WIDTHS[i - 1]), down.get(WIDTHS[i])];
    assert.ok(linksShown(narrow) <= linksShown(wide), `${WIDTHS[i]}px: more links than wider`);
    assert.ok(endShown(narrow) <= endShown(wide), `${WIDTHS[i]}px: more end controls than wider`);
  }
  for (const w of [...WIDTHS].reverse()) {
    const r = settle(BAR, w, s, known);
    s = r.s;
    assert.deepEqual(r.s, down.get(w).s, `${w}px: widening settles elsewhere than narrowing`);
  }
});

test('a fresh page at any width settles where the sweep did', () => {
  let s = FULL;
  const known = { links: null, more: null };
  for (const w of WIDTHS) {
    s = settle(BAR, w, s, known).s;
    if (w % 64) continue;
    // A first measure in the full state, with nothing known yet.
    assert.deepEqual(settle(BAR, w, FULL).s, s, `${w}px`);
  }
});

test('below 1024px the label is capped while the links still fit', () => {
  const bar = { ...BAR, links: 300, details: [0, 0, 0], compact: BAR.compact.map(() => [0, 0]) };
  const r = settle(bar, 1000, FULL);
  assert.equal(r.s.scope, 'cap');
  assert.ok(r.m.links != null);
  assert.equal(settle(bar, 1100, FULL).s.scope, 'full');
  assert.equal(settle(bar, 1100, FULL).m.links, 300);
});

test('the picker narrows by what is needed, to its narrowest, before the other controls go compact', () => {
  // A width where the label is at its shortest and the picker must give a little.
  let s = FULL;
  const known = { links: null, more: null };
  const states = [];
  for (const w of WIDTHS) states.push([w, (s = settle(BAR, w, s, known).s)]);
  const picker = states.filter(([, x]) => x.compact === 1);
  assert.ok(picker.length > 2, 'the picker narrows over several widths');
  const widths = picker.map(([, x]) => x.picker);
  assert.deepEqual(
    [...widths].sort((a, b) => b - a),
    widths,
    'narrower as the bar narrows'
  );
  assert.ok(widths.every((x) => x >= BAR.compact[0][1] && x <= BAR.compact[0][0]));
});
