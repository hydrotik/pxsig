/**
 * The inspector's side panel in a real browser, against a mocked server (flows-helpers.mjs): its
 * sections, in order, for a changed entry, an entry with accessibility violations, the Storybook
 * panel and a static report. Pins what the panel shows, so moving its code changes none of it.
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const story = 'ui-button--primary';
const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const contrast = {
  id: 'color-contrast',
  impact: 'serious',
  help: 'Elements must meet minimum color contrast ratio thresholds',
  nodes: 2,
  targets: ['.label'],
};

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};
/** The side panel's section headings, in order. @param {import('playwright').Page} page */
const sections = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('aside section > h3, aside section > div > h3')].map(
      (h) => h.textContent
    )
  );

test('a changed entry: Pixel, Pixel Changes, Metrics, Files, with the readout', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row(story, changed)], entries: [entry(story, issue)] });
  const { page, errors } = await open(d, { hash: `#inspect=${story}`, images: true });
  try {
    await ready(page);
    assert.deepEqual(await sections(page), ['Pixel', 'Pixel Changes', 'Metrics', 'Files']);
    assert.ok(await page.locator('aside').getByText('Changed pixels').first().isVisible());
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('accessibility violations: their section between Metrics and Files, with its decisions', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({
    rows: [row(story, { ...changed, a11y: { violations: [contrast], new: 1, baseline: [] } })],
    entries: [entry(story, issue)],
  });
  const { page } = await open(d, {
    hash: `#inspect=${story}`,
    images: true,
    approving: { allowed: true, folder: 'demo', command: 'pnpm exec pxsig serve --link' },
  });
  try {
    await ready(page);
    assert.deepEqual(await sections(page), [
      'Pixel',
      'Pixel Changes',
      'Metrics',
      'Accessibility (1)',
      'Files',
    ]);
    const a11y = page.locator('aside section', { hasText: 'Accessibility (1)' });
    assert.ok(await a11y.getByText(/color-contrast/).isVisible());
    assert.ok((await a11y.getByRole('button').count()) > 0, 'its decision buttons');
  } finally {
    await page.close();
  }
});

test('the Storybook panel: the side panel hidden until opened, then View first', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row(story, changed)], entries: [entry(story, issue)] });
  const { page } = await open(d, { hash: `?embed=1&story=${story}`, images: true });
  try {
    await ready(page);
    assert.equal(await page.locator('aside').count(), 0);
    await page.getByRole('switch', { name: 'Show details', exact: true }).click();
    await page.getByRole('heading', { name: 'View', exact: true }).waitFor();
    assert.equal((await sections(page))[0], 'View');
  } finally {
    await page.close();
  }
});

test('a static report: no decision buttons in the Accessibility section', async (t) => {
  if (skip) return t.skip(skip);
  const d = {
    ...data({
      rows: [row(story, { ...changed, a11y: { violations: [contrast], new: 1, baseline: [] } })],
      entries: [entry(story, issue)],
    }),
    static: true,
  };
  // A static report carries its data in the page (window.PXSIG), as `pxsig report` writes it.
  const { page } = await open(d, {
    hash: `#inspect=${story}`,
    images: true,
    init: { content: `window.PXSIG = ${JSON.stringify(d)};` },
  });
  try {
    await ready(page);
    const a11y = page.locator('aside section', { hasText: 'Accessibility (1)' });
    await a11y.waitFor();
    assert.equal(await a11y.getByRole('button').count(), 0);
  } finally {
    await page.close();
  }
});
