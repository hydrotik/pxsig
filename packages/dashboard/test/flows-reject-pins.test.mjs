/**
 * The Reject paths in a real browser, against a mocked server (flows-helpers.mjs), pinned before a
 * rejection carries a reason (design: the rejection packet, PR 2): the header's Reject posts
 * `reject`, the side panel's Accessibility section's Reject posts `a11y-reject`, each with the
 * project and the entry id. (flows-decisions.test.mjs pins the buttons' boxes.)
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
const approving = { allowed: true, folder: 'demo', command: 'pnpm exec pxsig serve --link' };

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};

/**
 * @param {{ name: string }[]} posts
 * @param {string} name
 */
const posted = async (posts, name) => {
  for (let i = 0; i < 100 && !posts.some((p) => p.name === name); i++)
    await new Promise((r) => setTimeout(r, 50));
  return posts.find((p) => p.name === name);
};

test("the header's Reject posts reject with the project and the id", async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row(story, changed)], entries: [entry(story, issue)] });
  const { page, posts } = await open(d, { hash: `#inspect=${story}`, images: true, approving });
  try {
    await ready(page);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Reject', exact: true })
      .first()
      .click();
    const p = await posted(posts, 'reject');
    assert.ok(p, 'a reject was posted');
    assert.equal(p.body.project, 'demo');
    assert.equal(p.body.id, story);
  } finally {
    await page.close();
  }
});

test("the Accessibility section's Reject posts a11y-reject", async (t) => {
  if (skip) return t.skip(skip);
  const d = data({
    rows: [row(story, { ...changed, a11y: { violations: [contrast], new: 1, baseline: [] } })],
    entries: [entry(story, issue)],
  });
  const { page, posts } = await open(d, { hash: `#inspect=${story}`, images: true, approving });
  try {
    await ready(page);
    const a11y = page.locator('aside section', { hasText: 'Accessibility (1)' });
    await a11y.getByRole('button', { name: 'Reject', exact: true }).click();
    const p = await posted(posts, 'a11y-reject');
    assert.ok(p, 'an a11y-reject was posted');
    assert.equal(p.body.project, 'demo');
    assert.equal(p.body.id, story);
    assert.ok(!posts.some((x) => x.name === 'reject'), 'not the visual reject');
  } finally {
    await page.close();
  }
});
