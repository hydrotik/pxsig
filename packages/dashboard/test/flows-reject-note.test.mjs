/**
 * The reason on Reject, in a real browser against a mocked server (flows-helpers.mjs): Reject and R
 * open the reason's row under the header; Enter rejects with the reason typed (an empty one too,
 * with no `note` in the body), Esc cancels and leaves the inspector open; the field takes at most
 * 280 characters; A and R typed into it decide nothing, in the dialog and in the Storybook panel;
 * the side panel's Accessibility Reject opens the row for `a11y-reject`; a reason the server did
 * not keep says so. (flows-reject-bar.test.mjs: the rejected note after it.)
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
const one = () => data({ rows: [row(story, changed)], entries: [entry(story, issue)] });

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};

/**
 * The first post named `name`, waiting up to 5 s.
 * @param {{ name: string, body: Record<string, unknown> }[]} posts
 * @param {string} name
 */
const posted = async (posts, name) => {
  for (let i = 0; i < 100 && !posts.some((p) => p.name === name); i++)
    await new Promise((r) => setTimeout(r, 50));
  return posts.find((p) => p.name === name);
};
/** Nothing new is posted for a moment. */
const settle = () => new Promise((r) => setTimeout(r, 300));

/** @param {import('playwright').Page} page */
const headerReject = (page) =>
  page.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).first();

test('Reject opens the reason row; Enter rejects with the reason typed; a and r in it decide nothing', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    approving,
  });
  try {
    await ready(page);
    await headerReject(page).click();
    const field = page.getByRole('textbox', { name: 'Reason' });
    await field.waitFor();
    assert.equal(await field.getAttribute('placeholder'), 'Optional. What is wrong, in one line');
    assert.ok(await field.evaluate((el) => el === document.activeElement), 'the field has focus');
    await settle();
    assert.deepEqual(posts, [], 'opening the row decides nothing');
    await page.keyboard.type('a radius r');
    await settle();
    assert.deepEqual(posts, [], 'typing a and r decides nothing');
    await page.keyboard.press('Enter');
    const p = await posted(posts, 'reject');
    assert.ok(p, 'a reject was posted');
    assert.deepEqual(p.body, { project: 'demo', id: story, note: 'a radius r' });
    await field.waitFor({ state: 'detached' });
    assert.ok(!posts.some((x) => x.name === 'approve'));
  } finally {
    await page.close();
  }
});

test('Esc cancels the row and keeps the inspector open; an empty reason still rejects', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    approving,
  });
  try {
    await ready(page);
    const field = page.getByRole('textbox', { name: 'Reason' });
    // R opens it too (the field is not focused yet).
    await page.getByRole('heading', { name: story }).click();
    await page.keyboard.press('r');
    await field.waitFor();
    await page.keyboard.press('Escape');
    await field.waitFor({ state: 'detached' });
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.getByRole('dialog').isVisible(), 'Esc closed the row, not the dialog');
    await settle();
    assert.deepEqual(posts, []);
    // Cancel too.
    await headerReject(page).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await field.waitFor({ state: 'detached' });
    // Enter on an empty field: rejected, with no `note`.
    await headerReject(page).click();
    await field.fill('   ');
    await page.keyboard.press('Enter');
    const p = await posted(posts, 'reject');
    assert.deepEqual(p?.body, { project: 'demo', id: story });
  } finally {
    await page.close();
  }
});

test('the reason field takes at most 280 characters', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    approving,
  });
  try {
    await ready(page);
    await headerReject(page).click();
    const field = page.getByRole('textbox', { name: 'Reason' });
    await field.waitFor();
    await page.keyboard.type('x'.repeat(300));
    assert.equal((await field.inputValue()).length, 280);
    // The row's own Reject submits it.
    await page
      .getByRole('group', { name: 'Reject with a reason' })
      .getByRole('button', { name: 'Reject', exact: true })
      .click();
    const p = await posted(posts, 'reject');
    assert.equal(String(p?.body.note).length, 280);
  } finally {
    await page.close();
  }
});

test("the Accessibility section's Reject opens the row for a11y-reject", async (t) => {
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
    await page.getByRole('group', { name: 'Reject the violations with a reason' }).waitFor();
    await page.keyboard.type('contrast too low');
    await page.keyboard.press('Enter');
    const p = await posted(posts, 'a11y-reject');
    assert.deepEqual(p?.body, { project: 'demo', id: story, note: 'contrast too low' });
    assert.ok(!posts.some((x) => x.name === 'reject'), 'not the visual reject');
  } finally {
    await page.close();
  }
});

test('in the Storybook panel, a and r typed in the reason field decide nothing; Enter rejects', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(one(), {
    hash: `?embed=1&story=${story}`,
    images: true,
    approving,
  });
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Reject', exact: true }).first().click();
    const field = page.getByRole('textbox', { name: 'Reason' });
    await field.waitFor();
    await page.keyboard.type('ar AR');
    await settle();
    assert.deepEqual(posts, [], 'no decision from the keys typed');
    assert.equal(await field.inputValue(), 'ar AR');
    await page.keyboard.press('Enter');
    const p = await posted(posts, 'reject');
    assert.deepEqual(p?.body, { project: 'demo', id: story, note: 'ar AR' });
  } finally {
    await page.close();
  }
});

test("a reason the server did not keep: the answer's notice shows under the header", async (t) => {
  if (skip) return t.skip(skip);
  const notice = 'Note not kept: .pxsig/reports/ is not git-ignored. pxsig doctor shows the fix.';
  const { page, posts } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    approving,
    answers: { reject: { ok: true, notice, entry: { state: 'rejected', noteKept: false } } },
  });
  try {
    await ready(page);
    await headerReject(page).click();
    await page.keyboard.type('moved');
    await page.keyboard.press('Enter');
    assert.ok(await posted(posts, 'reject'));
    await page.getByRole('status').filter({ hasText: notice }).waitFor();
  } finally {
    await page.close();
  }
});
