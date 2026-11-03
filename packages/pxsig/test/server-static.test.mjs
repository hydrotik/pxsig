/**
 * server-static.test.mjs — the paths `pxsig serve` answers outside `/__pxsig/`, from a server on a
 * fixture project in a temp dir with a stand-in dashboard build: the `/` redirect, the dashboard's
 * files (`/report/…`, HEAD included), and a project's files (`/p/<project>/…`: renders, baseline
 * images out of the `.psig`, signature headers), with paths that try to leave their folder.
 *
 *   node --test packages/pxsig/test/server-static.test.mjs
 *
 * These pin today's answers, so moving the server's code changes none of them. Needs the Rust
 * binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readHeader, readImage } from '../src/lib/psig.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { dashboardDir, raw, serve } from './guard-helpers.mjs';
import { skipUnless } from './strict.mjs';

const skip = skipUnless(hasRust, 'Rust binary not built');
const ASSET = 'console.log("pxsig");\n';

/** The fixture served with a stand-in dashboard that has one script besides its page. */
async function start() {
  const f = fixture();
  const dash = dashboardDir();
  writeFileSync(join(dash, 'app.js'), ASSET);
  const S = await serve(f, { PXSIG_DASHBOARD_DIR: dash });
  return { f, S };
}

test(
  '/ redirects to /report/; the dashboard is served, HEAD without a body, and no path leaves its folder',
  { skip },
  async () => {
    const { S } = await start();
    try {
      const home = await raw(S.port, { path: '/' });
      assert.equal(home.status, 302);
      assert.equal(home.headers.location, '/report/');
      const page = await raw(S.port, { path: '/report/' });
      assert.equal(page.status, 200);
      assert.match(page.text, /<title>pxsig<\/title>/);
      assert.equal(page.headers['cache-control'], 'no-store');

      const get = await raw(S.port, { path: '/report/app.js' });
      assert.equal(get.status, 200);
      assert.equal(get.text, ASSET);
      assert.equal(get.headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal(get.headers['cache-control'], 'no-cache');
      assert.equal(get.headers['x-content-type-options'], 'nosniff');
      const head = await raw(S.port, { method: 'HEAD', path: '/report/app.js' });
      assert.equal(head.status, 200);
      assert.equal(head.text, '', 'HEAD has no body');
      assert.equal(head.headers['content-length'], String(Buffer.byteLength(ASSET)));
      assert.equal(head.headers['content-type'], get.headers['content-type']);

      // `..` written out is resolved by the URL parser first: `/report/../x` is `/x`.
      const dots = await raw(S.port, { path: '/report/../x' });
      assert.equal(dots.status, 404);
      assert.deepEqual(dots.json(), { error: 'not found' });
      // Encoded, it reaches the dashboard's handler, which refuses it.
      for (const path of ['/report/..%2Fx', '/report/..%2F..%2Fpackage.json']) {
        const r = await raw(S.port, { path });
        assert.equal(r.status, 403, path);
        assert.deepEqual(r.json(), { error: 'outside root' }, path);
      }
      const missing = await raw(S.port, { path: '/report/nope.js' });
      assert.equal(missing.status, 404);
      assert.deepEqual(missing.json(), { error: 'not found' });
    } finally {
      await S.stop();
    }
  }
);

test(
  "/p/<project>/: renders, the baseline image out of the .psig and its header; paths outside the project's folders are 404",
  { skip },
  async () => {
    const { f, S } = await start();
    const { ok } = f.ids;
    try {
      const latest = await raw(S.port, { path: `/p/fixture/renders/latest/${ok}.png` });
      assert.equal(latest.status, 200);
      assert.equal(latest.headers['content-type'], 'image/png');
      assert.equal(
        latest.headers['content-length'],
        String(readFileSync(f.latest(ok)).length),
        'the latest render, as written'
      );

      const base = await fetch(`${S.url}/p/fixture/renders/base/${ok}.png`);
      assert.equal(base.status, 200);
      assert.equal(base.headers.get('content-type'), 'image/png');
      assert.equal(base.headers.get('cache-control'), 'no-cache');
      const image = /** @type {Buffer} */ (readImage(f.sig(ok)));
      assert.ok(image, 'the fixture packed an image into the baseline');
      assert.deepEqual(Buffer.from(await base.arrayBuffer()), image, 'the image section, as is');
      const baseHead = await raw(S.port, {
        method: 'HEAD',
        path: `/p/fixture/renders/base/${ok}.png`,
      });
      assert.equal(baseHead.status, 200);
      assert.equal(baseHead.text, '');
      assert.equal(baseHead.headers['content-length'], String(image.length));
      // A baseline packed without its image, and an id with no entry.
      for (const id of [f.ids.restorable, 'components-nope--x']) {
        const r = await raw(S.port, { path: `/p/fixture/renders/base/${id}.png` });
        assert.equal(r.status, 404, id);
        assert.deepEqual(r.json(), { error: 'no baseline image' }, id);
      }

      const sig = await raw(S.port, { path: `/p/fixture/sig/${ok}` });
      assert.equal(sig.status, 200);
      assert.equal(sig.headers['cache-control'], 'no-store');
      assert.deepEqual(sig.json(), readHeader(f.sig(ok)), 'the .psig header');
      const noSig = await raw(S.port, { path: '/p/fixture/sig/components-nope--x' });
      assert.equal(noSig.status, 404);
      assert.deepEqual(noSig.json(), { error: 'no baseline' });

      // `..` written out: the URL parser makes it `/p/x`, which names no project's file.
      const dots = await raw(S.port, { path: '/p/fixture/renders/../../x' });
      assert.equal(dots.status, 404);
      assert.deepEqual(dots.json(), { error: 'not found' });
      for (const path of [
        '/p/fixture/renders/..%2F..%2Fx',
        '/p/fixture/renders/..%2F..%2Fpxsig.config.json',
        '/p/fixture/diffs/..%2F..%2Fmanifest.json',
        '/p/fixture/renders/latest',
        '/p/fixture/elsewhere/x.png',
      ]) {
        const r = await raw(S.port, { path });
        assert.equal(r.status, 404, path);
        assert.deepEqual(r.json(), { error: 'not found' }, path);
      }
      const nope = await raw(S.port, { path: `/p/nope/renders/latest/${ok}.png` });
      assert.equal(nope.status, 404);
      assert.deepEqual(nope.json(), { error: 'no project "nope"' });
    } finally {
      await S.stop();
    }
  }
);
