/**
 * The side panel's two layouts (contract 1.3.0, the fallback the plain build draws) in a real
 * browser, against a mocked server (flows-helpers.mjs): beside the records while both fit, and
 * overlaid on them from the right when the container is too narrow, the records keeping their
 * width. (Help kept in the top bar is the reference adapter's overflow: the live screens show it.)
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenarioData } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

/** @param {import('playwright').Locator} l */
const box = async (l) => /** @type {{ x: number, width: number }} */ (await l.boundingBox());

for (const [width, overlaid] of /** @type {const} */ ([
  [1280, false],
  [900, true],
])) {
  test(`Compiler at ${width}px: the side panel is ${overlaid ? 'overlaid on' : 'beside'} the records`, async (t) => {
    if (skip) return t.skip(skip);
    const { page, errors } = await open(scenarioData('react'), { hash: '#react' });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'All analysed (9)' }).click();
      const table = page.locator('table').first();
      const before = await box(table);
      await page.getByText('Button', { exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'Button' });
      await panel.waitFor();
      const after = await box(table);
      const p = await box(panel);
      if (overlaid) {
        assert.equal(after.width, before.width, 'the records keep their width');
        assert.ok(p.x < after.x + after.width, 'the panel lies over the records');
        assert.equal(await panel.evaluate((e) => getComputedStyle(e).position), 'absolute');
      } else {
        assert.ok(after.width < before.width, 'the records make room');
        assert.ok(p.x >= after.x + after.width, 'the panel is beside the records');
      }
      // Escape closes it either way, and the records are as before.
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      assert.equal((await box(table)).width, before.width);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}
