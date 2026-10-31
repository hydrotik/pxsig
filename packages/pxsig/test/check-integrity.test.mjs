/**
 * check-integrity.test.mjs — the integrity line `pxsig check` ends with: the doctor's headline, or
 * why there is none. No Rust, no server.
 *
 *   node --test packages/pxsig/test/check-integrity.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integrityOf } from '../src/cli/check.mjs';

/** @typedef {Parameters<typeof integrityOf>[0]} Reconcile */

test('the doctor headline is the integrity line, "bad" when it needs attention', async () => {
  const ledger = { summary: { headline: '3 components need attention', status: 'attention' } };
  const r = await integrityOf(/** @type {Reconcile} */ (async () => ledger));
  assert.equal(r.ledger, ledger);
  assert.equal(r.unavailable, null);
  assert.deepEqual(r.block, { note: 'integrity: 3 components need attention', tone: 'bad' });
});

test('a doctor that throws is named, not dropped', async () => {
  const r = await integrityOf(async () => {
    throw new Error('check.json: Unexpected end of JSON input\n    at JSON.parse');
  });
  assert.equal(r.ledger, null);
  assert.equal(r.unavailable, 'check.json: Unexpected end of JSON input');
  assert.deepEqual(r.block, {
    note: 'integrity: unavailable (check.json: Unexpected end of JSON input)',
    tone: 'warn',
  });
  const blank = await integrityOf(async () => {
    throw new Error('');
  });
  assert.equal(blank.block.note, 'integrity: unavailable (no reason given)');
});
