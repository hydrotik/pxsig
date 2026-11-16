/**
 * masks-edges.test.mjs — a mask covers every whole pixel its box touches (masks.mjs `snapRect`):
 * the left and top edges floored, the right and bottom ceiled, on the image's grid, clipped to the
 * frame. The record (mask-measure.mjs), the paint (mask-paint.mjs, both its own boxes and those
 * painted over everything) and the overflow check (mask-overflow.mjs) use the same pixels, so a
 * box with a fractional edge leaves no part-covered pixel compared. Before, the record rounded
 * the edges and the paint landed on the rounded pixels: a value's first digit could put ink in the
 * half pixel left unpainted, and the check passed or failed by which digit rendered.
 *
 *   node --test packages/pxsig/test/masks-edges.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { renderStories } from '../src/lib/capture.mjs';
import { CHROMIUM_ARGS } from '../src/lib/capture/browser.mjs';
import { masksFile, pixelGrid, snapRect, unionPx } from '../src/lib/capture/masks.mjs';
import { measureMasks } from '../src/lib/capture/mask-measure.mjs';
import { outside } from '../src/lib/capture/mask-overflow.mjs';
import { paintMasks, unmarkMasks, unpaintMasks } from '../src/lib/capture/mask-paint.mjs';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { standIn } from './text-helpers.mjs';
/** @import { Rect } from '../src/lib/capture/masks.mjs' */

const GRID = { x: 0, y: 0, width: 100, height: 50 };

