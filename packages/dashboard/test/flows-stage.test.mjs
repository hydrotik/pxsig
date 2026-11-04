/**
 * The inspector's stage in a real browser, against a mocked server (see flows-helpers.mjs): moving
 * to an entry whose images have another size lands fitted for the new size, as pressing Fit would.
 * Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleImages } from '../../pxsig/src/dashboard-check/server.mjs';
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const wide = 'ui-card--wide';
const small = 'ui-card--small';
const d = data({ rows: [row(wide), row(small)], entries: [entry(wide), entry(small)] });
const SIZES = { [wide]: sampleImages(960, 300), [small]: sampleImages(240, 160) };

/** @param {import('playwright').Page} page */
const settled = (page) =>
  page.waitForFunction(
    () => document.querySelector('[data-mode]') && !document.querySelector('[aria-busy="true"]')
  );
/** Where the stage draws the image: the viewer's pan and zoom. @param {import('playwright').Page} page */
const view = (page) =>
  page.evaluate(() => {
    const el = /** @type {HTMLElement} */ (document.querySelector('[data-mode]'));
    const v = (/** @type {string} */ k) => el.style.getPropertyValue(k);
    return { tx: v('--dv-tx'), ty: v('--dv-ty'), zoom: v('--dv-zoom') };
  });

test('the next entry opens fitted for its own image size', async (t) => {
  if (skip) return t.skip(skip);
  // Each entry's images at its own size, slow, so the next entry's arrive well after the move.
  const images = async (/** @type {string} */ u) => {
    const id = Object.keys(SIZES).find((k) => u.includes(`/${k}.`));
    await new Promise((ok) => setTimeout(ok, 300));
    return id ? SIZES[id] : null;
  };
  const { page, errors } = await open(d, { hash: `#inspect=${wide}`, images });
  try {
    await page.getByRole('heading', { name: wide, exact: true }).waitFor();
    await settled(page);
    for (const id of [small, wide]) {
      await page.keyboard.press('ArrowRight');
      await page.getByRole('heading', { name: id, exact: true }).waitFor();
      await settled(page);
      const landed = await view(page);
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      assert.deepEqual(landed, await view(page), `${id}: as Fit places it`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
