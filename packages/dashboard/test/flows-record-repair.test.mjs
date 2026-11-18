/**
 * "Repair baseline records" in the coverage banner (parts/RecordRepair.tsx): shown while the ledger
 * reports `baseline-pair-mismatch`, it lists the plan (each eligible entry with its baseline image)
 * and posts nothing until a person confirms; the post names each listed entry with the file sha256
 * it was listed with. Without the dashboard link the action is disabled. Skips when no Chromium.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { open, setupFlows, skip } from './flows-helpers.mjs';

setupFlows();

const ID = 'ui-button--primary';
const OTHER = 'ui-button--secondary';
const SHA = 'a'.repeat(64);
const plan = {
  createdAt: '2026-11-18T00:00:00.000Z',
  checked: 2,
  mismatched: 2,
  eligible: [
    {
      id: ID,
      file: SHA,
      record: 'b'.repeat(64),
      image: 'c'.repeat(64),
      why: 'only pxsig migrate approved it',
    },
  ],
  ineligible: [
    {
      id: OTHER,
      file: SHA,
      record: 'd'.repeat(64),
      image: 'e'.repeat(64),
      reasons: ['no latest render'],
    },
  ],
};

/** The ledger with the setup error. */
function mismatched() {
  const d = data({ rows: [row(ID), row(OTHER)], entries: [entry(ID, []), entry(OTHER, [])] });
  d.integrity.setup = [
    {
      code: 'baseline-pair-mismatch',
      severity: 'error',
      count: 2,
      reason: '2 baselines hold a record and an image from different renders',
    },
  ];
  return d;
}

/** @param {import('playwright').Page} page */
const planRoute = (page) =>
  page.route('**/__pxsig/record-repair-plan**', (route) =>
    route.fulfill({ json: { project: 'demo', plan } })
  );

test('lists with each image, posts only after the confirm', async (t) => {
  if (skip) return t.skip(skip);
  const { page, posts } = await open(mismatched(), {
    approving: { allowed: true, folder: 'demo', command: 'pxsig serve --link' },
    routes: planRoute,
    answers: {
      'record-repair': { ok: true, batch: 'b1-dashboard', repaired: [ID], notWritten: [] },
    },
  });
  try {
    await page.getByRole('button', { name: 'Repair baseline records' }).click();
    const group = page.getByRole('region', { name: 'Repair Baseline Records' });
    await group.getByRole('img', { name: `Baseline image of ${ID}` }).waitFor();
    assert.ok(await group.getByText('1 not eligible', { exact: true }).isVisible());
    assert.equal(
      posts.filter((p) => p.name === 'record-repair').length,
      0,
      'nothing before the confirm'
    );
    await group.getByRole('button', { name: 'Repair 1 record' }).click();
    await page.getByText('Repaired 1 · not written 0 · batch b1-dashboard').waitFor();
    const sent = posts.filter((p) => p.name === 'record-repair');
    assert.deepEqual(
      sent.map((p) => p.body.items),
      [[{ id: ID, file: SHA }]]
    );
  } finally {
    await page.close();
  }
});

test('cancel posts nothing; without the dashboard link the action is disabled', async (t) => {
  if (skip) return t.skip(skip);
  const a = await open(mismatched(), {
    approving: { allowed: true, folder: 'demo', command: 'pxsig serve --link' },
    routes: planRoute,
  });
  try {
    await a.page.getByRole('button', { name: 'Repair baseline records' }).click();
    await a.page.getByRole('button', { name: 'Cancel' }).click();
    await a.page.getByRole('button', { name: 'Repair baseline records' }).waitFor();
    assert.equal(a.posts.filter((p) => p.name === 'record-repair').length, 0);
  } finally {
    await a.page.close();
  }
  const b = await open(mismatched(), {
    approving: { allowed: false, folder: 'demo', command: 'pxsig serve --link' },
    routes: planRoute,
  });
  try {
    const button = b.page.getByRole('button', { name: 'Repair baseline records' });
    await button.waitFor();
    assert.equal(await button.isDisabled(), true);
  } finally {
    await b.page.close();
  }
});
