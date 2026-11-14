/**
 * masks-overflow.test.mjs — a `data-volatile` element whose content paints outside its box is a
 * problem (`overflow`, lib/capture/mask-overflow.mjs), in a real Chromium on a stand-in Storybook:
 * the case from the 0.7.7 masks flake (letter-spacing past a fixed width), a transformed child and
 * a text shadow are found; content that fits, a `line-height: 1` box, and content clipped by the
 * box are not; a selector mask is never weighed; the mask's box never changes.
 *
 *   node --test packages/pxsig/test/masks-overflow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { renderStories } from '../src/lib/capture.mjs';
import { masksFile } from '../src/lib/capture/masks.mjs';
import { outside } from '../src/lib/capture/mask-overflow.mjs';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { standIn } from './text-helpers.mjs';

/** The example's Badge (examples/single-package), with a value in it. */
const badge = (/** @type {string} */ style, value = '1234') =>
  `<span style="font:600 11px/1 monospace;letter-spacing:1px;text-transform:uppercase;padding:4px 8px;border-radius:4px;color:#fff;background:#5b6170">Neutral<span data-volatile="build time" style="display:inline-block;margin-left:4px;${style}">${value}</span></span>`;

/** @type {Record<string, string>} */
const stories = {
  // The flake: four digits, each 1ch plus the letter-spacing, in a box 4ch wide.
  'overflow--fixed-width': badge('width:4ch'),
  // The same box, its text without the letter-spacing: it fits, and the box is the same.
  'overflow--same-box': badge('width:4ch;letter-spacing:0'),
  // The fix: the box holds its text (line-height 1: the font's content area is taller than the box).
  'overflow--fits': badge(''),
  // Wider text clipped by its own box: nothing paints outside.
  'overflow--clipped': badge('width:3ch;overflow:hidden', '123456'),
  // A child moved out of the box (text after it keeps it inside the capture).
  'overflow--transformed': `<p>Build <span data-volatile="build" style="display:inline-block;width:40px"><b style="display:inline-block;transform:translateX(30px)">42</b></span> since the last run of the suite</p>`,
  // A shadow past the box.
  'overflow--shadow': `<p>At <span data-volatile="time" style="display:inline-block;text-shadow:12px 0 0 #000">noon</span> in the place</p>`,
  // A selector mask whose content overflows: not weighed (selector masks may be containers).
  'overflow--selector': `<p>At <span class="clock" style="display:inline-block;width:2ch;letter-spacing:4px">12:00</span></p>`,
};

/** @param {import('node:test').TestContext} t */
async function capture(t) {
  const sb = await standIn(stories);
  const pw = await import('playwright');
  const browser = await pw.chromium.launch();
  t.after(async () => {
    await browser.close();
    sb.close();
  });
  const dir = tempDir('masks-overflow', t);
  const ids = Object.keys(stories);
  const { results } = await renderStories(
    browser,
    ids.map((id) => (id === 'overflow--selector' ? { id, ignore: ['.clock'] } : { id })),
    dir,
    { baseUrl: sb.url, viewport: [400, 200], settleMs: 0, project: /** @type {never} */ ({}) }
  );
  for (const r of results) assert.ok(!r.error, String(r.error));
  return {
    /** @param {string} id */
    record: (id) => JSON.parse(readFileSync(masksFile(join(dir, `${id}.png`)), 'utf8')),
    /** @param {string} id */
    png: (id) => PNG.sync.read(readFileSync(join(dir, `${id}.png`))),
  };
}

test(
  'content outside a data-volatile box is a problem; content inside it is not',
  { skip: needs },
  async (t) => {
    const c = await capture(t);
    const problems = (/** @type {string} */ id) => c.record(id).problems ?? [];
    const [flake] = problems('overflow--fixed-width');
    assert.equal(flake?.kind, 'overflow', JSON.stringify(c.record('overflow--fixed-width')));
    assert.match(
      flake.element,
      /^span\[data-volatile="build time"\]: \d+ px outside, up to [1-9]\d* px past its box$/
    );
    for (const id of ['overflow--transformed', 'overflow--shadow'])
      assert.deepEqual(
        problems(id).map((/** @type {{ kind: string }} */ p) => p.kind),
        ['overflow'],
        id
      );
    for (const id of ['overflow--same-box', 'overflow--fits', 'overflow--clipped'])
      assert.deepEqual(problems(id), [], id);
    assert.deepEqual(problems('overflow--selector'), [], 'a selector mask is not weighed');
    assert.equal(c.record('overflow--selector').masks[0].selector, '.clock');
  }
);

test(
  'the mask stays the element box: never widened to the overflow',
  { skip: needs },
  async (t) => {
    const c = await capture(t);
    const leak = c.record('overflow--fixed-width').masks[0];
    const same = c.record('overflow--same-box').masks[0];
    assert.deepEqual(leak.rects, same.rects, 'the same box, overflowing or not');
    assert.equal(leak.px, same.px);
    // The pixels just past the box are the leaking digit, not the mask colour.
    const png = c.png('overflow--fixed-width');
    const [, y0, x1, y1] = leak.rects[0];
    const y = Math.floor((y0 + y1) / 2);
    const at = (/** @type {number} */ x) => [
      ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
    ];
    assert.deepEqual(at(x1 - 1), [255, 0, 255], 'inside: painted');
    assert.notDeepEqual(at(x1 + 1), [255, 0, 255], 'outside: not painted');
  }
);

test('only pixels outside every box, past the tolerance, count', () => {
  const img = (/** @type {(x: number, y: number) => number} */ v) => {
    const p = new PNG({ width: 10, height: 4 });
    for (let i = 0; i < 40; i++) {
      p.data.set([v(i % 10, Math.floor(i / 10)), 0, 0, 255], i * 4);
    }
    return PNG.sync.write(p);
  };
  const a = img(() => 0);
  // Inside the box (x 2..5.5: pixel 5 is touched, so inside) and a faint difference: nothing.
  assert.deepEqual(
    outside(
      a,
      img((x) => (x >= 2 && x <= 5 ? 200 : 8)),
      [[2, 0, 5.5, 4]],
      1
    ),
    {
      px: 0,
      past: 0,
    }
  );
  // Two columns past the box: 8 pixels, the farthest 2 px past it.
  assert.deepEqual(
    outside(
      a,
      img((x) => (x === 6 || x === 7 ? 200 : 0)),
      [[2, 0, 5.5, 4]],
      1
    ),
    {
      px: 8,
      past: 2,
    }
  );
  // At device scale 2, the same distance in CSS px.
  assert.deepEqual(
    outside(
      a,
      img((x) => (x === 5 ? 200 : 0)),
      [[1, 0, 2.5, 2]],
      2
    ),
    {
      px: 4,
      past: 1,
    }
  );
});
