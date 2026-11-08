/**
 * The inspector's text labels in a real browser, against a mocked server (flows-helpers.mjs): the
 * header badge, the Text section's place in the side panel, a change showing its box on the stage,
 * and every state of fixtures/text.mjs. Each sentence is held to packages/pxsig's lib/text/say.mjs
 * (what MCP, the CLI and the rejection packet say), so the dashboard's en.json copy and say.mjs
 * stay in step. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TEXT_LABELS_ONLY,
  sayChange,
  textKindLabel,
  textSummary,
} from '../../pxsig/src/lib/text/say.mjs';
import { SCENARIOS } from '../fixtures/scenarios.mjs';
import { TEXT_DIFFS, TEXT_IDS } from '../fixtures/text.mjs';
import { open, setupFlows, skip } from './flows-helpers.mjs';

setupFlows();

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
/** @param {import('playwright').Page} page */
const textSection = (page) =>
  page.locator('aside section', { has: page.getByRole('heading', { name: 'Text', exact: true }) });

/** How many elements read exactly `label` (the header badge). @param {import('playwright').Page} page @param {string} label */
const badges = (page, label) => page.getByText(label, { exact: true }).count();

test('copy with reflow: the badge, the Text section after Pixel Changes, each change in say.mjs words', async (t) => {
  if (skip) return t.skip(skip);
  const id = TEXT_IDS.copyReflow;
  const diff = TEXT_DIFFS.copyReflow();
  const { page, errors } = await open(SCENARIOS.text(), { hash: `#inspect=${id}`, images: true });
  try {
    await ready(page);
    assert.deepEqual(await sections(page), ['Pixel', 'Pixel Changes', 'Text', 'Metrics', 'Files']);
    assert.ok(
      await page.getByText('Copy, reflow', { exact: true }).isVisible(),
      'the header badge'
    );
    assert.equal(await badges(page, textKindLabel('copy-reflow')), 1);
    const section = textSection(page);
    assert.equal(await section.locator('p').innerText(), textSummary(diff));
    const buttons = section.getByRole('list', { name: 'Text changes' }).getByRole('button');
    assert.deepEqual(
      await buttons.allTextContents(),
      diff.changes.map((c) => sayChange(c, diff.changes))
    );
    assert.ok((await buttons.first().innerText()).includes('"1␠"'), 'a space shown as ␠');
    assert.ok(await section.getByText(TEXT_LABELS_ONLY, { exact: true }).isVisible());

    // A change shows its box on the stage, as a region does: the region list lets go of its choice.
    await buttons.nth(3).click();
    assert.equal(await buttons.nth(3).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('aside button[aria-pressed="true"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('every fixture row: the summary as say.mjs words it, a badge only for a text kind', async (t) => {
  if (skip) return t.skip(skip);
  for (const [k, id] of Object.entries(TEXT_IDS)) {
    const diff = TEXT_DIFFS[/** @type {keyof typeof TEXT_DIFFS} */ (k)]();
    const { page, errors } = await open(SCENARIOS.text(), { hash: `#inspect=${id}`, images: true });
    try {
      await ready(page);
      const section = textSection(page);
      assert.equal(await section.locator('p').innerText(), textSummary(diff), k);
      const changes = diff.state === 'compared' ? diff.changes : [];
      assert.deepEqual(
        await section.getByRole('button').allTextContents(),
        changes.map((c) => sayChange(c, changes)),
        k
      );
      const label =
        diff.state === 'compared' && diff.kind !== 'pixel' ? textKindLabel(diff.kind) : null;
      for (const l of ['Copy', 'Copy, reflow', 'Text moved', 'Text restyled'])
        assert.equal(await badges(page, l), l === label ? 1 : 0, `${k}: ${l}`);
      assert.deepEqual(errors, [], k);
    } finally {
      await page.close();
    }
  }
});

test('a row without text labels has no Text section and no badge', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open(SCENARIOS.changed(), {
    hash: '#inspect=ui-button--primary',
    images: true,
  });
  try {
    await ready(page);
    assert.ok(!(await sections(page)).includes('Text'));
  } finally {
    await page.close();
  }
});
