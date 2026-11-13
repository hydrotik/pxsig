/**
 * Masks no approval passes, in a real browser against a mocked server (flows-helpers.mjs): a blocked
 * entry is Blocked, with its line in Reject and Approve's place (the A and R keys send nothing), out
 * of the review's progress and arrows, in Overview's Blocked item; a block with no mask painted (a
 * `data-volatile` problem) still shows its line in the Masks section; and a refused approval
 * leaves the inspector usable, with no browser dialog. Findings from the Ready to try of
 * pull requests 322 and 323. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
// scenarios.mjs first: it imports masks.mjs, whose helpers import it back.
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const approving = { allowed: true, folder: 'demo', command: 'pxsig serve --link' };
/** @param {import('playwright').Page} page */
const approve = (page) => page.getByRole('button', { name: 'Approve', exact: true });

/** A changed row whose masks no approval passes (over half the capture, and the story root). */
const blockedRow = (/** @type {string} */ id) =>
  row(id, {
    ...changed,
    reasons: ['masks cover 62% of the capture, over 50%', 'a mask covers the story root: #r > *'],
    masks: [{ selector: '#r > *', source: 'story', area: 0.97, root: true }],
    masksCoverage: 0.97,
    masksBlocked: { coverage: 0.97, root: ['#r > *'] },
  });
const line =
  'No approval passes this entry: masks cover 62% of the capture, over 50%; a mask covers the story root: #r > *; make the masks smaller; mask the value, not the story root.';

test('a blocked entry: Blocked, the line in place of Reject and Approve; A and R send nothing', async (t) => {
  // Owner decision: a blocked entry needs no decision from a person; the author fixes it.
  if (skip) return t.skip(skip);
  const id = 'ui-order-row--default';
  const d = data({ rows: [blockedRow(id)], entries: [entry(id, issue)] });
  const { page, posts } = await open(d, { hash: `#inspect=${id}`, images: true, approving });
  try {
    const dialog = page.getByRole('dialog');
    await dialog
      .getByText(`Blocked: no decision is needed, the author fixes it. ${line}`)
      .waitFor();
    assert.equal(await approve(page).count(), 0, 'no Approve');
    assert.equal(await page.getByRole('button', { name: 'Reject', exact: true }).count(), 0);
    assert.ok(await dialog.getByText('Blocked', { exact: true }).first().isVisible(), 'the state');
    assert.ok(await page.getByRole('button', { name: 'Re-check' }).isVisible(), 'Re-check stays');
    await page.keyboard.press('a');
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    assert.deepEqual(
      posts.map((p) => p.name),
      [],
      'the A and R keys do not ask the server'
    );
  } finally {
    await page.close();
  }
});

test('blocked entries leave the review: not in the progress, the count or the arrows', async (t) => {
  if (skip) return t.skip(skip);
  const ids = ['ui-a--one', 'ui-b--two', 'ui-c--blocked'];
  const d = data({
    rows: [row(ids[0], changed), row(ids[1], changed), blockedRow(ids[2])],
    entries: ids.map((id) => entry(id, issue)),
  });
  const { page } = await open(d, {
    hash: `#inspect=${ids[0]}&session=changed`,
    images: true,
    approving,
  });
  try {
    await page.getByText('0 of 2 reviewed · 2 left').waitFor();
    /** @type {string[]} */
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push((await page.getByRole('dialog').getByRole('heading').first().textContent()) ?? '');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    assert.deepEqual(
      [...new Set(seen.map((h) => ids.find((id) => h.includes(id)) ?? h))].sort(),
      [ids[0], ids[1]],
      `the arrows walk the two changed entries`
    );
    assert.ok(
      seen.every((h) => !h.includes(ids[2])),
      `the arrows skip the blocked entry: ${seen.join(' | ')}`
    );
  } finally {
    await page.close();
  }
  // Overview: a Blocked item, not in "awaiting review"; it opens the Blocked filter.
  const { page: p2 } = await open(d, { hash: '#overview', approving });
  try {
    const item = p2.getByText('Blocked by masks, the author fixes them', { exact: true });
    await item.waitFor();
    await item.click();
    await p2.waitForFunction(() => document.querySelectorAll('[data-status]').length === 1);
    assert.equal(await p2.locator('[data-status="blocked"]').count(), 1);
  } finally {
    await p2.close();
  }
});

test('a data-volatile problem with no mask painted still says why in the Masks section', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-activity-row--default';
  const reason = 'mask on a container: div[data-volatile="sync row"]: elements inside: div, svg';
  const d = data({
    rows: [
      row(id, {
        ...changed,
        reasons: [...changed.reasons, reason],
        masks: [],
        masksBlocked: { problems: [{ kind: 'container', element: reason.slice(21) }] },
      }),
    ],
    entries: [entry(id, issue)],
  });
  const { page } = await open(d, { hash: `#inspect=${id}`, images: true, approving });
  try {
    const why = `No approval passes this entry: ${reason}; put data-volatile on the element that shows the value (a leaf).`;
    await page.locator('aside').getByText(why, { exact: true }).waitFor();
    assert.equal(await approve(page).count(), 0);
  } finally {
    await page.close();
  }
});

test('a refused approval: no browser dialog, why under the header, the inspector usable', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-button--primary';
  const d = data({ rows: [row(id, changed)], entries: [entry(id, issue)] });
  const { page, posts } = await open(d, {
    hash: `#inspect=${id}`,
    images: true,
    approving,
    answers: { approve: { status: 409, json: { error: `${id} is being re-checked` } } },
  });
  try {
    /** @type {string[]} */
    const dialogs = [];
    page.on('dialog', (dl) => (dialogs.push(dl.message()), void dl.dismiss()));
    const button = approve(page);
    await button.waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    await button.click();
    await page.getByText(`Approve failed: ${id} is being re-checked`).waitFor();
    assert.deepEqual(dialogs, [], 'never a browser alert');
    assert.equal(await page.locator('[aria-busy="true"]').count(), 0, 'not "Approving…"');
    assert.ok(await button.isEnabled());
    await button.click();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    assert.equal(posts.filter((p) => p.name === 'approve').length, 2, 'it can approve again');
  } finally {
    await page.close();
  }
});
