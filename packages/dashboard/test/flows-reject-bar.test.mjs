/**
 * The rejected note, in a real browser against a mocked server (flows-helpers.mjs): a rejected
 * entry's reason, Edit reason (the row prefilled, the inspector stays on the entry), Copy for an
 * agent (the server's paragraph), the packet in Files; an entry checked again since with Rejected
 * earlier and Dismiss reason (`rejection-dismiss`, kind visual); a reason not kept and a packet not
 * written; the session summary's Copy for an agent. (flows-reject-note.test.mjs: the row itself.)
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const story = 'ui-button--primary';
const light = `${story}@light`;
const approving = { allowed: true, folder: 'demo', command: 'pnpm exec pxsig serve --link' };
// Copy for an agent writes to the clipboard: kept on the page instead, for the test to read.
const init = `navigator.clipboard.writeText = async (v) => { window.__copied = v; };`;

/** @param {import('playwright').Page} page */
const ready = async (page) => {
  await page.getByRole('group', { name: 'Image comparison' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
};

/**
 * @param {{ name: string, body: Record<string, unknown> }[]} posts
 * @param {string} name
 */
const posted = async (posts, name) => {
  for (let i = 0; i < 100 && !posts.some((p) => p.name === name); i++)
    await new Promise((r) => setTimeout(r, 50));
  return posts.find((p) => p.name === name);
};

/** @param {import('playwright').Page} page */
const copied = (page) => page.evaluate(() => /** @type {any} */ (window).__copied);

test('a rejected entry: its reason, Edit reason, Copy for an agent and the packet', async (t) => {
  if (skip) return t.skip(skip);
  const d = SCENARIOS.rejected();
  const { page, posts } = await open(d, {
    hash: `#inspect=${story}`,
    images: true,
    approving,
    init,
  });
  try {
    await ready(page);
    await page
      .getByText('Rejected. Reason: The label sits 4px lower than in the baseline')
      .waitFor();
    await page.getByText(`pxsig check ${story}`, { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Copy for an agent', exact: true }).click();
    assert.equal(await copied(page), d.rejections.visual[story].prompt);
    assert.match(await copied(page), /^pxsig rejected ui-button--primary \(demo\): "The label/);

    // Files: the packet's rejection.md, under the server's paths.rejected.
    const link = page.getByRole('link', { name: 'Rejection packet', exact: true });
    assert.equal(await link.getAttribute('href'), `/p/demo/reports/rejected/${story}/rejection.md`);

    await page.getByRole('button', { name: 'Edit reason', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'Reason' });
    assert.equal(await field.inputValue(), 'The label sits 4px lower than in the baseline');
    await field.fill('The label sits 4px lower');
    await page.keyboard.press('Enter');
    const p = await posted(posts, 'reject');
    assert.deepEqual(p?.body, { project: 'demo', id: story, note: 'The label sits 4px lower' });
    // An edited reason stays on the entry.
    await page.waitForTimeout(300);
    assert.ok(await page.getByRole('heading', { name: story, exact: true }).isVisible());
  } finally {
    await page.close();
  }
});

test('checked again since its rejection: Rejected earlier, and Dismiss reason closes it', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(SCENARIOS.rejected(), {
    hash: `#inspect=${light}`,
    images: true,
    approving,
  });
  try {
    await ready(page);
    await page.getByText('Rejected earlier: The border is lighter than in the baseline').waitFor();
    // Reject and Approve are as on any changed entry: the rejection is not a decision.
    assert.equal(
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Approve', exact: true })
        .isEnabled(),
      true
    );
    await page.getByRole('button', { name: 'Dismiss reason', exact: true }).click();
    const p = await posted(posts, 'rejection-dismiss');
    assert.deepEqual(p?.body, { project: 'demo', id: light, kind: 'visual' });
  } finally {
    await page.close();
  }
});

test('a reason not kept and a packet not written say so on the rejected note', async (t) => {
  if (skip) return t.skip(skip);
  const d = SCENARIOS.rejected();
  d.review[story] = { state: 'rejected', at: d.review[story].at, noteKept: false };
  d.rejections.visual[story] = {
    ...d.rejections.visual[story],
    note: null,
    notes: [],
    packet: null,
    packetError: 'not written: the store’s reports/ is not git-ignored',
  };
  const { page } = await open(d, { hash: `#inspect=${story}`, images: true, approving });
  try {
    await ready(page);
    await page.getByText('Rejected. Fix the component, then re-run the check:').waitFor();
    await page
      .getByText('Note not kept: .pxsig/reports/ is not git-ignored. pxsig doctor shows the fix.')
      .waitFor();
    await page
      .getByText('Rejection packet not written: the store’s reports/ is not git-ignored.')
      .waitFor();
    assert.equal(await page.getByRole('link', { name: 'Rejection packet' }).count(), 0);
  } finally {
    await page.close();
  }
});

test("the session summary's Copy for an agent copies every rejected entry's paragraph", async (t) => {
  if (skip) return t.skip(skip);
  const d = SCENARIOS['long-rejections']();
  const { page } = await open(d, { hash: '#overview', approving, init });
  try {
    await page.getByRole('button', { name: 'Changed 0', exact: true }).click();
    await page.getByRole('heading', { name: 'Review complete' }).waitFor();
    await page.getByRole('button', { name: 'Copy for an agent', exact: true }).click();
    const want = Object.values(d.rejections.visual)
      .map((r) => r.prompt)
      .join('\n\n');
    assert.equal(await copied(page), want);
  } finally {
    await page.close();
  }
});
