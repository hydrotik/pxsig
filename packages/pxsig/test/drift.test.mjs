/**
 * drift.test.mjs — the drift alarm (lib/drift.mjs): which rows pass while their render differs from
 * the baseline, check.json's `summary.drift`, the `[check] drift:` line, the `drift-high` setup
 * warning and its severity floor, `drift.warnAt` and its limits, and the SARIF note.
 *
 *   node --test packages/pxsig/test/drift.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRIFT_LIMITS,
  DRIFT_WARN_AT,
  driftCell,
  driftLine,
  driftProblems,
  driftSummary,
  drifts,
  warnAt,
} from '../src/lib/drift.mjs';
import { reportProblems } from '../src/lib/integrity/problems.mjs';
import { sarifLog } from '../src/lib/sarif.mjs';
import { DEFAULTS } from '../src/lib/workspace/layers.mjs';
/** @import { CheckRow } from '../src/types.js' */

const schema = JSON.parse(readFileSync(new URL('../schema/project.json', import.meta.url), 'utf8'));
const ctx = /** @type {any} */ ({ integrity: {} });

/**
 * `n` passing rows, the first `differ` of them differing from their baseline.
 * @param {number} n
 * @param {number} differ
 * @param {Partial<CheckRow>} [extra]
 * @returns {CheckRow[]}
 */
const rows = (n, differ, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    pass: true,
    differs: i < differ,
    metrics: { ssim: 1 },
    envMatch: /** @type {const} */ ('same'),
    ...extra,
  }));

test('a row drifts when it passes while its pixels differ; older rows fall back to SSIM', () => {
  assert.equal(drifts({ pass: true, differs: true, metrics: { ssim: 1 } }), true);
  assert.equal(drifts({ pass: true, differs: false, metrics: { ssim: 0.999 } }), false);
  assert.equal(drifts({ pass: true, metrics: { ssim: 0.999 } }), true, 'an engine before 0.7.7');
  assert.equal(drifts({ pass: true, differs: null, metrics: { ssim: 1 } }), false);
  for (const r of [
    { pass: false, differs: true },
    { pass: true, differs: true, flaky: true },
    { pass: true, differs: true, skipped: true },
    { pass: true, differs: true, error: 'timeout' },
  ])
    assert.equal(drifts(r), false, JSON.stringify(r));
  assert.equal(drifts(null), false);
});

test('summary.drift counts the checked passing entries, other environments apart', () => {
  /** @type {Partial<CheckRow>[]} */
  const out = [
    ...rows(10, 3),
    ...rows(2, 2, { envMatch: 'mismatch' }),
    { id: 'f', pass: false, differs: null, metrics: { ssim: 0.9 } },
    { id: 's', pass: true, skipped: true, differs: true },
  ];
  assert.deepEqual(driftSummary(out).drift, {
    count: 3,
    of: 10,
    share: 0.3,
    otherEnv: 2,
    warnAt: DRIFT_WARN_AT,
    warn: false,
  });
  assert.equal(driftSummary([]).drift.share, 0);
});

test('drift-high warns on a #327-sized miss and stays quiet on same-content noise', () => {
  // The dashboard's own CI renders: same content, 7 to 12 of 162 passing entries differ (≤ 7.4%);
  // #327 under the gate before the color rule: 136 of 161 (84.5%).
  for (const n of [7, 9, 12]) assert.equal(driftSummary(rows(162, n)).drift.warn, false, `${n}`);
  const miss = driftSummary(rows(161, 136));
  assert.equal(miss.drift.warn, true);
  // A small project needs `count` too: 4 of 10 is 40%, under 5 entries.
  assert.equal(driftSummary(rows(10, 4)).drift.warn, false);
  assert.equal(driftSummary(rows(10, 5)).drift.warn, true);
  const [w, ...more] = driftProblems({ summary: miss }, ctx);
  assert.equal(more.length, 0);
  assert.equal(w.code, 'drift-high');
  assert.equal(w.severity, 'warn');
  assert.equal(w.count, 136);
  assert.match(
    w.reason,
    /^136 of 161 passing entries \(84\.5%\) pass while their render differs from the baseline, at or over drift\.warnAt: 5 entries and 20%\./
  );
  assert.deepEqual(driftProblems({ summary: driftSummary(rows(162, 12)) }, ctx), []);
  assert.deepEqual(driftProblems(null, ctx), []);
  assert.deepEqual(
    reportProblems(/** @type {any} */ ({ rows: [], summary: miss }), ctx).map((x) => x.code),
    ['drift-high'],
    'the ledger reads it from the report'
  );
});

