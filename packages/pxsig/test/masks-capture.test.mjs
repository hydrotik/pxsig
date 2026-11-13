/**
 * masks-capture.test.mjs — what a capture may mask, and how it paints it (lib/capture/masks.mjs,
 * lib/capture/mask-paint.mjs), in a real Chromium on a stand-in Storybook: only the masked element
 * is painted, never what sits above it (mask audit 8); `data-volatile` on a container or with no
 * reason is a problem, never painted (owner decision 3); a mask on the story root is recorded as
 * one (audit 4); text is left out of the text record only where a mask is painted (audit 14); a
 * mask on more elements than are measured, or on elements that appear after measuring, is a
 * problem (audit 15).
 *
 *   node --test packages/pxsig/test/masks-capture.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { renderStories } from '../src/lib/capture.mjs';
import { masksFile } from '../src/lib/capture/masks.mjs';
import { INLINE, lateMasks } from '../src/lib/capture/mask-measure.mjs';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { standIn } from './text-helpers.mjs';
/** @import { RenderEntry } from '../src/types/t4.js' */

const MAGENTA = [255, 0, 255];

/** @type {Record<string, string>} */
const stories = {
  // A volatile time under an open popover (z-index 10) that covers its right half.
  'popover--open': `<div style="position:relative;width:200px;height:40px">
      <span data-volatile="relative time" style="display:inline-block;width:100px;height:20px">3 min</span>
      <div style="position:absolute;left:50px;top:0;width:100px;height:30px;background:rgb(0,0,255);z-index:10"></div>
    </div>`,
  // The same time inside a faded parent: painted over everything, as before, never less.
  'popover--faded': `<div style="position:relative;width:200px;height:40px;opacity:0.9">
      <span data-volatile="relative time" style="display:inline-block;width:100px;height:20px">3 min</span>
    </div>`,
  // Two divs, a p inside inline formatting, an svg with a circle of its own (try-store finding:
  // the circle was listed, and each div once per div).
  'volatile--container': `<div data-volatile="card" class="card" style="width:120px"><div>Total</div><div>Tax</div><b><p>Net</p></b><svg width="10" height="10"><circle cx="5" cy="5" r="4"></circle></svg></div>`,
  'volatile--no-reason': `<p>At <span data-volatile style="display:inline-block;width:40px">noon</span></p>`,
  'volatile--empty-reason': `<p>At <span data-volatile=" " style="display:inline-block;width:40px">noon</span></p>`,
  'volatile--leaf': `<p>Updated <span data-volatile="relative time" style="display:inline-block;width:90px"><b>3</b> <em>min</em> ago</span></p>`,
  'root--whole': `<div class="card" style="width:120px;height:40px">Card</div>`,
  'root--part': `<div class="card" style="width:120px;height:40px">Card</div><p class="clock">12:00</p>`,
  'text--unpainted': `<p class="kept">shown text</p><p class="gone">painted text</p><p class="far" style="position:absolute;left:-999px">off the frame</p>`,
  'many--dots': Array.from(
    { length: 501 },
    () => '<i class="dot" style="display:inline-block;width:2px;height:2px"></i>'
  ).join(''),
};

/**
 * @param {import('node:test').TestContext} t
 * @param {RenderEntry[]} entries
 */
