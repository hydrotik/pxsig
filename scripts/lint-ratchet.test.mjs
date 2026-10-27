import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countWarnings, lowered, regressions, total } from './lib/lint-ratchet.mjs';

const d = (filename, code, severity = 'warning') => ({ filename, code, severity });

test('counts warnings per file and rule, ignoring errors, with forward slashes', () => {
  const counts = countWarnings([d('a\\x.mjs', 'eslint(no-unused-vars)'), d('a/x.mjs', 'eslint(no-unused-vars)'), d('a/x.mjs', 'react(rules-of-hooks)', 'error')]);
  assert.deepEqual(counts, { 'a/x.mjs': { 'eslint(no-unused-vars)': 2 } });
  assert.equal(total(counts), 2);
});

test('a file that gains a warning of any rule is a regression; one that loses one is not', () => {
  const baseline = { 'a.mjs': { r1: 2 } };
  assert.deepEqual(regressions(baseline, { 'a.mjs': { r1: 1 } }), []);
  assert.deepEqual(regressions(baseline, { 'a.mjs': { r1: 2, r2: 1 } }), [{ file: 'a.mjs', rule: 'r2', allowed: 0, count: 1 }]);
  assert.deepEqual(regressions(baseline, { 'b.mjs': { r1: 1 } }), [{ file: 'b.mjs', rule: 'r1', allowed: 0, count: 1 }]);
});

test('lowering keeps only what is left and never raises a count', () => {
  const baseline = { 'a.mjs': { r1: 3, r2: 1 }, 'b.mjs': { r1: 1 } };
  assert.deepEqual(lowered(baseline, { 'a.mjs': { r1: 2, r3: 5 } }), { 'a.mjs': { r1: 2 } });
});
