/**
 * server-lifecycle.test.mjs — `pxsig serve` beside a running lock holder, and stopping it with
 * SIGTERM, on fixture projects in temp dirs.
 *
 *   node --test packages/pxsig/test/server-lifecycle.test.mjs
 *
 * Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fixture, hasRust, rustBin } from './fixture.mjs';
import { src, freePort, serve } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

test(
  'a second server beside the lock holder writes nothing into the store, and leaves the running server on record',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const reports = join(f.px, 'reports');
    writeFileSync(
      join(reports, '.lock'),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), holder: 'serve', command: 'pxsig serve', url: 'http://127.0.0.1:1' })}\n`
    );
    const info = join(f.repo, 'node_modules', '.cache', 'pxsig', 'server.json');
    mkdirSync(dirname(info), { recursive: true });
    const record = `${JSON.stringify({ url: 'http://127.0.0.1:1', pid: process.pid, startedAt: new Date().toISOString(), projects: ['fixture'] })}\n`;
    writeFileSync(info, record);
    const before = readdirSync(reports).sort();
    const S = await serve(f);
    try {
      const r = await fetch(`${S.base}/__pxsig/integrity?fresh=1`);
      assert.equal(r.status, 200, 'the ledger is computed and served from memory');
      // GET /__pxsig/integrity answers the ledger as JSON.
      assert.ok(/** @type {{ entries: unknown[] }} */ (await r.json()).entries.length);
      assert.deepEqual(
        readdirSync(reports).sort(),
        before,
        `nothing new in the store's reports (no integrity.json, no .run/):\n${S.log()}`
      );
      assert.equal(
        readFileSync(info, 'utf8'),
        record,
        'server.json still names the running server'
      );
      assert.equal((await S.post('check', { ids: [f.ids.ok] })).status, 409, 'writes are refused');
    } finally {
      S.stop();
    }
  }
);

test(
  'stopping `pxsig serve` with SIGTERM stops the server it started, not only the wrapper',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const port = await freePort();
    const proc = spawn(
      process.execPath,
      [join(src, '..', 'bin', 'pxsig.mjs'), 'serve', '--port', String(port), '--no-open'],
      { cwd: f.repo, env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
    );
    let log = '';
    proc.stdout.on('data', (d) => (log += d));
    await /** @type {Promise<void>} */ (
      new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
        proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
      })
    );
    assert.equal((await fetch(`http://127.0.0.1:${port}/__pxsig/status`)).status, 200);
    const exited = new Promise((ok) => proc.on('exit', ok));
    proc.kill('SIGTERM');
    await exited;
    let up = true;
    for (let i = 0; i < 50 && up; i++) {
      up = await fetch(`http://127.0.0.1:${port}/__pxsig/status`).then(
        () => true,
        () => false
      );
      if (up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(up, false, 'the server stopped with its wrapper');
    // On Windows, kill() terminates without the server's shutdown, so the lock stays behind with a
    // pid that is gone; platform.test.mjs checks that the next serve takes it over.
    if (process.platform !== 'win32')
      assert.ok(!existsSync(join(f.px, 'reports', '.lock')), 'and released the store lock');
  }
);
