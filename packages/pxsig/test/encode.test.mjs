/**
 * encode.test.mjs — gzip for the servers' text (lib/encode.mjs), through serve/http.mjs's
 * `sendFile` and `json` on a plain node:http server: what Accept-Encoding allows, Vary, the 1 KiB
 * floor, types that are never compressed, the file cache and its invalidation, and the headers
 * that stay.
 *
 *   node --test packages/pxsig/test/encode.test.mjs
 */
import assert from 'node:assert/strict';
import { utimesSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  acceptsGzip,
  cacheStats,
  compressible,
  MIN_BYTES,
  varyEncoding,
} from '../src/lib/encode.mjs';
import { cors, json, sendFile } from '../src/serve/http.mjs';
import { tempDir } from './fixture.mjs';
/** @import { IncomingMessage } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */

/** A script well over the floor, and one under it. */
const BIG = 'export const pxsig = "a readable script";\n'.repeat(400);
const SMALL = 'console.log("pxsig");\n';

/**
 * A GET (or `method`) with `headers`; the body as raw bytes.
 * @param {number} port
 * @param {string} path
 * @param {Record<string, string>} [headers]
 * @param {string} [method]
 * @returns {Promise<{ status: number | undefined, headers: import('node:http').IncomingHttpHeaders, body: Buffer }>}
 */
const get = (port, path, headers = {}, method = 'GET') =>
  new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers, method }, (res) => {
      /** @type {Buffer[]} */
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () =>
        ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) })
      );
    });
    req.on('error', fail);
    req.end();
  });

/** A server: /f/<name> sends that file of `dir` with sendFile, /json/<n> a JSON answer of n items. */
async function start(/** @type {string} */ dir) {
  const server = createServer((req, res) => {
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname.startsWith('/f/')) return sendFile(req, res, join(dir, u.pathname.slice(3)));
    if (u.pathname.startsWith('/cors/')) {
      cors(new Set(['http://sb.test']), req, res);
      return sendFile(req, res, join(dir, u.pathname.slice(6)));
    }
    const n = Number(u.pathname.slice('/json/'.length));
    json(res, 200, {
      items: Array.from({ length: n }, (_, i) => ({ id: `story-${i}`, ok: true })),
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(null)));
  return {
    port: /** @type {AddressInfo} */ (server.address()).port,
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections();
        server.close(() => ok(null));
      }),
  };
}

test('Accept-Encoding: gzip and * with q above 0; gzip;q=0 refuses, and wins over *', () => {
  const r = (/** @type {string | undefined} */ h) =>
    acceptsGzip(
      /** @type {IncomingMessage} */ ({ headers: h === undefined ? {} : { 'accept-encoding': h } })
    );
  assert.equal(r(undefined), false);
  assert.equal(r(''), false);
  assert.equal(r('identity'), false);
  assert.equal(r('br'), false);
  assert.equal(r('gzip'), true);
  assert.equal(r('gzip, deflate, br, zstd'), true);
  assert.equal(r('GZIP;q=0.5'), true);
  assert.equal(r('gzip;q=0'), false);
  assert.equal(r('*'), true);
  assert.equal(r('*;q=0'), false);
  assert.equal(r('gzip;q=0, *'), false);
  assert.equal(r('x-gzip'), true);
  assert.equal(acceptsGzip(undefined), false);
});

test('only text types are compressible; never an event stream, an image or a font', () => {
  for (const t of [
    'text/javascript; charset=utf-8',
    'text/css; charset=utf-8',
    'text/html; charset=utf-8',
    'application/json; charset=utf-8',
    'image/svg+xml',
    'text/plain',
    'application/xml; charset=utf-8',
  ])
    assert.equal(compressible(t), true, t);
  for (const t of [
    'text/event-stream',
    'image/png',
    'font/woff2',
    'application/octet-stream',
    undefined,
  ])
    assert.equal(compressible(t), false, String(t));
});

test('Vary keeps what is set and adds accept-encoding once', () => {
  /** @type {Record<string, unknown>} */
  const h = {};
  const res = /** @type {import('node:http').ServerResponse} */ (
    /** @type {unknown} */ ({
      getHeader: (/** @type {string} */ k) => h[k],
      setHeader: (/** @type {string} */ k, /** @type {unknown} */ v) => (h[k] = v),
    })
  );
  varyEncoding(res);
  assert.equal(h.vary, 'accept-encoding');
  h.vary = 'origin';
  varyEncoding(res);
  varyEncoding(res);
  assert.equal(h.vary, 'origin, accept-encoding');
});

