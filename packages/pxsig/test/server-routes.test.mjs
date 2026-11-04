/**
 * server-routes.test.mjs — how `pxsig serve` dispatches `/__pxsig/<action>`, from a server on a
 * fixture project in a temp dir: which methods each kind of route answers, where an unknown
 * action ends up, the `/api/integrity` alias and the CORS answer to a preflight.
 *
 *   node --test packages/pxsig/test/server-routes.test.mjs
 *
 * These pin today's answers, quirks included (a GET of an unknown action is 405 "POST only"; an
 * unknown POST action is checked like a decision's id), so moving the server's code changes none
 * of them. Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readToken } from '../src/lib/guard.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { raw, serve } from './guard-helpers.mjs';
import { skipUnless } from './strict.mjs';

const skip = skipUnless(hasRust, 'Rust binary not built');
/** The fixture's storybook.url: the one origin besides the server's own that may write checks. */
const STORYBOOK = 'http://127.0.0.1:1';

test('/api/integrity answers what /__pxsig/integrity answers', { skip }, async () => {
  const f = fixture();
  const S = await serve(f);
  try {
    for (const q of ['', `?story=${f.ids.ok}`, '?status=ok']) {
      const a = await raw(S.port, { path: `/api/integrity${q}` });
      const b = await raw(S.port, { path: `/__pxsig/integrity${q}` });
      assert.equal(a.status, 200, `${q}: ${a.text.slice(0, 300)}`);
      assert.equal(b.status, 200, q);
      assert.deepEqual(a.json(), b.json(), q);
    }
  } finally {
    await S.stop();
  }
});

test(
  'dispatch: status and projects answer any method; GET of an unknown action is 405 after the project is picked; other methods are 405',
  { skip },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const r = await raw(S.port, { method, path: '/__pxsig/status' });
        assert.equal(r.status, 200, `${method} /__pxsig/status`);
        assert.equal(r.json().served, true, method);
        const p = await raw(S.port, { method, path: '/__pxsig/projects' });
        assert.equal(p.status, 200, `${method} /__pxsig/projects`);
      }
      const nope = await raw(S.port, { path: '/__pxsig/nope' });
      assert.equal(nope.status, 405);
      assert.deepEqual(nope.json(), { error: 'POST only' });
      // The project is picked before the method is refused: an unknown one is a 404 first.
      const named = await raw(S.port, { path: '/__pxsig/nope?project=zz' });
      assert.equal(named.status, 404);
      assert.deepEqual(named.json(), { error: 'no project "zz" (projects: fixture)' });
      // A POST action read with GET is the same 405.
      for (const action of ['check', 'approve', 'repair', 'session'])
        assert.equal((await raw(S.port, { path: `/__pxsig/${action}` })).status, 405, action);
      for (const action of ['data', 'integrity', 'check', 'nope']) {
        const r = await raw(S.port, { method: 'PUT', path: `/__pxsig/${action}` });
        assert.equal(r.status, 405, `PUT ${action}`);
        assert.deepEqual(r.json(), { error: 'POST only' }, `PUT ${action}`);
      }
    } finally {
      await S.stop();
    }
  }
);

test(
  'an unknown POST action passes the origin check, needs no token, reads its body and is 400 "bad id", or 404 "unknown action" with a valid id',
  { skip },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      const token = /** @type {string} */ (readToken(f.repo, S.url));
      const post = (/** @type {unknown} */ body, headers = {}) =>
        raw(S.port, { method: 'POST', path: '/__pxsig/nope', headers, body });
      for (const headers of [{}, { 'x-pxsig-token': token }]) {
        const tag = Object.keys(headers).length ? 'with the token' : 'without a token';
        for (const body of [{}, { id: 'Not An Id' }, { id: 42 }]) {
          const r = await post(body, headers);
          assert.equal(r.status, 400, `${tag}, ${JSON.stringify(body)}`);
          assert.deepEqual(r.json(), { error: 'bad id' });
        }
        const r = await post({ id: f.ids.ok }, headers);
        assert.equal(r.status, 404, tag);
        assert.deepEqual(r.json(), { error: 'unknown action' });
      }
      // The origin is checked before the body is read.
      const cross = await post({ id: f.ids.ok }, { origin: 'http://elsewhere.test' });
      assert.equal(cross.status, 403);
      assert.equal(cross.json().error, 'cross-origin');
      // A project's Storybook may post what is not a decision: on to the same 404.
      const sb = await post({ id: f.ids.ok }, { origin: STORYBOOK });
      assert.equal(sb.status, 404);
      // The project is picked from the body before the id is read.
      const other = await post({ project: 'zz' });
      assert.equal(other.status, 404);
      assert.deepEqual(other.json(), { error: 'no project "zz" (projects: fixture)' });
    } finally {
      await S.stop();
    }
  }
);

test(
  'an unknown POST action with a valid id is 409 on a read-only server (another process holds the lock)',
  { skip },
  async () => {
    const f = fixture();
    writeFileSync(
      join(f.px, 'reports', '.lock'),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), holder: 'serve', command: 'pxsig serve', url: 'http://127.0.0.1:1' })}\n`
    );
    const S = await serve(f);
    try {
      const post = (/** @type {unknown} */ body) =>
        raw(S.port, { method: 'POST', path: '/__pxsig/nope', body });
      const bad = await post({});
      assert.equal(bad.status, 400, 'the id is read before the lock');
      assert.deepEqual(bad.json(), { error: 'bad id' });
      const r = await post({ id: f.ids.ok });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json().error, /: this project is read-only until it is free$/);
    } finally {
      await S.stop();
    }
  }
);

test(
  "OPTIONS from a project's Storybook answers 204 with the CORS headers; from another origin, 204 without them",
  { skip },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      for (const path of ['/__pxsig/check', '/__pxsig/nope', '/report/']) {
        const r = await raw(S.port, { method: 'OPTIONS', path, headers: { origin: STORYBOOK } });
        assert.equal(r.status, 204, path);
        assert.equal(r.headers['access-control-allow-origin'], STORYBOOK, path);
        assert.equal(r.headers['access-control-allow-methods'], 'GET, POST, OPTIONS', path);
        assert.equal(r.headers['access-control-allow-headers'], 'content-type', path);
        assert.equal(r.headers.vary, 'origin', path);
        assert.equal(r.text, '', path);
        const other = await raw(S.port, {
          method: 'OPTIONS',
          path,
          headers: { origin: 'http://elsewhere.test' },
        });
        assert.equal(other.status, 204, path);
        for (const h of ['allow-origin', 'allow-methods', 'allow-headers'])
          assert.equal(other.headers[`access-control-${h}`], undefined, `${path}: ${h}`);
        assert.equal(other.headers.vary, undefined, path);
      }
      // A GET from the Storybook carries the CORS headers too; one with no origin does not.
      const get = await raw(S.port, { path: '/__pxsig/status', headers: { origin: STORYBOOK } });
      assert.equal(get.headers['access-control-allow-origin'], STORYBOOK);
      const plain = await raw(S.port, { path: '/__pxsig/status' });
      assert.equal(plain.headers['access-control-allow-origin'], undefined);
    } finally {
      await S.stop();
    }
  }
);
