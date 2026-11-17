/**
 * text-pins.test.mjs — what text capture must leave as it was (text-aware diffs, PR 2). With text
 * off, a render writes its PNG and no text record beside it, the same bytes every time; a check row is
 * built from the engine's verdict and the render's error, timing, axe and render counts only, so
 * anything else a render result carries never reaches check.json; and an entry carries no `text`
 * key unless its story turns text off.
 *
 *   node --test packages/pxsig/test/text-pins.test.mjs
 *
 * The render pins need Chromium; the others run anywhere.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { expandEntries } from '../src/lib/manifest.mjs';
import { buildRow } from '../src/lib/rows.mjs';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { renderOn, standIn } from './text-helpers.mjs';
/** @import { RenderResult, StoryParameters } from '../src/types.js' */

const STORY = '<p>1 <b>new</b> · of 9 analysed</p><div style="border:1px solid #888">Card</div>';

test(
  'text off: a render writes its PNG and no text record beside it, byte for byte the same each time',
  { skip: needs },
  async (t) => {
    const pw = await import('playwright');
    // In the test font: the same bytes must not hang on which font the OS gives `sans-serif`.
    const sb = await standIn({ 'pins--text': STORY }, '', { font: true });
    const browser = await pw.chromium.launch();
    t.after(async () => {
      await browser.close();
      sb.close();
    });
    const a = tempDir('pins-a', t);
    const b = tempDir('pins-b', t);
    const entries = [{ id: 'pins--text' }];
    const [ra] = await renderOn(browser, sb.url, entries, a, { text: false });
    const [rb] = await renderOn(browser, sb.url, entries, b, { text: false });
    assert.equal(ra.error, undefined, ra.error);
    // Nothing of text capture: the PNG, and the fonts it was drawn in (every Chromium render).
    assert.deepEqual(readdirSync(a).sort(), ['pins--text.fonts.json', 'pins--text.png']);
    assert.deepEqual(readdirSync(b).sort(), ['pins--text.fonts.json', 'pins--text.png']);
    assert.ok(
      readFileSync(join(a, 'pins--text.png')).equals(readFileSync(join(b, 'pins--text.png'))),
      'the same render twice'
    );
    assert.equal(rb.error, undefined, rb.error);
  }
);

test('a check row never carries what else a render result holds', () => {
  const e = { id: 'a--b', story: 'a--b', mode: 'dark' };
  const rust = { id: 'a--b', pass: true, reasons: [], metrics: { ssim: 1 }, color: null };
  /** @type {RenderResult} */
  const render = { id: 'a--b', png: 'x.png', ms: 12, a11y: null };
  const strip = (/** @type {Record<string, unknown>} */ r) => ({ ...r, checkedAt: null });
  const plain = strip(buildRow(e, rust, render, null, { defaultMode: 'dark' }));
  const more = strip(
    buildRow(
      e,
      rust,
      /** @type {RenderResult} */ (
        /** @type {unknown} */ ({
          ...render,
          text: { runs: 3, elements: 1, ms: 2 },
          boxes: 'x.boxes.json',
        })
      ),
      null,
      { defaultMode: 'dark' }
    )
  );
  assert.deepEqual(more, plain);
});

test('an entry has no text key unless its story turns text off', () => {
  const stories = [{ id: 'a-b--c', importPath: 'src/a.stories.tsx', sigFor: () => 'x.psig' }];
  const params = /** @type {Record<string, StoryParameters>} */ ({
    'a-b--c': { pxsig: { states: [{ name: 'hover', action: 'hover' }] }, tags: [] },
  });
  const { entries } = expandEntries({}, stories, params);
  assert.equal(entries.length, 2);
  for (const e of entries) assert.equal(Object.hasOwn(e, 'text'), false, e.id);
});