test('a file: gzipped bytes decode to the file, with Vary, Content-Length and the security headers; identity without Accept-Encoding', async () => {
  const dir = tempDir('encode');
  writeFileSync(join(dir, 'app.js'), BIG);
  const S = await start(dir);
  try {
    const gz = await get(S.port, '/f/app.js', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.vary, 'accept-encoding');
    assert.equal(Number(gz.headers['content-length']), gz.body.length);
    assert.ok(gz.body.length < Buffer.byteLength(BIG) / 4, 'compressed');
    assert.equal(gunzipSync(gz.body).toString(), BIG);
    assert.equal(gz.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(gz.headers['cache-control'], 'no-cache');
    assert.equal(gz.headers['x-content-type-options'], 'nosniff');
    assert.ok(gz.headers['last-modified']);

    const plain = await get(S.port, '/f/app.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers.vary, 'accept-encoding', 'Vary on the identity answer too');
    assert.equal(plain.body.toString(), BIG);
    assert.equal(Number(plain.headers['content-length']), Buffer.byteLength(BIG));

    const refused = await get(S.port, '/f/app.js', { 'accept-encoding': 'gzip;q=0, br' });
    assert.equal(refused.headers['content-encoding'], undefined);
    assert.equal(refused.body.toString(), BIG);

    const head = await get(S.port, '/f/app.js', { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(head.headers['content-encoding'], 'gzip');
    assert.equal(head.headers['content-length'], gz.headers['content-length']);
    assert.equal(head.body.length, 0);

    // CORS's Vary stays.
    const cross = await get(S.port, '/cors/app.js', {
      'accept-encoding': 'gzip',
      origin: 'http://sb.test',
    });
    assert.equal(cross.headers['content-encoding'], 'gzip');
    assert.equal(cross.headers.vary, 'origin, accept-encoding');
    assert.equal(cross.headers['access-control-allow-origin'], 'http://sb.test');
  } finally {
    await S.close();
  }
});

test('under 1 KiB, images and fonts go as they are', async () => {
  const dir = tempDir('encode');
  writeFileSync(join(dir, 'small.js'), SMALL);
  writeFileSync(join(dir, 'pic.png'), Buffer.alloc(8 * MIN_BYTES, 7));
  writeFileSync(join(dir, 'f.woff2'), Buffer.alloc(8 * MIN_BYTES, 7));
  const S = await start(dir);
  try {
    const small = await get(S.port, '/f/small.js', { 'accept-encoding': 'gzip' });
    assert.equal(small.headers['content-encoding'], undefined);
    assert.equal(small.headers.vary, 'accept-encoding');
    assert.equal(small.body.toString(), SMALL);
    for (const f of ['pic.png', 'f.woff2']) {
      const r = await get(S.port, `/f/${f}`, { 'accept-encoding': 'gzip' });
      assert.equal(r.headers['content-encoding'], undefined, f);
      assert.equal(r.headers.vary, undefined, f);
      assert.equal(r.body.length, 8 * MIN_BYTES, f);
    }
  } finally {
    await S.close();
  }
});

test('the file cache is keyed by mtime and size: an edited file is compressed again', async () => {
  const dir = tempDir('encode');
  const file = join(dir, 'app.js');
  writeFileSync(file, BIG);
  const S = await start(dir);
  try {
    const before = cacheStats().entries;
    const one = await get(S.port, '/f/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(gunzipSync(one.body).toString(), BIG);
    assert.equal(cacheStats().entries, before + 1);
    const again = await get(S.port, '/f/app.js', { 'accept-encoding': 'gzip' });
    assert.deepEqual(again.body, one.body);
    assert.equal(cacheStats().entries, before + 1, 'served from the cache');

    // Same size, new content, a later mtime: the cache must not serve the old bytes.
    const edited = BIG.replace('readable', 'Readable');
    writeFileSync(file, edited);
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const after = await get(S.port, '/f/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(gunzipSync(after.body).toString(), edited);
    assert.equal(cacheStats().entries, before + 1, 'the old entry replaced, not added to');
  } finally {
    await S.close();
  }
});

test('a JSON answer: gzipped over 1 KiB when accepted, never kept; small answers and no Accept-Encoding are identity', async () => {
  const S = await start(tempDir('encode'));
  try {
    const kept = cacheStats();
    const big = await get(S.port, '/json/200', { 'accept-encoding': 'gzip' });
    assert.equal(big.headers['content-encoding'], 'gzip');
    assert.equal(big.headers.vary, 'accept-encoding');
    assert.equal(big.headers['cache-control'], 'no-store');
    assert.equal(big.headers['x-content-type-options'], 'nosniff');
    assert.equal(JSON.parse(gunzipSync(big.body).toString()).items.length, 200);
    assert.deepEqual(cacheStats(), kept, 'answers are not cached');

    const plain = await get(S.port, '/json/200');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(plain.body.toString()).items.length, 200);

    const small = await get(S.port, '/json/1', { 'accept-encoding': 'gzip' });
    assert.equal(small.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(small.body.toString()).items.length, 1);
  } finally {
    await S.close();
  }
});