test('a mask covers every whole pixel its box touches, on the image grid, inside the frame', () => {
  for (const f of [0, 0.25, 0.5, 0.75]) {
    const left = Math.floor(10 + f);
    const right = f ? 21 : 20;
    assert.deepEqual(snapRect([10 + f, 5 + f, 20 + f, 9 + f], GRID), [left, 5, right, f ? 10 : 9]);
  }
  // Whole edges are unchanged; the record grows only where an edge is fractional.
  assert.deepEqual(snapRect([60.5, 21, 87, 32], GRID), [60, 21, 87, 32]);
  assert.deepEqual(snapRect([60.3, 21.7, 86.7, 31.3], GRID), [60, 21, 87, 32]);
  // Clipped to the frame, and nothing outside it.
  assert.deepEqual(snapRect([-3.5, -0.25, 4.5, 2.5], GRID), [0, 0, 5, 3]);
  assert.deepEqual(snapRect([95.5, 48.5, 120, 70], GRID), [95, 48, 100, 50]);
  assert.deepEqual(snapRect([130, 60, 140, 70], GRID), [100, 50, 100, 50]);
  // A box with no width touches no pixel, even at a fractional position.
  assert.deepEqual(snapRect([40.5, 3, 40.5, 9], GRID), [40, 3, 40, 3]);
  assert.equal(unionPx([snapRect([40.5, 3, 40.5, 9], GRID)]), 0);
  // On the image's grid: an element screenshot starts at the whole pixel left of its box.
  const g = pixelGrid({ x: 8.5, y: 8.25, width: 50.5, height: 30.5 }, { width: 400, height: 300 });
  assert.deepEqual(g, { x: 8, y: 8, width: 51, height: 31 });
  assert.deepEqual(snapRect([20.5, 10.5, 30.25, 20], g), [12, 2, 23, 12]);
  assert.deepEqual(pixelGrid(null, { width: 400, height: 300 }), {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  // Counted in the document, as Playwright clips: a fractional scroll moves the grid with it.
  assert.deepEqual(
    pixelGrid({ x: 8, y: 8, width: 10, height: 10 }, { width: 400, height: 300 }, { x: 0.5, y: 0 }),
    { x: 7.5, y: 8, width: 11, height: 10 }
  );
});

test('the overflow check weighs no pixel the paint covers, at device scale 1 and 2', () => {
  /** @param {number} w @param {number} h @param {(x: number) => number} v */
  const img = (w, h, v) => {
    const p = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) p.data.set([v(i % w), 0, 0, 255], i * 4);
    return PNG.sync.write(p);
  };
  const box = /** @type {Rect} */ ([2.5, 0, 5.5, 4]);
  const painted = snapRect(box, { x: 0, y: 0, width: 10, height: 4 });
  assert.deepEqual(painted, [2, 0, 6, 4]);
  // Scale 1: columns 2..5 are painted, so a difference there is not outside; column 6 is.
  const a = img(10, 4, () => 0);
  assert.deepEqual(
    outside(
      a,
      img(10, 4, (x) => (x === 2 || x === 5 ? 200 : 0)),
      [painted],
      1
    ),
    {
      px: 0,
      past: 0,
    }
  );
  assert.deepEqual(
    outside(
      a,
      img(10, 4, (x) => (x === 6 ? 200 : 0)),
      [painted],
      1
    ),
    {
      px: 4,
      past: 1,
    }
  );
  // Scale 2: the painted CSS px times two, image columns 4..11; 3 and 12 are outside.
  const a2 = img(20, 8, () => 0);
  assert.deepEqual(
    outside(
      a2,
      img(20, 8, (x) => (x === 4 || x === 11 ? 200 : 0)),
      [painted],
      2
    ),
    {
      px: 0,
      past: 0,
    }
  );
  assert.deepEqual(
    outside(
      a2,
      img(20, 8, (x) => (x === 3 || x === 12 ? 200 : 0)),
      [painted],
      2
    ),
    {
      px: 16,
      past: 1,
    }
  );
});

/** Magenta, as the capture paints it (a channel within 8, the engine's tolerance). */
const magenta = (/** @type {PNG} */ p, /** @type {number} */ x, /** @type {number} */ y) => {
  const i = (y * p.width + x) * 4;
  return Math.abs(p.data[i] - 255) <= 8 && p.data[i + 1] <= 8 && Math.abs(p.data[i + 2] - 255) <= 8;
};

/**
 * Every pixel of `rects` (at `scale`) is magenta and no pixel outside them is.
 * @param {PNG} p
 * @param {Rect[]} rects CSS px
 * @param {number} scale
 * @param {string} what
 */
function paintedIsRecorded(p, rects, scale, what) {
  const inside = (/** @type {number} */ x, /** @type {number} */ y) =>
    rects.some(
      (r) => x >= r[0] * scale && x < r[2] * scale && y >= r[1] * scale && y < r[3] * scale
    );
  const missed = [];
  const extra = [];
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const m = magenta(p, x, y);
      if (inside(x, y) && !m) missed.push([x, y]);
      if (!inside(x, y) && m) extra.push([x, y]);
    }
  assert.ok(rects.length > 0, `${what}: a mask was recorded`);
  assert.deepEqual(missed.slice(0, 5), [], `${what}: every recorded pixel is painted`);
  assert.deepEqual(extra.slice(0, 5), [], `${what}: nothing is painted outside the record`);
}

/** A box at a half pixel, in its own place or painted over everything (a faded parent). */
const box = (/** @type {string} */ style) =>
  `<div style="position:relative;width:120px;height:40px;${style}"><span data-volatile="build time" style="position:absolute;left:10.5px;top:6.5px;width:37.5px;height:11.25px;color:#000;font:10px/1 monospace">8888</span></div>`;

/** @type {Record<string, string>} */
const paintStories = {
  'edges--self': box(''),
  'edges--over': box('opacity:0.9'),
  'edges--inline': `<p style="margin:0;font:13px/1.5 sans-serif">Built <span data-volatile="time">3 min</span> ago</p>`,
};

/**
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} stories
 * @param {string} [head] the stand-in page's head (a style that moves the story root)
 */
