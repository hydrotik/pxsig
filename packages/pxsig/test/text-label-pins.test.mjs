/**
 * text-label-pins.test.mjs — text labels (a row's `textDiff`, text-aware diffs PR 4) are labels
 * only: the SARIF log, the run's summary counts (the exit code's input) and each entry's state
 * (what the dashboard, the CLI and MCP list it as) are the same for rows with and without them.
 * No Rust, no server.
 *
 *   node --test packages/pxsig/test/text-label-pins.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sarifLog } from '../src/lib/sarif.mjs';
import { summarize } from '../src/lib/rows.mjs';
import { stateOf } from '../src/tools/context.mjs';

/** @import { CheckRow } from '../src/types.js' */

const counts = { runs: 4, copy: 1, moved: 1, rewrapped: 0, restyled: 0, added: 0, removed: 0 };
/** One label per row: a copy change, an environment that differs, a pixel change, none, an error. */
const LABELS = [
  {
    v: 1,
    state: 'compared',
    kind: 'copy-reflow',
    kinds: ['copy', 'moved'],
    counts,
    outsidePx: 0,
    insidePx: 80,
    elementPx: 0,
    changes: [],
    changeCount: 2,
  },
  { v: 1, state: 'env-differs' },
  {
    v: 1,
    state: 'compared',
    kind: 'pixel',
    kinds: [],
    counts: { ...counts, copy: 0, moved: 0 },
    outsidePx: 9,
    insidePx: 0,
    elementPx: 0,
    changes: [],
    changeCount: 0,
  },
  { v: 1, state: 'no-baseline' },
  { v: 1, state: 'error', error: 'the baseline text record: not a text record' },
];

/**
 * Rows in every state a check gives, with or without text labels.
 * @param {boolean} text
 * @returns {CheckRow[]}
 */
function rows(text) {
  const a11y = {
    violations: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', nodes: 1 }],
    new: 1,
  };
  const base = [
    { id: 'a--changed@dark', pass: false, changed: true, reasons: ['ssim 0.9 < min 0.99'], a11y },
    { id: 'a--pass@dark', pass: true, metrics: { ssim: 1 } },
    { id: 'a--drift@dark', pass: true, metrics: { ssim: 0.995 } },
    { id: 'a--flaky@dark', pass: true, flaky: true },
    { id: 'a--new@dark', pass: false, new: true },
    { id: 'a--error@dark', pass: false, error: 'locator.click: Timeout' },
  ];
  return /** @type {CheckRow[]} */ (
    /** @type {unknown} */ (
      base.map((r, i) => ({
        mode: 'dark',
        ...r,
        ...(text && i < LABELS.length ? { textDiff: LABELS[i] } : {}),
      }))
    )
  );
}

test('the SARIF log is the same with and without text labels', () => {
  assert.deepEqual(sarifLog(rows(true)), sarifLog(rows(false)));
});

test('the summary counts (the exit code) are the same with and without text labels', () => {
  assert.deepEqual(summarize(rows(true)), summarize(rows(false)));
});

test('every entry keeps its state with text labels', () => {
  const state = (/** @type {CheckRow} */ r) => stateOf(r, {});
  assert.deepEqual(rows(true).map(state), rows(false).map(state));
});
