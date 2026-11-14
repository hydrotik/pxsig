// lib/screens-repeat.mjs: two renders of a fixture screen compared, and the verdict on the differences.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  compareRepeat,
  firstLineDiff,
  pixelDiff,
  repeatMarkdown,
  repeatVerdict,
} from './lib/screens-repeat.mjs';

/** @import { ScreenResult } from '../packages/pxsig/src/types/t4.js' */

/** A w×h image, every pixel `fill`, with `set` pixels ([x, y]) another colour. */
const image = (
  /** @type {number} */ w,
  /** @type {number} */ h,
  /** @type {[number, number][]} */ set = []
) => {
  const data = Buffer.alloc(w * h * 4, 0x20);
  for (const [x, y] of set) data.writeUInt32BE(0xff0000ff, (y * w + x) * 4);
  return { width: w, height: h, data };
};

test('pixelDiff counts the pixels that differ and boxes them', () => {
  assert.deepEqual(pixelDiff(image(10, 8), image(10, 8)), { pixels: 0, box: null, size: null });
  assert.deepEqual(
    pixelDiff(
      image(10, 8),
      image(10, 8, [
        [2, 3],
        [5, 6],
      ])
    ),
    { pixels: 2, box: { x: 2, y: 3, w: 4, h: 4 }, size: null }
  );
  const d = pixelDiff(image(10, 8), image(10, 9));
  assert.equal(d.pixels, 90);
  assert.equal(d.size, '10×8 then 10×9');
});

test('firstLineDiff names the first line that differs', () => {
  assert.equal(firstLineDiff('a\nb', 'a\nb'), null);
  assert.equal(firstLineDiff(null, ''), null);
  assert.equal(
    firstLineDiff('- button "Approve"\n- text: 3', '- button "Approve"\n- text: 4'),
    'line 2: - text: 3 | - text: 4'
  );
  assert.equal(firstLineDiff('a', 'a\nb'), 'line 2: (none) | b');
});

/** @returns {ScreenResult} */
const screen = (/** @type {Partial<ScreenResult>} */ x) =>
  /** @type {ScreenResult} */ (
    /** @type {unknown} */ ({
      feature: 'runs.chart',
      index: 0,
      theme: 'dark',
      rendered: true,
      shot: 'a.png',
      aria: '- img "Runs"',
      ...x,
    })
  );

const io = (/** @type {Record<string, ReturnType<typeof image>>} */ images, pass = true) => ({
  idOf: (/** @type {ScreenResult} */ x) =>
    `${x.feature.replace('.', '--')}-${x.index + 1}@${x.theme}`,
  read: (/** @type {ScreenResult} */ x) => images[x.shot ?? ''],
  gate: () => ({ pass, ssim: pass ? 0.9999 : 0.97 }),
});

test('compareRepeat: the same render twice is stable', () => {
  const imgs = { 'a.png': image(4, 4), 'b.png': image(4, 4) };
  assert.deepEqual(compareRepeat([screen({})], [screen({ shot: 'b.png' })], io(imgs)), []);
});

test('compareRepeat reports pixels, region, gate, structure and anchors', () => {
  const imgs = { 'a.png': image(4, 4), 'b.png': image(4, 4, [[1, 2]]) };
  const [u, ...rest] = compareRepeat(
    [screen({ anchors: { chart: [0, 0, 4, 4] } })],
    [screen({ shot: 'b.png', aria: '- img "Runs, 3"', anchors: { chart: [0, 1, 4, 4] } })],
    io(imgs)
  );
  assert.equal(rest.length, 0);
  assert.equal(u.id, 'runs--chart-1@dark');
  assert.equal(u.pixels, 1);
  assert.deepEqual(u.box, { x: 1, y: 2, w: 1, h: 1 });
  assert.deepEqual(u.gate, { pass: true, ssim: 0.9999 });
  assert.match(u.what[0], /^1 px differ, 1×1 at 1,2 \(within the gate, ssim 0\.9999\)$/);
  assert.match(u.what[1], /^structure differs, line 1: - img "Runs" \| - img "Runs, 3"$/);
  assert.match(u.what[2], /^anchors differ/);
});

test('compareRepeat: a difference beyond the gate says so; within or beyond, it is unstable', () => {
  const imgs = { 'a.png': image(4, 4), 'b.png': image(4, 4, [[0, 0]]) };
  const [u] = compareRepeat([screen({})], [screen({ shot: 'b.png' })], io(imgs, false));
  assert.match(u.what[0], /beyond the gate, ssim 0\.97/);
});

test('compareRepeat: a screen rendered by one pass only is unstable; by neither, not', () => {
  const imgs = { 'a.png': image(4, 4) };
  const r = compareRepeat(
    [screen({}), screen({ index: 1, rendered: false, reason: 'landmark missing' })],
    [
      screen({ rendered: false, reason: 'landmark missing: Runs' }),
      screen({ index: 1, rendered: false }),
    ],
    io(imgs)
  );
  assert.deepEqual(
    r.map((u) => [u.id, u.what]),
    [['runs--chart-1@dark', ['pass 2 did not render it: landmark missing: Runs']]]
  );
  assert.deepEqual(
    compareRepeat([screen({})], [], io(imgs)).map((u) => u.what),
    [['not rendered by pass 2']]
  );
});

test('repeatVerdict: unlisted unstable screens fail, listed ones are noted, unknown entries fail', () => {
  const unstable = [
    {
      id: 'runs--chart-1@dark',
      what: ['1 px differ'],
      pixels: 1,
      box: null,
      gate: null,
      aria: null,
    },
    {
      id: 'runs--chart-1@light',
      what: ['2 px differ'],
      pixels: 2,
      box: null,
      gate: null,
      aria: null,
    },
  ];
  const ids = new Set(['runs--chart-1@dark', 'runs--chart-1@light', 'shell--top-1@dark']);
  const checked = ids;
  const empty = repeatVerdict(unstable, {}, { ids, checked });
  assert.deepEqual(empty.problems, [
    'unstable runs--chart-1@dark: 1 px differ',
    'unstable runs--chart-1@light: 2 px differ',
  ]);
  const v = repeatVerdict(
    unstable,
    {
      'runs--chart-1@dark': 'the chart draws on its own clock (design system Chart)',
      'shell--top-1@dark': 'stale',
      'gone--x-1@dark': 'typo',
    },
    { ids, checked }
  );
  assert.deepEqual(v.problems, [
    'unstable runs--chart-1@light: 2 px differ',
    'unstable.json names no screen: gone--x-1@dark',
  ]);
  assert.deepEqual(v.notes, [
    'unstable runs--chart-1@dark (allowed: the chart draws on its own clock (design system Chart)): 1 px differ',
    'unstable.json lists shell--top-1@dark, which rendered the same twice',
  ]);
  // A listed screen this run did not render (--only) is not called stable.
  assert.deepEqual(
    repeatVerdict([], { 'shell--top-1@dark': 'x' }, { ids, checked: new Set() }).notes,
    []
  );
  assert.match(repeatMarkdown(empty, 3), /1 of 3 screens rendered the same/);
  assert.match(repeatMarkdown(empty, 3), /^- unstable runs--chart-1@dark: 1 px differ$/m);
});
