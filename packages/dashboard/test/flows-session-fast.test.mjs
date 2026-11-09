/**
 * A review session decided quickly, in a real browser against a mocked server (see
 * flows-helpers.mjs). The mocked data never refreshes after a decision, as when the server's
 * refreshed data has not arrived yet: the session must still move forward, never back to an entry
 * just decided, and a reload keeps the session. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AT, changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const IDS = ['ui-a--primary', 'ui-b--primary', 'ui-c--primary'];
const approving = { allowed: true, folder: 'demo', command: 'pxsig serve --link' };
/** @param {Record<string, unknown>} [review] */
const three = (review = {}) => ({
  ...data({
    rows: IDS.map((id) => row(id, changed)),
    entries: IDS.map((id) =>
      entry(id, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])
    ),
  }),
  review,
});
/** @param {import('playwright').Page} page */
const approveButton = (page) =>
  page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true, disabled: false });
/** The ids approved so far, in order. */
const approved = (posts) => posts.filter((p) => p.name === 'approve').map((p) => p.body.id);
/** Up to a second for `n` approves to reach the server. */
async function approves(page, posts, n) {
  for (let i = 0; approved(posts).length < n && i < 50; i++) await page.waitForTimeout(20);
}

test('approving quickly: each approve moves on, never back to an entry just approved', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts, errors } = await open(three(), { approving, images: true });
  try {
    await page.getByRole('button', { name: 'Review 3 changes' }).click();
    for (let i = 0; i < IDS.length; i++) {
      await approveButton(page).waitFor();
      await page.keyboard.press('a');
      await approves(page, posts, i + 1);
    }
    assert.deepEqual(approved(posts), IDS, 'one approve each, in order');
    // Nothing is left: the inspector stays on the last one, not back on the first.
    await page.waitForTimeout(200);
    assert.equal(new URL(page.url()).hash, `#inspect=${IDS[2]}&session=changed`);
    // A again sends nothing (it is approved already).
    await approveButton(page).waitFor();
    await page.keyboard.press('a');
    await page.waitForTimeout(200);
    assert.deepEqual(approved(posts), IDS, 'no second approve of the last entry');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('the A key follows the Approve button: an approved entry is not approved again', async (t) => {
  if (skip) return t.skip(skip);
  const review = { [IDS[0]]: { state: 'approved', at: AT, via: 'dashboard' } };
  const { page, posts } = await open(three(review), {
    hash: `#inspect=${IDS[0]}`,
    approving,
    images: true,
  });
  try {
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Reject', exact: true, disabled: false })
      .waitFor();
    await page.keyboard.press('a');
    await page.waitForTimeout(200);
    assert.deepEqual(approved(posts), []);
  } finally {
    await page.close();
  }
});

test('a reload during a session reopens the session on its first undecided entry', async (t) => {
  if (skip) return t.skip(skip);
  const review = { [IDS[0]]: { state: 'approved', at: AT, via: 'dashboard' } };
  const { page, posts } = await open(three(review), {
    hash: `#inspect=${IDS[0]}&session=changed`,
    approving,
    images: true,
  });
  try {
    await page.getByText('Reviewing changes').first().waitFor();
    await approveButton(page).waitFor();
    await page.keyboard.press('a');
    await approves(page, posts, 1);
    assert.deepEqual(
      approved(posts),
      [IDS[1]],
      'on the first undecided entry, not the approved one'
    );
    assert.match(new URL(page.url()).hash, /&session=changed$/);
  } finally {
    await page.close();
  }
});
