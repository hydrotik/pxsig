/**
 * Masks no approval passes, in a real browser against a mocked server (flows-helpers.mjs): Approve
 * is disabled and says why with what to do (the A key sends nothing either), a block with no mask
 * painted (a `data-volatile` problem) still shows its line in the Masks section, and a refused
 * approval leaves the inspector usable, with no browser dialog. Findings from the Ready to try of
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

test('a blocked entry: Approve is disabled and says why and what to do; A sends nothing', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-order-row--default';
  const d = data({
    rows: [
      row(id, {
        ...changed,
        reasons: [
          'masks cover 62% of the capture, over 50%',
          'a mask covers the story root: #r > *',
        ],
        masks: [{ selector: '#r > *', source: 'story', area: 0.62 }],
        masksCoverage: 0.62,
        masksBlocked: { coverage: 0.62, root: ['#r > *'] },
      }),
    ],
    entries: [entry(id, issue)],
  });
  const { page, posts } = await open(d, { hash: `#inspect=${id}`, images: true, approving });
  try {
    const button = approve(page);
    await button.waitFor();
    assert.ok(await button.isDisabled(), 'no approval passes it');
    const why =
      'No approval passes this entry: masks cover 62% of the capture, over 50%; a mask covers the story root: #r > *; make the masks smaller; mask the value, not the story root.';
    assert.equal(await button.getAttribute('title'), why);
    await page.keyboard.press('a');
    await page.waitForTimeout(300);
    assert.deepEqual(
      posts.map((p) => p.name),
      [],
      'the A key does not ask the server'
    );
  } finally {
    await page.close();
  }
});

test('a data-volatile problem with no mask painted still says why in the Masks section', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-activity-row--default';
  const reason = 'mask on a container: div[data-volatile="sync row"]: element children div, svg';
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
    const line = `No approval passes this entry: ${reason}; put data-volatile on the element that shows the value (a leaf).`;
    await page.locator('aside').getByText(line, { exact: true }).waitFor();
    assert.ok(await approve(page).isDisabled());
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