test('drift-high is a warning at least: integrity.severity raises it, never lowers it', () => {
  const report = { summary: driftSummary(rows(20, 20)) };
  /** @param {string} severity */
  const at = (severity) =>
    driftProblems(report, { integrity: { severity: { 'drift-high': severity } } })[0];
  assert.equal(at('error').severity, 'error');
  assert.doesNotMatch(at('error').reason, /not applied/);
  for (const low of ['info', 'off']) {
    assert.equal(at(low).severity, 'warn', `${low}: never lowered`);
    assert.ok(
      at(low).reason.endsWith(
        `. integrity.severity sets drift-high to "${low}", which is not applied: it is a warning at least, and can only be raised to error`
      )
    );
  }
});

test('drift.warnAt: the built-in values, the schema limits, a value past one read as the limit', () => {
  assert.deepEqual(DEFAULTS.drift.warnAt, DRIFT_WARN_AT);
  const props = schema.properties.drift.properties.warnAt.properties;
  for (const k of /** @type {const} */ (['count', 'share'])) {
    assert.equal(props[k].maximum, DRIFT_LIMITS[k], `schema maximum of ${k}`);
    assert.equal(props[k].default, DRIFT_WARN_AT[k], `schema default of ${k}`);
  }
  assert.deepEqual(warnAt({}), DRIFT_WARN_AT);
  assert.deepEqual(warnAt({ drift: { warnAt: { count: 20, share: 0.1 } } }), {
    count: 20,
    share: 0.1,
  });
  assert.deepEqual(
    warnAt({ drift: { warnAt: { count: 1e6, share: 1 } } }),
    { count: 100, share: 0.5 },
    'never off'
  );
  assert.deepEqual(warnAt({ drift: { warnAt: { count: 0, share: -1 } } }), DRIFT_WARN_AT);
  const loose = driftSummary(rows(200, 120), warnAt({ drift: { warnAt: { share: 0.9 } } }));
  assert.equal(loose.drift.warn, true, '60% is over the 50% limit');
});

test('the check line, the doctor cell and the SARIF note', () => {
  const quiet = driftSummary([...rows(162, 12), ...rows(2, 2, { envMatch: 'mismatch' })]).drift;
  assert.equal(
    driftLine(quiet),
    'drift: 12 of 162 passing entries (7.4%) differ from their baseline, within the gate; 2 more rendered in a different environment → pxsig list drift'
  );
  const loud = driftSummary(rows(161, 136)).drift;
  assert.equal(
    driftLine(loud),
    'drift: 136 of 161 passing entries (84.5%) differ from their baseline, at or over drift.warnAt: 5 entries and 20%: a change the gate does not see passes this way → pxsig list drift'
  );
  assert.equal(driftLine(driftSummary(rows(3, 0)).drift), null);
  assert.equal(driftCell(null), 'no report');
  assert.equal(driftCell(driftSummary(rows(3, 0)).drift), 'none of 3 passing entries');
  assert.match(driftCell(loud), /^136 of 161 passing entries/);

  const log = sarifLog(rows(161, 136), { drift: loud });
  const results = log.runs[0].results;
  assert.equal(results.length, 1, 'one note for the run, none per entry');
  assert.equal(results[0].ruleId, 'pxsig/drift');
  assert.equal(results[0].level, 'note');
  assert.match(results[0].message.text, /^136 of 161 passing entries \(84\.5%\) differ/);
  assert.deepEqual(
    log.runs[0].tool.driver.rules.map((r) => r.id),
    ['pxsig/drift']
  );
  assert.equal(
    sarifLog(rows(3, 0), { drift: driftSummary(rows(3, 0)).drift }).runs[0].results.length,
    0
  );
  assert.equal(sarifLog(rows(161, 136)).runs[0].results.length, 0, 'without the option');
});
