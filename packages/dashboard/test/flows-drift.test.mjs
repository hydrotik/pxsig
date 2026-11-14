/**
 * Drift in the dashboard, in a real browser against a mocked server (flows-helpers.mjs): entries
 * that pass while their render differs from the baseline are an Open Items row while there are
 * any, opening Review Stories with the "Passing, but differs from the baseline" filter, which lists
 * exactly them (lib/drift.mjs's rule: the row's `differs`, else SSIM below 1 on an older row).
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const label = 'Passing, but differs from the baseline';
const ids = {
  differs: 'ui-commit-badge--default',
  older: 'ui-activity-row--default',
  same: 'ui-button--primary',
  changed: 'ui-button--secondary',
};

test('drift: an open item while any entry drifts, and the filter lists exactly those', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({
    rows: [
      row(ids.differs, { differs: true, metrics: { ssim: 1, changedCells: 0, grid: 64 } }),
      // A row from an engine before 0.7.7: no `differs`, SSIM below 1.
      row(ids.older, { metrics: { ssim: 0.998, changedCells: 0, grid: 64 } }),
      row(ids.same, { differs: false, metrics: { ssim: 0.998, changedCells: 0, grid: 64 } }),
      row(ids.changed, {
        pass: false,
        changed: true,
        differs: null,
        metrics: { ssim: 0.9, changedCells: 12, grid: 64 },
        reasons: ['ssim 0.9 < min 0.99'],
      }),
    ],
    entries: Object.values(ids).map((id) =>
      entry(
        id,
        id === ids.changed ? [{ code: 'changed', severity: 'warn', reason: 'gate failed' }] : []
      )
    ),
  });
  const { page, errors } = await open(d, { hash: '#overview' });
  try {
    const item = page.getByText(label, { exact: true });
    await item.waitFor();
    await item.click();
    await page.getByRole('combobox', { name: 'Result' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-status]').length === 2);
    const cards = await page.locator('[data-status]').allTextContents();
    assert.equal(cards.length, 2);
    assert.ok(
      cards.some((c) => c.includes(ids.differs)) && cards.some((c) => c.includes(ids.older)),
      cards.join(' | ')
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
  // Nothing drifts: Open items has no such row.
  const clean = data({ rows: [row(ids.same, { differs: false })], entries: [entry(ids.same)] });
  const { page: p2 } = await open(clean, { hash: '#overview' });
  try {
    await p2.getByText('Open Items').first().waitFor();
    assert.equal(await p2.getByText(label).count(), 0);
  } finally {
    await p2.close();
  }
});
