/**
 * The `top-bar` rule's findings (packages/pxsig/src/dashboard-check/top-bar.mjs, `topBarFindings`)
 * from samples made by hand: each broken property of the bar is named, and a bar that keeps them
 * all has none. The rule end to end, on real adapters, is dashboard-fidelity-adapter.test.mjs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { topBarFindings, KEPT } = await import('../../pxsig/src/dashboard-check/top-bar.mjs');

const ALL = ['#overview', '#stories', '#integrity', '#help'];
/** A bar at `width` showing `links` (More holding the rest), its end controls `end`. */
function sample(
  width,
  links,
  { dir = 'down', end = ['connection'], details = [], menu, ...more } = {}
) {
  const held = ALL.filter((h) => !links.includes(h));
  const boxes = links.map((_, i) => /** @type {[number, number]} */ ([100 + i * 80, 170 + i * 80]));
  const keptAt = boxes[links.indexOf(KEPT)] ?? [0, 0];
  const trigger = held.length
    ? { box: /** @type {[number, number]} */ ([keptAt[0] - 60, keptAt[0] - 10]), problem: null }
    : null;
  if (trigger) boxes[links.indexOf(KEPT)] = keptAt;
  return {
    width,
    dir,
    m: {
      mark: true,
      overflow: 0,
      rows: 1,
      wrapped: [],
      links,
      linkBoxes: boxes,
      trigger,
      kept: links.includes(KEPT) ? { box: keptAt, problem: null } : null,
      tabbable: [],
      end,
      details,
      ...more,
    },
    menu: trigger ? (menu ?? { items: held, loose: false, back: true }) : null,
  };
}
const sweep = (...xs) => {
  const down = xs.map((x) => sample(...x));
  const up = [...xs]
    .reverse()
    .slice(1)
    .map(([w, l, o = {}]) => sample(w, l, { ...o, dir: 'up' }));
  return [...down, ...up];
};

test('a bar that keeps every rule has no finding', () => {
  const samples = sweep(
    [1440, ALL, { end: ['connection', 'last check'], details: ['last check'] }],
    [800, ['#overview', '#stories', '#help']],
    [390, ['#help']]
  );
  // The middle sample's links: the trigger sits after the last one shown, before Help.
  samples[1].m.linkBoxes = [
    [100, 170],
    [180, 250],
    [320, 360],
  ];
  samples[1].m.trigger = { box: [260, 310], problem: null };
  samples[1].m.kept = { box: [320, 360], problem: null };
  assert.deepEqual(topBarFindings('changed', samples.slice(0, 3)), []);
});

test('each broken property is named, with its scenario and width', () => {
  const s = sweep([1440, ALL], [800, ['#overview', '#help']], [390, ['#help']]);
  s[1].m.overflow = 12;
  s[1].m.rows = 2;
  s[1].m.wrapped = ['<a "Review Stories"> takes 2 lines'];
  s[1].m.tabbable = [
    '<button "Light theme"> is in the tab order but cut off by <nav "Report sections">',
  ];
  s[1].m.details = ['last check'];
  s[2].m.kept = { box: [0, 10], problem: 'cut off by <ul "Help">' };
  s[2].m.trigger = { box: [0, 10], problem: 'covered by <select "Project">' };
  s[2].menu = { items: ['#overview', '#overview', '#stories'], loose: true, back: false };
  const found = topBarFindings('changed', s).map((f) => f.text);
  const has = (re) =>
    assert.ok(
      found.some((t) => re.test(t)),
      `${re}:\n  ${found.join('\n  ')}`
    );
  has(/^changed at 800px: the page scrolls sideways \(12px\)$/);
  has(/^changed at 800px: the bar takes 2 lines$/);
  has(/^changed at 800px: <a "Review Stories"> takes 2 lines$/);
  has(/^changed at 800px: <button "Light theme"> is in the tab order but cut off/);
  has(/^changed at 800px: the last check shows while links are in More/);
  has(/^changed at 390px: the kept link is cut off by <ul "Help">$/);
  has(/^changed at 390px: the More trigger is covered by <select "Project">$/);
  has(/^changed at 390px: #overview shows twice/);
  has(/^changed at 390px: #integrity is in neither the bar nor More$/);
  has(/^changed at 390px: the More menu holds text outside its items$/);
  has(/^changed at 390px: Escape did not return focus to the More trigger$/);
});

test('a wider bar with fewer links, or a bar that widens into another state, is a finding', () => {
  const s = sweep(
    [1440, ALL],
    [1200, ['#overview', '#help']],
    [1000, ['#overview', '#stories', '#help']]
  );
  // Widening to 1200 shows all links, where narrowing showed two.
  s.find((x) => x.dir === 'up' && x.width === 1200).m.links = ALL;
  const found = topBarFindings('clean', s).map((f) => f.text);
  assert.ok(
    found.some((t) => /^clean at 1000px: 3 links in the bar, more than at 1200px \(2\)$/.test(t)),
    found.join('\n')
  );
  assert.ok(
    found.some((t) => t.startsWith('clean at 1200px: widening shows another bar')),
    found.join('\n')
  );
});

test('More in the wrong place, out of order, or empty, is a finding', () => {
  const s = [sample(1440, ALL), sample(800, ['#overview', '#help'])];
  s[1].m.trigger = { box: [10, 40], problem: null };
  s[1].menu = { items: ['#integrity', '#stories'], loose: false, back: true };
  const found = topBarFindings('changed', s).map((f) => f.text);
  assert.ok(
    found.some((t) => /More trigger is not between the last link shown and the kept link/.test(t))
  );
  assert.ok(found.some((t) => /More holds the links out of the bar's order/.test(t)));
  s[1].menu = { items: [], loose: false, back: true };
  assert.ok(topBarFindings('changed', s).some((f) => /More shows with nothing in it/.test(f.text)));
});

test('a bar without pxsig-ui-TopNav: TopNav does not put className on its root', () => {
  assert.deepEqual(
    topBarFindings('clean', [
      { width: 1440, dir: 'down', m: { mark: false, overflow: 0 }, menu: null },
    ]),
    [
      {
        rule: 'top-bar',
        text: "clean: no element carries pxsig-ui-TopNav: TopNav must put its className on the bar's root",
      },
    ]
  );
});
