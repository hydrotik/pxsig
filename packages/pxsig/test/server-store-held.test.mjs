/**
 * server-store-held.test.mjs — `storeHeld` in `GET /__pxsig/data`: whether this server holds the
 * store lock, so the dashboard offers the safe repair only where it would run. A boolean, nothing
 * about the process that holds it.
 *
 *   node --test packages/pxsig/test/server-store-held.test.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, hasRust } from './fixture.mjs';
import { raw, serve } from './guard-helpers.mjs';
import { skipUnless } from './strict.mjs';

const skip = skipUnless(hasRust, 'Rust binary not built');

/** @param {number} port */
const dataOf = async (port) => {
  const r = await raw(port, { method: 'GET', path: '/__pxsig/data' });
  assert.equal(r.status, 200, r.text);
  return /** @type {Record<string, unknown>} */ (r.json());
};

test('the lock holder says storeHeld: true', { skip }, async () => {
  const S = await serve(fixture());
  try {
    assert.equal((await dataOf(S.port)).storeHeld, true);
  } finally {
    await S.stop();
  }
});

test(
  'beside another process holding the store, storeHeld: false and a repair is refused',
  { skip },
  async () => {
    const f = fixture();
    writeFileSync(
      join(f.px, 'reports', '.lock'),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), holder: 'serve', command: 'pxsig serve', url: 'http://127.0.0.1:1' })}\n`
    );
    const S = await serve(f);
    try {
      const d = await dataOf(S.port);
      assert.equal(d.storeHeld, false);
      // A boolean only: no pid, host or path of the holder.
      assert.equal(typeof d.storeHeld, 'boolean');
      const r = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/repair',
        body: { apply: true },
      });
      assert.equal(r.status, 409, r.text);
    } finally {
      await S.stop();
    }
  }
);
