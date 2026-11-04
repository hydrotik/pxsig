/**
 * server-inprocess.test.mjs — the server imported rather than spawned: `createPxsigServer`
 * (src/serve/create.mjs) on a fixture project in a temp dir, on a free port (`port: 0`), with a
 * decision posted without the dashboard link's cookie or a token.
 *
 *   node --test packages/pxsig/test/server-inprocess.test.mjs
 *
 * Needs the Rust binary (the engine answers `start()`'s ping); skipped without it.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { NEEDS_LINK, NEEDS_PERSON } from '../src/lib/guard.mjs';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { raw } from './guard-helpers.mjs';
import { skipUnless } from './strict.mjs';

/**
 * Every file under `dir` and its bytes, but the store lock (its heartbeat rewrites it) and the
 * server's own record and token files under node_modules/.cache.
 * @param {string} dir
 */
function files(dir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const file = join(e.parentPath, e.name);
    const rel = relative(dir, file).split('\\').join('/');
    if (rel.startsWith('node_modules/.cache/') || rel.endsWith('reports/.lock')) continue;
    out.set(rel, readFileSync(file).toString('base64'));
  }
  return out;
}

test(
  'in process, on port 0: an approve without the link cookie or a token is 403 and changes no file',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const ws = findWorkspace({ cwd: f.repo });
    const app = createPxsigServer({ ws, flags: {}, port: 0, open: false });
    try {
      await app.start();
      const { srv } = app;
      assert.ok(srv.url, 'listening');
      const port = Number(new URL(srv.url).port);
      assert.ok(port > 0, `a free port, not 0: ${srv.url}`);
      // The startup integrity pass writes the ledger: let it finish before taking the picture.
      for (const S of srv.states.values()) await S.integrityDone;
      const before = files(f.repo);
      const id = f.ids.changed;
      // A script (no origin, no token), then the dashboard's own page opened without the link.
      for (const [headers, error] of /** @type {[Record<string, string>, string][]} */ ([
        [{}, NEEDS_PERSON],
        [{ origin: srv.url, 'sec-fetch-site': 'same-origin' }, NEEDS_LINK],
      ])) {
        const r = await raw(port, {
          method: 'POST',
          path: '/__pxsig/approve',
          headers,
          body: { id },
        });
        assert.equal(r.status, 403, r.text);
        assert.equal(r.json().error, error);
      }
      assert.deepEqual(files(f.repo), before, 'no file changed');
    } finally {
      await app.stop();
    }
  }
);