async function capture(t, stories, head = '') {
  const sb = await standIn(stories, head);
  const pw = await import('playwright');
  const browser = await pw.chromium.launch({ args: [...CHROMIUM_ARGS] });
  t.after(async () => {
    await browser.close();
    sb.close();
  });
  const dir = tempDir('masks-edges', t);
  const ids = Object.keys(stories);
  const { results } = await renderStories(
    browser,
    ids.map((id) => ({ id })),
    dir,
    { baseUrl: sb.url, viewport: [400, 200], settleMs: 0, project: {} }
  );
  for (const r of results) assert.ok(!r.error, String(r.error));
  return {
    /** @param {string} id */
    record: (id) => JSON.parse(readFileSync(masksFile(join(dir, `${id}.png`)), 'utf8')),
    /** @param {string} id */
    bytes: (id) => readFileSync(join(dir, `${id}.png`)),
    /** @param {string} id */
    png: (id) => PNG.sync.read(readFileSync(join(dir, `${id}.png`))),
  };
}

test(
  'what is painted is what is recorded, painted in place or over everything',
  { skip: needs },
  async (t) => {
    // The story root on whole pixels, then at a fractional place (the element screenshot then
    // starts at the whole pixel left of it).
    for (const head of ['', '<style>#storybook-root{margin:0.5px 0 0 0.25px}</style>']) {
      const c = await capture(t, paintStories, head);
      for (const id of Object.keys(paintStories)) {
        const rec = c.record(id);
        assert.deepEqual(rec.problems ?? [], [], `${id}: ${JSON.stringify(rec)}`);
        paintedIsRecorded(
          c.png(id),
          rec.masks.flatMap((/** @type {{ rects: Rect[] }} */ m) => m.rects),
          1,
          `${id}${head ? ' (root at a fractional place)' : ''}`
        );
      }
      // The half pixels count: 18.5..56 → 18..56 and 14.5..25.75 → 14..26 (the root's 8px in).
      if (!head)
        for (const id of ['edges--self', 'edges--over'])
          assert.deepEqual(c.record(id).masks[0].rects, [[18, 14, 56, 26]], id);
    }
  }
);

test('what is painted is what is recorded at device scale 2', { skip: needs }, async (t) => {
  const pw = await import('playwright');
  const browser = await pw.chromium.launch({ args: [...CHROMIUM_ARGS] });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 300, height: 120 },
    deviceScaleFactor: 2,
  });
  for (const style of ['', 'opacity:0.9']) {
    await page.setContent(
      `<body style="margin:0;background:#fff"><div id="root" style="display:inline-block;padding:8.5px">${box(style)}</div></body>`
    );
    const el = /** @type {import('playwright').ElementHandle} */ (await page.$('#root'));
    const frame = await el.boundingBox();
    const measured = await measureMasks(
      page,
      [{ selector: '[data-volatile]', source: 'attribute' }],
      frame,
      '#root'
    );
    const shot = await paintMasks(page, measured.grid);
    const buf = await el
      .screenshot({ animations: 'disabled', ...shot })
      .finally(() => unpaintMasks(page));
    await unmarkMasks(page);
    const p = PNG.sync.read(buf);
    assert.equal(p.width, measured.grid.width * 2, 'the image is the grid at scale 2');
    // 19..56.5 → 19..57 and 15..26.25 → 15..27 (the root's 8.5px in).
    assert.deepEqual(measured.applied[0].rects, [[19, 15, 57, 27]]);
    paintedIsRecorded(
      p,
      measured.applied[0].rects,
      2,
      `scale 2${style ? ', over everything' : ''}`
    );
  }
});

/**
 * The masks example's Badge (examples/single-package) with a value, `margin` px after its label.
 * At 4px the value's box starts on a whole pixel here; in pxsig's Linux image it starts at
 * x = 60.5. At 4.5px it starts on a half pixel everywhere, and the first digit is moved half a
 * pixel left (`shift`) so its ink reaches into the part-covered pixel, as the image's "4" does.
 * @param {number} digit
 * @param {number} margin
 * @param {number | null} shift
 */
const badge = (digit, margin, shift) =>
  `<span style="font:600 11px/1 ui-monospace, monospace;letter-spacing:1px;text-transform:uppercase;padding:4px 8px;border-radius:4px;color:#fff;background:#5b6170">Draft<span data-volatile="build time" style="display:inline-block;margin-left:${margin}px">${shift == null ? digit : `<b style="margin-left:${shift}px">${digit}</b>`}234</span></span>`;

