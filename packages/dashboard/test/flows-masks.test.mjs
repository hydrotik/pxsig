/**
 * Masks in the dashboard, in a real browser against a mocked server (flows-helpers.mjs): the Masks
 * section, a masks-only change (the masks failed the entry and the pixels are the same: never an
 * empty "No changes" view), the header and card badges, and the large masks in Open items and the
 * Review Stories filter. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
// scenarios.mjs first: it imports masks.mjs, whose helpers import it back.
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { masksChangedRow } from '../fixtures/masks.mjs';
import { sampleImages } from '../../pxsig/src/dashboard-check/server.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const story = 'ui-activity-row--default';
const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const reason = 'masks changed: 1 added, 1 removed, 1 grew';
// The same image as baseline and render: the masks alone changed.
const same = () => {
  const img = sampleImages();
  return { baseline: img.baseline, render: img.baseline, diff: img.baseline };
};
const masksOnly = row(story, {
  pass: false,
  changed: true,
  metrics: { ssim: 1, changedCells: 0, grid: 64, identical: true },
  reasons: [reason],
  ...masksChangedRow(),
});

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};
/** Each mask line's text, in order. @param {import('playwright').Page} page */
const lines = (page) =>
  page.getByRole('list', { name: 'Masks' }).getByRole('listitem').allTextContents();

test('a masks-only change shows the masks before and after, never "No changes"', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [masksOnly], entries: [entry(story, issue)] });
  const { page, errors } = await open(d, { hash: `#inspect=${story}`, images: same });
  try {
    await ready(page);
    const side = page.locator('aside');
    assert.equal(await page.getByText('No changes', { exact: true }).count(), 0);
    assert.ok(await page.getByText('Masks changed', { exact: true }).first().isVisible());
    assert.ok(
      await side
        .getByText('No pixel differs by more than 16. Only the masks changed.', { exact: true })
        .isVisible()
    );
    // The Masks section comes first, before Pixel Changes.
    const headings = await side.getByRole('heading', { level: 3 }).allTextContents();
    assert.ok(headings.indexOf('Masks') < headings.indexOf('Pixel Changes'), headings.join(', '));
    assert.ok(await side.getByText('3 masks changed since the baseline.').isVisible());
    assert.deepEqual(await lines(page), [
      'AddedOver 25%[data-volatile="relative time"]data-volatile · relative time · Baseline none · render 31%',
      'Grew.build-idProject · Baseline 1.3% · render 2.5%',
      'Removed.clockWorkspace · Baseline 4.0% · render none',
    ]);
    // The header's badge, beside the verdict (the side panel says Over 25%).
    assert.ok(await page.getByText('Large mask', { exact: true }).isVisible());
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('masks that did not change are listed with their share, after Pixel Changes', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-commit-badge--default';
  const passing = row(id, {
    masks: [{ selector: '[data-volatile]', source: 'attribute', area: 0.08 }],
  });
  const d = data({ rows: [passing], entries: [entry(id)] });
  const { page } = await open(d, { hash: `#inspect=${id}`, images: same });
  try {
    await ready(page);
    assert.deepEqual(await lines(page), ['[data-volatile]data-volatile · 8.0% of the capture']);
    const headings = await page
      .locator('aside')
      .getByRole('heading', { level: 3 })
      .allTextContents();
    assert.ok(headings.indexOf('Masks') > headings.indexOf('Pixel Changes'), headings.join(', '));
    assert.equal(await page.getByText('Masks changed', { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
});

test('with changed pixels too, the pixel analysis stays and the masks follow it', async (t) => {
  if (skip) return t.skip(skip);
  const both = row(story, {
    ...masksOnly,
    metrics: { ssim: 0.8, changedCells: 12, grid: 64 },
    reasons: ['ssim 0.8 < min 0.99', reason],
  });
  const d = data({ rows: [both], entries: [entry(story, issue)] });
  const { page } = await open(d, { hash: `#inspect=${story}`, images: () => sampleImages() });
  try {
    await ready(page);
    assert.match(
      (await page
        .getByText(/^Change .+ \/ \d+$/)
        .first()
        .textContent()) ?? '',
      /^Change/
    );
    assert.equal(await page.getByText(/Only the masks changed/).count(), 0);
    const headings = await page
      .locator('aside')
      .getByRole('heading', { level: 3 })
      .allTextContents();
    assert.ok(headings.indexOf('Masks') > headings.indexOf('Pixel Changes'), headings.join(', '));
  } finally {
    await page.close();
  }
});

test('large masks: an open item while there are any, the filter and the card badges', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({
    rows: [masksOnly, row('ui-button--primary')],
    entries: [entry(story, issue), entry('ui-button--primary')],
  });
  const { page } = await open(d, { hash: '#overview' });
  try {
    const item = page.getByText('Entries with masks over 25%', { exact: true });
    await item.waitFor();
    await item.click();
    await page.getByRole('combobox', { name: 'Result' }).waitFor();
    // One card: the entry with the large mask, with both badges.
    const cards = page.locator('[data-status]');
    await page.waitForFunction(() => document.querySelectorAll('[data-status]').length === 1);
    assert.equal(await cards.count(), 1);
    assert.ok(await cards.getByText('Masks changed', { exact: true }).isVisible());
    assert.ok(await cards.getByText('Large mask', { exact: true }).isVisible());
  } finally {
    await page.close();
  }
  // Without a large mask, Open items has no such row.
  const clean = data({ rows: [row('ui-button--primary')], entries: [entry('ui-button--primary')] });
  const { page: p2 } = await open(clean, { hash: '#overview' });
  try {
    await p2.getByText('Open Items').first().waitFor();
    assert.equal(await p2.getByText('Entries with masks over 25%').count(), 0);
  } finally {
    await p2.close();
  }
});

test('a moved or recounted mask is named, and masks no approval passes say so first', async (t) => {
  // Mask audit 7 (count and boxes compared) and decision 2 (over 50% or the story root fails).
  if (skip) return t.skip(skip);
  const id = 'ui-order-row--default';
  const blocked = row(id, {
    pass: false,
    changed: true,
    metrics: { ssim: 1, changedCells: 0, grid: 64, identical: true },
    reasons: [
      'masks changed: 1 moved, 1 changed count',
      'masks cover 62% of the capture, over 50%',
    ],
    masks: [
      { selector: '.id', source: 'project', area: 0.3 },
      { selector: '.stamp', source: 'story', area: 0.32 },
    ],
    masksChanged: { added: [], removed: [], grew: [], moved: ['.id'], count: ['.stamp'] },
    masksBaseline: [
      { selector: '.id', source: 'project', area: 0.3 },
      { selector: '.stamp', source: 'story', area: 0.32 },
    ],
    masksBlocked: { coverage: 0.62 },
  });
  const d = data({ rows: [blocked], entries: [entry(id, issue)] });
  const { page, errors } = await open(d, { hash: `#inspect=${id}`, images: same });
  try {
    await ready(page);
    const side = page.locator('aside');
    assert.ok(
      await side
        .getByText(
          'No approval passes this entry until the masks are smaller: masks cover 62% of the capture, over 50%.',
          { exact: true }
        )
        .isVisible()
    );
    assert.ok(await side.getByText('2 masks changed since the baseline.').isVisible());
    assert.deepEqual(await lines(page), [
      'Moved.idProject · Baseline 30% · render 30%',
      'Count changed.stampStory · Baseline 32% · render 32%',
    ]);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
