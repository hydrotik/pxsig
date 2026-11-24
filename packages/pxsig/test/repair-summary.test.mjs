/**
 * repair-summary.test.mjs — the dashboard's repair plan summary (lib/repair/summary.mjs): only the
 * steps that would act from the dashboard count, each entry once; the `integrity` event carries it,
 * recomputed from the ledger it sends; and the dashboard's sample data says what the server would.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../../dashboard/fixtures/scenarios.mjs';
import { repairSummary } from '../src/lib/repair.mjs';
import { integrityEvent } from '../src/serve/integrity.mjs';
/** @import { Ledger } from '../src/types/t3.js' */

/**
 * A ledger with these entries' codes and setup findings; Storybook running unless `source` says.
 * @param {Record<string, string[]>} codes entry id → its issue codes
 * @param {{ setup?: { code: string, severity: string, reason: string, count?: number }[], source?: string }} [o]
 * @returns {Ledger}
 */
function ledger(codes, { setup = [], source = 'storybook' } = {}) {
  return /** @type {Ledger} */ (
    /** @type {unknown} */ ({
      generatedAt: '2026-10-24T10:00:00.000Z',
      sources: { storyIndex: { source, inScope: 1 } },
      setup,
      entries: Object.entries(codes).map(([id, cs]) => ({
        id,
        files: { sig: `${id}.psig`, sigExists: true, baseImage: true, latestRender: true },
        issues: cs.map((code) => ({ code, severity: 'warn', reason: 'sample' })),
      })),
    })
  );
}
const none = { entries: 0, steps: [] };

test('no step for setup findings, review work or info: an empty plan', () => {
  const L = ledger(
    { a: ['changed'], b: ['drift'], c: ['unbaselined'], d: ['stale'], e: ['orphaned'] },
    {
      setup: [
        { code: 'log-legacy-personal', severity: 'info', reason: 'old lines' },
        { code: 'env-mismatch', severity: 'warn', reason: 'another machine' },
        { code: 'drift-high', severity: 'warn', reason: 'many differ' },
      ],
    }
  );
  assert.deepEqual(repairSummary(L), none);
});

test('a torn log is a person’s repair at a terminal: never counted', () => {
  const L = ledger(
    {},
    { setup: [{ code: 'log-torn', severity: 'warn', reason: 'cut short', count: 2 }] }
  );
  assert.deepEqual(repairSummary(L), none);
});

test('register is blocked without a running Storybook: nothing to run from the dashboard', () => {
  assert.deepEqual(repairSummary(ledger({ a: ['unregistered'] }, { source: 'static' })), none);
  assert.deepEqual(repairSummary(ledger({ a: ['unregistered'] })), {
    entries: 1,
    steps: [{ action: 'register', count: 1 }],
  });
});

test('warnings with a safe repair count: a missing render, a legacy baseline', () => {
  assert.deepEqual(repairSummary(ledger({ a: ['missing-render'], b: ['missing-render'] })), {
    entries: 2,
    steps: [{ action: 'recheck', count: 2 }],
  });
  // The legacy baseline is re-rendered first (its stale verdict), then converted: one entry.
  assert.deepEqual(repairSummary(ledger({ a: ['legacy-format', 'stale'] })), {
    entries: 1,
    steps: [
      { action: 'recheck', count: 1 },
      { action: 'convert-legacy', count: 1 },
    ],
  });
});

test('errors: each entry counted once over its steps', () => {
  const L = ledger({
    a: ['never-checked'],
    b: ['render-error'],
    c: ['missing-baseline-image', 'stale'],
  });
  assert.deepEqual(repairSummary(L), {
    entries: 3,
    steps: [
      { action: 'recheck', count: 3 },
      { action: 'restore-baseline-image', count: 1 },
    ],
  });
});

test('the integrity event carries the plan, recomputed from the ledger it sends', () => {
  const L = ledger({ a: ['never-checked'] });
  assert.deepEqual(integrityEvent('demo', L).repair, {
    entries: 1,
    steps: [{ action: 'recheck', count: 1 }],
  });
  // The entry repaired: the next ledger's event has no step, so the button goes.
  const after = ledger({ a: [] });
  const ev = integrityEvent('demo', after);
  assert.deepEqual(ev.repair, none);
  assert.equal(ev.project, 'demo');
  assert.equal(ev.setup, after.setup);
});

test("the dashboard's sample data: each scenario's plan is the server's for its ledger", () => {
  for (const [name, make] of Object.entries(SCENARIOS)) {
    const d = /** @type {{ integrity?: Ledger | null, repair?: unknown }} */ (make());
    if (!d.integrity) continue;
    assert.deepEqual(d.repair, repairSummary(d.integrity), name);
  }
});
