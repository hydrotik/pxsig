/**
 * examples-verdicts.test.mjs — examples-test.mjs's first check counts only NEW rows as NEW.
 *
 *   node --test scripts/examples-verdicts.test.mjs
 *
 * The rows come from check's own row builder (lib/rows.mjs), as a first check on a fresh store
 * writes them: no baseline yet, and one render that failed (Windows CI, 2026-11-04: the failure
 * surfaced one step later as "PNG not found" in baselineAll, without the render's error).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRow } from '../packages/pxsig/src/lib/rows.mjs';
import { notNew } from './examples/verdicts.mjs';

const noSig = { error: 'no baseline sig for this entry' };
/**
 * @param {string} id
 * @param {string} [error] the render's error
 */
const row = (id, error) =>
  buildRow({ id }, noSig, { ms: 1, ...(error ? { error } : {}) }, null, {});

test('a first check whose renders all worked is all NEW', () => {
  assert.deepEqual(notNew([row('a--one'), row('a--two')]), []);
});

test('a render error is not NEW, and the line carries its error', () => {
  const rows = [row('a--one'), row('a--two', 'page.goto: net::ERR_NO_BUFFER_SPACE at http://x')];
  // What the old assertion (`every row fails`) accepted.
  assert.ok(rows.every((x) => !x.pass));
  assert.deepEqual(notNew(rows), ['a--two: page.goto: net::ERR_NO_BUFFER_SPACE at http://x']);
});

test('a row that passed or changed is not NEW either', () => {
  const pass = buildRow({ id: 'a--p' }, { pass: true }, { ms: 1 }, null, {});
  const changed = buildRow({ id: 'a--c' }, { pass: false }, { ms: 1 }, null, {});
  assert.deepEqual(notNew([pass, changed]), ['a--p: passed', 'a--c: changed']);
});