test(
  "the Badge's value renders the same pixels whatever its first digit",
  { skip: needs },
  async (t) => {
    /** @type {Record<string, string>} */
    const stories = {};
    const variants = /** @type {const} */ ([
      ['example', 4, null],
      ['half', 4.5, -0.5],
    ]);
    for (const [name, margin, shift] of variants)
      for (let d = 0; d < 10; d++) stories[`badge-${name}--d${d}`] = badge(d, margin, shift);
    // Content past the touched pixels is still content outside its box (mask-overflow.mjs).
    stories['badge-past--d4'] = badge(4, 4.5, -2);
    const c = await capture(t, stories);
    for (const [name] of variants) {
      const ids = [...Array(10).keys()].map((d) => `badge-${name}--d${d}`);
      for (const id of ids) assert.deepEqual(c.record(id).problems ?? [], [], `${id}: no problem`);
      const first = c.bytes(ids[0]);
      const differ = ids.filter((id) => !c.bytes(id).equals(first));
      assert.deepEqual(differ, [], `${name}: byte-identical whatever the first digit`);
    }
    // Half a pixel past the box, inside the pixel it touches: masked, not a problem. Two pixels
    // past it: outside every painted pixel, so the entry fails as content outside its box.
    assert.equal(c.record('badge-past--d4').problems?.[0]?.kind, 'overflow');
  }
);

/**
 * An element that clips its own content, at fractional edges: its box is painted in place, so the
 * clip (snapped to the rounded edge) also clips the box, and a part-covered edge column is
 * recorded but not painted. Nothing of the element shows there: its content and its own
 * background share the clip. So renders with other values are byte-identical, and the column is
 * the page's whatever the element holds.
 * @param {string} value
 * @param {string} [bg] the element's own background
 */
const clipped = (value, bg = '') =>
  `<p style="margin:0">At <span data-volatile="time" style="display:inline-block;width:30.5px;overflow:hidden;white-space:nowrap;${bg}">${value}</span> now</p>`;

test(
  'a clipping element at fractional edges: other values render the same pixels',
  { skip: needs },
  async (t) => {
    const bg = 'background:#0a0';
    const c = await capture(t, {
      'clip--a': clipped('12:00:00'),
      'clip--b': clipped('88:88:88'),
      'clip--a-bg': clipped('12:00:00', bg),
      'clip--b-bg': clipped('88:88:88', bg),
    });
    const [rect] = c.record('clip--a').masks[0].rects;
    for (const id of ['clip--b', 'clip--a-bg', 'clip--b-bg']) {
      assert.deepEqual(c.record(id).masks[0].rects, [rect], id);
      assert.deepEqual(c.record(id).problems ?? [], [], id);
    }
    assert.ok(c.bytes('clip--a').equals(c.bytes('clip--b')), 'another value: the same bytes');
    assert.ok(c.bytes('clip--a-bg').equals(c.bytes('clip--b-bg')), 'with a background too');
    // The edge columns: painted, or the page's in every render (no value, no background of the
    // element's own); at least one of them is the part-covered one this case is about.
    const col = (/** @type {string} */ id, /** @type {number} */ x) => {
      const p = c.png(id);
      return Array.from({ length: rect[3] - rect[1] }, (_, k) => {
        const i = ((rect[1] + k) * p.width + x) * 4;
        return [...p.data.subarray(i, i + 3)].join(',');
      });
    };
    let unpainted = 0;
    for (const x of [rect[0], rect[2] - 1]) {
      const ref = col('clip--a', x);
      for (const id of ['clip--b', 'clip--a-bg', 'clip--b-bg'])
        assert.deepEqual(col(id, x), ref, `${id}: column ${x} carries nothing of the element`);
      if (ref.some((v) => v !== '255,0,255')) unpainted++;
    }
    assert.ok(unpainted > 0, 'a part-covered edge column is left unpainted (the clip)');
  }
);