async function capture(t, entries) {
  const sb = await standIn(stories);
  const pw = await import('playwright');
  const browser = await pw.chromium.launch();
  t.after(async () => {
    await browser.close();
    sb.close();
  });
  const dir = tempDir('masks-capture', t);
  const { results } = await renderStories(browser, entries, dir, {
    baseUrl: sb.url,
    viewport: [400, 300],
    settleMs: 0,
    project: /** @type {never} */ ({ config: { text: true } }),
  });
  for (const r of results) assert.ok(!r.error, String(r.error));
  return {
    /** @param {string} id */
    record: (id) => JSON.parse(readFileSync(masksFile(join(dir, `${id}.png`)), 'utf8')),
    /** @param {string} id */
    text: (id) =>
      JSON.parse(readFileSync(join(dir, `${id}.boxes.json`), 'utf8'))
        .runs.map((/** @type {{ s: string }} */ r) => r.s)
        .join(' '),
    /** @param {string} id @param {number} x @param {number} y */
    pixel: (id, x, y) => {
      const png = PNG.sync.read(readFileSync(join(dir, `${id}.png`)));
      const i = (y * png.width + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    },
  };
}

test(
  'only the masked element is painted: a popover above it is still captured',
  { skip: needs },
  async (t) => {
    // Mask audit 8: Playwright's mask painted over the popover too.
    const c = await capture(t, [{ id: 'popover--open' }, { id: 'popover--faded' }]);
    const [m] = c.record('popover--open').masks;
    const [x0, y0] = m.rects[0];
    assert.deepEqual(c.pixel('popover--open', x0 + 10, y0 + 10), MAGENTA, 'the time is masked');
    assert.deepEqual(c.pixel('popover--open', x0 + 70, y0 + 10), [0, 0, 255], 'the popover is not');
    // Where the box cannot be exact (a faded parent), it is painted as before: all of the element.
    const [f] = c.record('popover--faded').masks;
    for (const [x, y] of [
      [f.rects[0][0] + 2, f.rects[0][1] + 2],
      [f.rects[0][2] - 3, f.rects[0][3] - 3],
    ])
      assert.deepEqual(c.pixel('popover--faded', x, y), MAGENTA);
  }
);

test(
  'data-volatile marks a leaf with a reason: a container or no reason is a problem, never painted',
  { skip: needs },
  async (t) => {
    // Owner decision 3.
    const ids = [
      'volatile--container',
      'volatile--no-reason',
      'volatile--empty-reason',
      'volatile--leaf',
    ];
    const c = await capture(
      t,
      ids.map((id) => ({ id }))
    );
    const box = c.record('volatile--container');
    assert.deepEqual(box.masks, []);
    assert.deepEqual(box.problems, [
      {
        kind: 'container',
        element: 'div.card[data-volatile="card"]: elements inside: div, p, svg',
      },
    ]);
    assert.ok(c.text('volatile--container').includes('Total'), 'not masked: its text is recorded');
    assert.deepEqual(c.record('volatile--no-reason').problems, [
      { kind: 'reason', element: 'span[data-volatile]' },
    ]);
    assert.deepEqual(c.record('volatile--empty-reason').problems, [
      { kind: 'reason', element: 'span[data-volatile=" "]' },
    ]);
    const leaf = c.record('volatile--leaf');
    assert.equal(leaf.problems, undefined);
    assert.equal(leaf.masks[0].reason, 'relative time');
    assert.ok(!c.text('volatile--leaf').includes('min'), 'the leaf is masked');
    assert.ok(INLINE.includes('b') && INLINE.includes('em') && !INLINE.includes('div'));
  }
);

test(
  'a mask on the story root is recorded as one; a mask on part of it is not',
  { skip: needs },
  async (t) => {
    // Mask audit 4: `#storybook-root > *` on a story of one element masks all of it.
    const c = await capture(t, [
      { id: 'root--whole', ignore: ['#storybook-root > *'] },
      { id: 'root--part', ignore: ['.clock'] },
    ]);
    assert.equal(c.record('root--whole').masks[0].root, true);
    assert.equal(c.record('root--part').masks[0].root, undefined);
  }
);

test('text is left out only where a mask is painted', { skip: needs }, async (t) => {
  // Mask audit 14: text under any mask selector was dropped, painted or not. Now only the painted
  // elements' (a data-volatile container, never painted, keeps its text: the test above).
  const c = await capture(t, [{ id: 'text--unpainted', ignore: ['.gone', '.far'] }]);
  const text = c.text('text--unpainted');
  assert.ok(text.includes('shown text') && !text.includes('painted text'), text);
  assert.deepEqual(
    c.record('text--unpainted').masks.map((/** @type {{ selector: string }} */ m) => m.selector),
    ['.gone'],
    'a mask with nothing in the frame does not apply'
  );
});

test('a mask on more elements than are measured is a problem', { skip: needs }, async (t) => {
  // Mask audit 15: beyond 500 boxes the area understated what was painted.
  const c = await capture(t, [{ id: 'many--dots', ignore: ['.dot'] }]);
  assert.deepEqual(c.record('many--dots').problems, [
    { kind: 'unmeasured', element: '.dot: 501 elements, over 500' },
  ]);
});

test('elements a mask matches only at the screenshot are a problem', async () => {
  // Mask audit 15: an element that appeared after measuring was masked without being measured.
  const page = /** @type {never} */ ({
    locator: () => ({ evaluateAll: async () => 3 }),
  });
  const measured = {
    applied: [],
    problems: /** @type {import('../src/lib/capture/masks.mjs').MaskProblem[]} */ ([]),
    masks: [{ selector: '.late', source: /** @type {const} */ ('story') }],
    counts: [2],
  };
  await lateMasks(page, measured);
  assert.deepEqual(measured.problems, [
    { kind: 'unmeasured', element: '.late: 3 matched at the screenshot, 2 measured' },
  ]);
  measured.problems = [];
  measured.counts = [3];
  await lateMasks(page, measured);
  assert.deepEqual(measured.problems, []);
});
