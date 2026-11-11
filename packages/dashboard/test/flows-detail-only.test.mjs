/**
 * A detail-only change in the inspector, in a real browser against a mocked server
 * (flows-helpers.mjs): the detail channel failed the entry and no pixel differs by more than the
 * tolerance, so the inspector shows the detail tiles, steps through them as the changes and says
 * why. A lower tolerance, or a signature-gate failure, keeps the pixel analysis.
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

const { PNG } = createRequire(new URL('../../pxsig/package.json', import.meta.url))('pngjs');

setupFlows();

const story = 'ui-card--subtle';
const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
// 320×200: 20 columns of 16 px tiles. The render lightens x 64–127, y 64–95 by 12 per channel,
// under the default tolerance of 16: tiles 4–7 of rows 4 and 5.
const tripped = [84, 85, 86, 87, 104, 105, 106, 107];
const W = 320;
const H = 200;
const png = (/** @type {number} */ lift) => {
  const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = 200 + (x >= 64 && x < 128 && y >= 64 && y < 96 ? lift : 0);
      p.data.set([v, v, v, 255], i);
    }
  return PNG.sync.write(p);
};
const images = { baseline: png(0), render: png(12), diff: png(0) };
const failed = { pass: false, changed: true, metrics: { ssim: 0.999, changedCells: 0, grid: 64 } };
const detailRow = row(story, {
  ...failed,
  reasons: ['detail 8 tiles changed (8 kept, 0 new edges) >= 3'],
  detail: { changedTiles: 8, newEdgeTiles: 0, maxBlockDelta: 12, tripped },
});

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};
/** The change stepper's text. @param {import('playwright').Page} page */
const stepper = (page) =>
  page
    .getByText(/^(Change .+ \/ \d+|No changes)$/)
    .first()
    .textContent();
/** Detail tiles drawn over the stage. @param {import('playwright').Page} page */
const drawn = (page) => page.locator('[data-tile]').count();
// The saved view settings with the Detail tiles switch off: a detail-only change shows them anyway.
const tilesOff = () => localStorage.setItem('pxsig-inspector', JSON.stringify({ tiles: false }));

test('a detail-only change opens on its tiles, steps through them and says why', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [detailRow], entries: [entry(story, issue)] });
  const { page, errors } = await open(d, {
    hash: `#inspect=${story}`,
    images: () => images,
    init: tilesOff,
  });
  try {
    await ready(page);
    const side = page.locator('aside');
    assert.equal(await stepper(page), 'Change 1 / 8');
    assert.ok(
      await side.getByText('8 detail tiles changed below the pixel tolerance of 16.').isVisible()
    );
    assert.equal(await side.getByText(/No pixel differs/).count(), 0);
    assert.equal(await side.getByText('Detail tile', { exact: true }).count(), 8);
    assert.ok((await drawn(page)) >= 8, 'the tiles are drawn');
    await page.keyboard.press('n');
    assert.equal(await stepper(page), 'Change 2 / 8');
    // The Detail tiles switch works for this entry; the saved setting stays off.
    await page.getByRole('switch', { name: 'Show detail tiles over the limit' }).click();
    assert.equal(await drawn(page), 0);
    const saved = await page.evaluate(() => localStorage.getItem('pxsig-inspector'));
    assert.equal(JSON.parse(saved ?? '{}').tiles, false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('under a tolerance the change exceeds, the pixel regions are the changes again', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [detailRow], entries: [entry(story, issue)] });
  const { page } = await open(d, {
    hash: `#inspect=${story}`,
    images: () => images,
    init: tilesOff,
  });
  try {
    await ready(page);
    await page.getByRole('slider', { name: 'Tolerance' }).focus();
    await page.keyboard.press('Home');
    const side = page.locator('aside');
    await side.getByText(/detail tiles changed/).waitFor({ state: 'detached' });
    assert.match(await stepper(page), /^Change .+ \/ 1$/);
    assert.equal(await drawn(page), 0, 'the saved setting: tiles off');
  } finally {
    await page.close();
  }
});

test('a signature-gate failure with the same images keeps the pixel analysis', async (t) => {
  if (skip) return t.skip(skip);
  const gate = row(story, {
    ...failed,
    reasons: ['changedCells 4 >= 3 (off by > 24)', ...detailRow.reasons],
    detail: detailRow.detail,
  });
  const d = data({ rows: [gate], entries: [entry(story, issue)] });
  const { page } = await open(d, { hash: `#inspect=${story}`, images: () => images });
  try {
    await ready(page);
    assert.equal(await stepper(page), 'No changes');
    assert.ok(
      await page.locator('aside').getByText('No pixel differs by more than 16.').isVisible()
    );
  } finally {
    await page.close();
  }
});
