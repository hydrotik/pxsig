/**
 * record-repair-undo.test.mjs — undoing a record repair (`pxsig approve undo <batch>`) puts the
 * entry back in pxsig migrate's queue (`by: migrate`), as the repair kept it there; the undo of any
 * other batch keeps its state as before (the undo line wrote the bytes).
 *
 *   node --test packages/pxsig/test/record-repair-undo.test.mjs
 */
import assert from 'node:assert/strict';

import { test } from 'node:test';
import { applyRecordRepair, planRecordRepair } from '../src/lib/approvals/record-repair.mjs';
import { readLog, record, sha256, undo } from '../src/lib/approvals.mjs';
import { reviewState } from '../src/lib/integrity/unreviewed.mjs';
import { hasRust } from './fixture.mjs';
import { DOT, f0, store } from './record-repair-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ApprovalLine } from '../src/types.js' */

test(
  'the undo of a record repair restores migrate queued state',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  (t) => {
    const { f, P, manifest } = store(t, { [f0('ok')]: { record: DOT } });
    const id = f.ids.ok;
    const migrated = sha256(f.sig(id));
    const { batch } = applyRecordRepair(P, manifest, planRecordRepair(P, manifest).eligible, {
      via: 'cli',
    });
    const entry = manifest.stories.find((e) => e.id === id);
    const before = sha256(f.sig(id));
    const res = undo(P, manifest, String(batch));
    assert.deepEqual(res.restored, [id]);
    // The line `pxsig approve undo` writes (approve/log.mjs).
    record(P, /** @type {NonNullable<typeof entry>} */ (entry), {
      batch: `${batch}-undo`,
      via: 'undo',
      undo: { in: 'terminal', from: 'snapshot' },
      before,
    });
    assert.equal(sha256(f.sig(id)), migrated, 'the migrated bytes are back');
    const lines = readLog(P).filter((l) => l.id === id);
    assert.deepEqual(reviewState(lines, String(migrated)), {
      reviewed: false,
      new: false,
      by: 'migrate',
    });
  }
);

test('the undo of any other batch is the line that wrote the bytes, as before', () => {
  /** @param {Partial<ApprovalLine>} l @returns {ApprovalLine} */
  const line = (l) => ({
    at: '2026-11-01T00:00:00.000Z',
    id: 'a--b',
    via: 'cli',
    batch: 'x',
    ...l,
  });
  const lines = [
    line({ via: 'migrate', batch: 'migrate-1', after: 'A', pxsig: '0.7.6' }),
    line({
      via: 'check-update',
      batch: 'b2-check-update',
      before: 'A',
      after: 'B',
      pxsig: '0.7.7',
    }),
    line({
      via: 'undo',
      batch: 'b2-check-update-undo',
      undo: { in: 'terminal', from: 'snapshot' },
      before: 'B',
      after: 'A',
      pxsig: '0.7.7',
    }),
  ];
  assert.deepEqual(reviewState(lines, 'A'), { reviewed: false, new: true, by: 'undo' });
  // The same lines with the middle one a record repair: migrate's state.
  lines[1] = { ...lines[1], kind: 'record-repair', via: 'cli' };
  assert.deepEqual(reviewState(lines, 'A'), { reviewed: false, new: false, by: 'migrate' });
});
