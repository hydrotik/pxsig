/**
 * The inspector's Originals switch in a real browser, against a mocked server (see
 * flows-helpers.mjs, which serves the sample images so the stage draws): it hides the highlight,
 * regions and detail tiles and gives them back unchanged, leaves Pixel diff and Signature cells,
 * opens the next entry fitted, is never saved or sent with a decision, and works in the Storybook
 * panel. Nothing here can write a baseline. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const story = 'ui-button--primary';
const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const detail = { changedTiles: 3, newEdgeTiles: 0, maxBlockDelta: 40, tripped: [0, 1, 2] };
/** Two changed entries, the first with tripped detail tiles. */
const d = data({
  rows: [row(story, { ...changed, detail }), row(`${story}@light`, { ...changed, mode: 'light' })],
  entries: [entry(story, issue), entry(`${story}@light`, issue)],
});
const ORIGINALS = 'Show the original images without analysis';
const OVERLAYS = {
  highlight: 'Highlight changed pixels',
  regions: 'Outline changed regions',
  tiles: 'Show detail tiles over the limit',
};

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};
/** What the stage draws over the images. @param {import('playwright').Page} page */
const drawn = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector('[data-mode]');
    return {
      mode: stage?.getAttribute('data-mode'),
      regions: stage?.querySelectorAll('svg rect:not([data-tile])').length ?? 0,
      tiles: stage?.querySelectorAll('svg rect[data-tile]').length ?? 0,
      highlight: stage?.querySelectorAll('canvas[data-kind="highlight"]').length ?? 0,
    };
  });
/** @param {import('playwright').Page} page @param {string} name */
const control = (page, name) => page.getByRole('switch', { name, exact: true });

test('Originals hides the highlight, regions and tiles in every mode it allows, and gives them back', async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(d, { hash: `#inspect=${story}`, images: true });
  try {
    await ready(page);
    const before = await drawn(page);
    // Both panes draw the regions and the three tiles; the latest pane the highlight.
    assert.ok(before.regions > 0 && before.tiles === 6 && before.highlight === 1, 'drawn first');
    await page.keyboard.press('o');
    assert.equal(await control(page, ORIGINALS).isChecked(), true);
    for (const key of ['1', '2', '3']) {
      await page.keyboard.press(key);
      const now = await drawn(page);
      assert.deepEqual(
        { regions: now.regions, tiles: now.tiles, highlight: now.highlight },
        { regions: 0, tiles: 0, highlight: 0 },
        `mode ${now.mode}`
      );
    }
    await page.keyboard.press('1');
    // The overlay switches show what is drawn, disabled; Tolerance too.
    for (const name of Object.values(OVERLAYS)) {
      assert.equal(await control(page, name).isChecked(), false, name);
      assert.equal(await control(page, name).isDisabled(), true, name);
    }
    assert.equal(await page.getByRole('slider', { name: 'Tolerance' }).isDisabled(), true);
    // The change arrows still step (navigation draws nothing).
    await page.keyboard.press('n');
    await page.getByText('Change 2 /').first().waitFor();
    await control(page, ORIGINALS).click();
    assert.deepEqual(await drawn(page), { ...before, mode: 'side' });
    for (const name of Object.values(OVERLAYS)) {
      assert.equal(await control(page, name).isChecked(), true, name);
      assert.equal(await control(page, name).isDisabled(), false, name);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('Originals leaves Pixel diff and Signature cells, and choosing either turns it off', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open(d, { hash: `#inspect=${story}`, images: true });
  try {
    await ready(page);
    for (const key of ['4', '5']) {
      await page.keyboard.press(key);
      await page.keyboard.press('O');
      assert.equal((await drawn(page)).mode, 'side', `from mode ${key}`);
      assert.equal(await control(page, ORIGINALS).isChecked(), true);
      await page.keyboard.press(key);
      assert.equal(await control(page, ORIGINALS).isChecked(), false, `key ${key}`);
    }
    await page.keyboard.press('o');
    await page.getByRole('button', { name: 'Pixel diff' }).click();
    assert.equal((await drawn(page)).mode, 'diff');
    assert.equal(await control(page, ORIGINALS).isChecked(), false, 'clicked');
  } finally {
    await page.close();
  }
});

test('Originals is never saved, never sent with a decision, and the next entry opens fitted', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(d, {
    hash: `#inspect=${story}`,
    images: true,
    answers: { approve: { ok: true, approved: [`${story}@light`] } },
  });
  try {
    await ready(page);
    // A failing entry opens on its largest change.
    await page.getByText('Change 1 /').first().waitFor();
    await page.keyboard.press('o');
    const saved = await page.evaluate(() => localStorage.getItem('pxsig-inspector') ?? '{}');
    assert.equal('originals' in JSON.parse(saved), false, saved);
    // Still on for the next entry, which opens on the whole image, no change in focus.
    await page.keyboard.press('ArrowRight');
    await page.getByRole('heading', { name: `${story}@light` }).waitFor();
    await ready(page);
    assert.equal(await control(page, ORIGINALS).isChecked(), true);
    await page.getByText('Change – /').first().waitFor();
    await page.keyboard.press('a');
    for (let i = 0; i < 100 && !posts.length; i++) await page.waitForTimeout(20);
    // The decision carries the entry only: no view state.
    assert.deepEqual(posts, [{ name: 'approve', body: { project: 'demo', id: `${story}@light` } }]);
    // Off the next time the inspector opens.
    await page.reload();
    await ready(page);
    assert.equal(await control(page, ORIGINALS).isChecked(), false);
  } finally {
    await page.close();
  }
});

test('a new entry has no Originals switch', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-button--new';
  const nd = data({
    rows: [row(id, { pass: false, new: true, metrics: null, reasons: ['new'] })],
    entries: [entry(id, [{ code: 'unbaselined', severity: 'warn', reason: 'no signature' }])],
  });
  const { page } = await open(nd, { hash: `#inspect=${id}`, images: true });
  try {
    await ready(page);
    assert.equal(await control(page, ORIGINALS).count(), 0);
  } finally {
    await page.close();
  }
});

test('in the Storybook panel Originals is in the View section, and O works on the panel', async (t) => {
  if (skip) return t.skip(skip);
  const { page: p } = await open(d, { hash: `?embed=1&story=${story}`, images: true });
  try {
    await ready(p);
    await control(p, 'Show details').click();
    const view = p.getByRole('heading', { name: 'View', exact: true });
    await view.waitFor();
    assert.equal(await control(p, ORIGINALS).isChecked(), false);
    // Focus is on the Details switch, inside the panel.
    await p.keyboard.press('o');
    assert.equal(await control(p, ORIGINALS).isChecked(), true);
    assert.deepEqual(
      { ...(await drawn(p)), mode: undefined },
      { mode: undefined, regions: 0, tiles: 0, highlight: 0 }
    );
  } finally {
    await p.close();
  }
});
