/**
 * The coverage block (the banner, and the Overview's errors card that carries it) in a real
 * browser, against a mocked server (flows-helpers.mjs): it shows for errors, setup warnings and a
 * safe repair to run, never for info findings or changed entries alone; its headline counts
 * integrity and setup findings by severity; "Run safe repairs" shows only when the server's plan
 * has steps, with their entry count; "View components" only when entries have findings; and the
 * block is a named region, never role="alert". Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, entry, inComponent, row, spread } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const changedIssue = { code: 'changed', severity: 'warn', reason: 'gate failed' };
const drift = { code: 'drift', severity: 'info', reason: 'passes, differs' };
const legacyLines = {
  code: 'log-legacy-personal',
  severity: 'info',
  reason: '4 lines of approvals.ndjson written before 0.7.6 carry a reason',
};
const envMismatch = {
  code: 'env-mismatch',
  severity: 'warn',
  reason: '2 entries were rendered in a different environment than their baseline',
};
const driftHigh = {
  code: 'drift-high',
  severity: 'warn',
  reason: '2 of 6 passing entries differ from their baseline',
};

/** Changed entries in three components, drifting ones, and the given setup findings and plan. */
function reviewWork(setup, repair = { entries: 0, steps: [] }) {
  const ids = ['ui-a--one', 'ui-b--one', 'ui-c--one', 'ui-c--two'];
  const d = spread(
    data({
      rows: ids.map((id) => row(id)),
      entries: [
        inComponent('A', ids[0], [changedIssue]),
        inComponent('B', ids[1], [changedIssue]),
        inComponent('C', ids[2], [changedIssue]),
        inComponent('C', ids[3], [drift]),
      ],
    })
  );
  d.integrity.setup = setup;
  d.repair = repair;
  return d;
}

const coverage = (page) => page.getByRole('region', { name: 'Coverage' });
const repairButton = (page) => page.getByRole('button', { name: /^Run safe repairs/ });

test('info findings and changed entries alone show no block, on any section', async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(reviewWork([legacyLines]), { hash: '#stories' });
  try {
    await page.getByRole('heading', { name: 'Review Stories' }).waitFor();
    assert.equal(await coverage(page).count(), 0, 'Review Stories: no block');
    await page.getByRole('link', { name: /^Overview/ }).click();
    await page.getByRole('heading', { name: 'Open Items' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Errors', exact: true }).count(), 0);
    assert.equal(await coverage(page).count(), 0, 'Overview: no block either');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('setup warnings: the headline counts them by severity, never the changed entries; an empty plan has no repair button; no "View components"', async (t) => {
  if (skip) return t.skip(skip);
  const d = reviewWork([legacyLines, envMismatch, driftHigh]);
  const { page, errors } = await open(d, { hash: '#stories' });
  try {
    await coverage(page).waitFor();
    const text = await coverage(page).innerText();
    assert.match(
      text,
      /^No errors · 2 warnings/,
      'two setup warnings; the info one is not counted'
    );
    assert.doesNotMatch(text, /components? with warnings/);
    assert.match(text, /Older log lines with reasons · 4 lines/, 'the info finding is titled');
    assert.equal(await repairButton(page).count(), 0, 'nothing a repair could do');
    assert.equal(await page.getByRole('button', { name: 'View components' }).count(), 0);
    assert.equal(await page.locator('[role="alert"]').count(), 0, 'a region, not an alert');
    // The Overview: the same findings in its errors card.
    await page.getByRole('link', { name: /^Overview/ }).click();
    await page.getByRole('heading', { name: 'Errors', exact: true }).waitFor();
    assert.equal(await coverage(page).count(), 0, 'the card carries them on the Overview');
    assert.equal(await repairButton(page).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('a plan with steps: "Run safe repairs · N entries", also for warnings (a missing render), and it posts the repair', async (t) => {
  if (skip) return t.skip(skip);
  const missing = { code: 'missing-render', severity: 'warn', reason: 'no latest render' };
  const d = spread(
    data({
      rows: [],
      entries: [entry('ui-button--a', [missing]), entry('ui-button--b', [missing])],
    })
  );
  d.repair = { entries: 2, steps: [{ action: 'recheck', count: 2 }] };
  const { page, posts, errors } = await open(d, {
    hash: '#stories',
    answers: { repair: { plan: { steps: [] }, applied: [] } },
  });
  try {
    await coverage(page).waitFor();
    assert.match(await coverage(page).innerText(), /^No errors · 2 warnings/);
    await page.getByRole('button', { name: 'View components' }).waitFor();
    await repairButton(page).click();
    await page.getByText('No issues can be repaired automatically.').waitFor();
    assert.equal(await repairButton(page).innerText(), 'Run safe repairs · 2 entries');
    assert.deepEqual(
      posts.filter((p) => p.name === 'repair').map((p) => p.body?.apply),
      [true]
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('errors: the headline counts errors and warnings, then each error code; the plan names one entry', async (t) => {
  if (skip) return t.skip(skip);
  const stale = { code: 'stale', severity: 'warn', reason: 'edited after the verdict' };
  const d = spread(
    data({
      rows: [row('ui-button--ok')],
      entries: [
        entry('ui-button--ok', [stale]),
        inComponent('Card', 'ui-card--broken', [
          { code: 'never-checked', severity: 'error', reason: 'no verdict' },
        ]),
      ],
    })
  );
  d.repair = { entries: 1, steps: [{ action: 'recheck', count: 1 }] };
  const { page, errors } = await open(d, { hash: '#help' });
  try {
    await coverage(page).waitFor();
    assert.match(await coverage(page).innerText(), /^1 error · 1 warning · Never checked: 1/);
    assert.equal(await repairButton(page).innerText(), 'Run safe repairs · 1 entry');
    // With the same ledger and no plan (a static scan blocks the step): no button.
    d.repair = { entries: 0, steps: [] };
    const second = await open(d, { hash: '#help' });
    try {
      await coverage(second.page).waitFor();
      assert.equal(await repairButton(second.page).count(), 0);
    } finally {
      await second.page.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('read only (no dashboard link): no repair button; the note names the step, as the inspector does for approving', async (t) => {
  if (skip) return t.skip(skip);
  const never = { code: 'never-checked', severity: 'error', reason: 'no verdict' };
  const d = data({ rows: [], entries: [entry('ui-button--a', [never])] });
  d.repair = { entries: 1, steps: [{ action: 'recheck', count: 1 }] };
  const command = 'pnpm exec pxsig serve --link';
  for (const allowed of [false, true]) {
    const { page, errors } = await open(d, {
      hash: '#help',
      approving: { allowed, folder: 'demo', command },
    });
    try {
      await coverage(page).waitFor();
      // The status answer arrives after the data: wait for what it decides.
      await (
        allowed ? repairButton(page) : page.getByText(/repairs need the dashboard link/)
      ).waitFor();
      const text = await coverage(page).innerText();
      if (allowed) {
        assert.equal(await repairButton(page).innerText(), 'Run safe repairs · 1 entry');
        assert.doesNotMatch(text, /repairs need the dashboard link/);
      } else {
        assert.equal(await repairButton(page).count(), 0, 'read only: no button');
        assert.match(
          text,
          /Read only: repairs need the dashboard link\. In a terminal, in the demo folder \(where pxsig serve runs\):/
        );
        assert.match(text, /pnpm exec pxsig serve --link/);
        assert.match(text, /5 minutes to access the link; it works once\./);
        assert.doesNotMatch(text, /Safe repairs register new stories/);
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});
