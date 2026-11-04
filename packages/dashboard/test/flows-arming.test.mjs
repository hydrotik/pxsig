/**
 * A decision in flight and the entry after it, in a real browser against a mocked server (see
 * flows-helpers.mjs): while the server answers an approval the button reads "Approving…" in a busy
 * box, nothing more can be sent, and on the next entry Reject, Approve, A and R wait until its
 * images are drawn. Nothing here can write a baseline: every /__pxsig/ request is answered by
 * page.route. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleImages } from '../../pxsig/src/dashboard-check/server.mjs';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const first = 'ui-button--primary';
const second = 'ui-card--default';
const d = data({
  rows: [
    row(first, changed),
    row(second, { ...changed, metrics: { ...changed.metrics, ssim: 0.9 } }),
  ],
  entries: [first, second].map((id) =>
    entry(id, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])
  ),
});

test('an approval in flight says so and sends once; the next entry waits for its images', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open(d, { hash: `#inspect=${first}`, images: true });
  try {
    const dialog = page.getByRole('dialog');
    const button = (/** @type {string} */ name, disabled = false) =>
      dialog.getByRole('button', { name, exact: true, disabled });
    let decisions = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/__pxsig\/(approve|reject)/.test(r.url())) decisions++;
    });
    // The approval answers when the test says so; the second entry's images likewise.
    /** @type {() => void} */
    let answer = () => {};
    await page.route('**/__pxsig/approve', async (route) => {
      await new Promise((/** @type {(v?: unknown) => void} */ ok) => (answer = ok));
      await route.fulfill({ json: { ok: true } });
    });
    /** @type {() => void} */
    let draw = () => {};
    const drawn = new Promise((/** @type {(v?: unknown) => void} */ ok) => (draw = ok));
    const png = sampleImages();
    await page.route('**/p/demo/**', async (route) => {
      const u = new URL(route.request().url()).pathname;
      if (!u.includes(second) || !u.endsWith('.png')) return route.fallback();
      await drawn;
      const body = u.includes('/diffs/')
        ? png.diff
        : u.includes('/base')
          ? png.baseline
          : png.render;
      await route.fulfill({ status: 200, contentType: 'image/png', body });
    });

    await button('Approve').waitFor();
    await button('Approve').click();
    // In flight: named for what it does, in a busy box with the progress cursor, and disabled.
    const approving = button('Approving…', true);
    await approving.waitFor();
    assert.equal(await button('Reject', true).count(), 1, 'Reject is disabled too');
    const box = dialog.locator('[aria-busy="true"]').getByRole('button', { name: 'Approving…' });
    assert.equal(await box.count(), 1, 'the box is aria-busy');
    assert.equal(await approving.evaluate((b) => getComputedStyle(b).cursor), 'progress');
    await page.keyboard.press('a');
    await page.keyboard.press('r');
    assert.equal(decisions, 1, 'one decision sent');

    answer();
    // The next entry, its images not drawn yet: Reject, Approve, A and R wait.
    await dialog.getByText(second).first().waitFor();
    await button('Approve', true).waitFor();
    assert.equal(await button('Reject', true).count(), 1);
    await page.keyboard.press('a');
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    assert.equal(decisions, 1, 'nothing sent before the entry is drawn');

    draw();
    await button('Approve').waitFor();
    await button('Reject').waitFor();
    assert.equal(decisions, 1);
  } finally {
    await page.close();
  }
});
