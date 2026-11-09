/**
 * server-review-serialised.test.mjs — two approve decisions for different entries of one project,
 * sent at the same time (two tabs, or MCP and the dashboard), both end up in review.json: each
 * project's decisions run one after another (src/serve/serialise.mjs), so the later write never
 * drops the earlier decision. A failed decision does not hold up the next one.
 *
 *   node --test packages/pxsig/test/server-review-serialised.test.mjs
 *
 * Needs the Rust binary (the engine writes the baseline); skipped without it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { review } from '../src/serve/review.mjs';
import { serialise } from '../src/serve/serialise.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ReviewFile } from '../src/types/t5.js' */

test(
  'two overlapping approvals of one project are both kept in review.json',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async (t) => {
    const f = fixture({ t });
    const app = createPxsigServer({
      ws: findWorkspace({ cwd: f.repo }),
      flags: {},
      port: 0,
      open: false,
    });
    try {
      await app.start();
      const { srv } = app;
      const S = [...srv.states.values()][0];
      await S.integrityDone;
      const ids = [f.ids.a11y, f.ids.changed];
      const entries = await Promise.all(
        ids.map((id) => review(srv, S, 'approve', id, { via: 'dashboard' }))
      );
      assert.deepEqual(
        entries.map((e) => e?.state),
        ['approved', 'approved']
      );
      const rv = /** @type {ReviewFile} */ (JSON.parse(readFileSync(S.reviewPath, 'utf8')));
      for (const id of ids) assert.equal(rv[id]?.state, 'approved', `${id} kept in review.json`);
      assert.notEqual(rv[ids[0]]?.ref, rv[ids[1]]?.ref);
      assert.equal(S.reviewPath, join(f.px, 'reports', 'review.json'));
    } finally {
      await app.stop();
    }
  }
);

test('serialise runs one key in order; a failure does not block the next call', async () => {
  /** @type {string[]} */
  const order = [];
  /** @param {number} ms */
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = serialise('p', async () => (await later(20), order.push('a'), 'a'));
  const b = serialise('p', async () => {
    order.push('b');
    throw new Error('b failed');
  });
  const c = serialise('p', async () => (order.push('c'), 'c'));
  // Another key does not wait for this one.
  const other = serialise('q', async () => (order.push('q'), 'q'));
  assert.equal(await other, 'q');
  assert.equal(await a, 'a');
  await assert.rejects(b, /b failed/);
  assert.equal(await c, 'c');
  assert.deepEqual(order, ['q', 'a', 'b', 'c']);
});
