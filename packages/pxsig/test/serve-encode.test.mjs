/**
 * serve-encode.test.mjs — gzip on the real servers (lib/encode.mjs): `pxsig serve` sends the
 * dashboard's script and its data gzipped when asked, and the event stream never (no
 * Content-Encoding, the hello at once, not held for a buffer); the `dashboard check` scenario
 * server does the same.
 *
 *   node --test packages/pxsig/test/serve-encode.test.mjs
 *
 * The `pxsig serve` test needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { sampleImages, scenarioServer } from '../src/dashboard-check/server.mjs';
import { fixture, hasRust, tempDir } from './fixture.mjs';
import { dashboardDir, serve } from './guard-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { DashboardFixtures } from '../src/types/t4.js' */

const SCRIPT = 'export const pxsig = "a readable script";\n'.repeat(400);
const GZIP = { 'accept-encoding': 'gzip, deflate, br' };

/**
 * A GET; the body as raw bytes.
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ status: number | undefined, headers: import('node:http').IncomingHttpHeaders, body: Buffer }>}
 */
const get = (url, headers = {}) =>
  new Promise((ok, fail) => {
    const req = request(url, { headers, agent: false }, (res) => {
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

/**
 * The event stream's head and its first chunk, read while the stream stays open (an encoder
 * holding bytes for a buffer would never deliver it), then closed.
 * @param {string} url
 * @returns {Promise<{ status: number | undefined, headers: import('node:http').IncomingHttpHeaders, first: string }>}
 */
const firstEvent = (url) =>
  new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('no event within 5 s')), 5000);
    const req = request(url, { headers: GZIP, agent: false }, (res) => {
      res.once('data', (c) => {
        clearTimeout(timer);
        ok({ status: res.statusCode, headers: res.headers, first: c.toString() });
        req.destroy();
      });
    });
    req.on('error', (e) => (req.destroyed ? null : fail(e)));
    req.end();
  });

test(
  'pxsig serve: the dashboard script and the data gzipped when asked, identity otherwise; the event stream never',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const dash = dashboardDir();
    writeFileSync(join(dash, 'app.js'), SCRIPT);
    const S = await serve(f, { PXSIG_DASHBOARD_DIR: dash });
    try {
      const gz = await get(`${S.url}/report/app.js`, GZIP);
      assert.equal(gz.status, 200);
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.equal(gz.headers.vary, 'accept-encoding');
      assert.equal(gz.headers['x-content-type-options'], 'nosniff');
      assert.equal(gunzipSync(gz.body).toString(), SCRIPT);
      const plain = await get(`${S.url}/report/app.js`);
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(plain.body.toString(), SCRIPT);

      const data = await get(`${S.url}/__pxsig/data`, GZIP);
      assert.equal(data.status, 200);
      assert.equal(data.headers['content-encoding'], 'gzip', 'the live report is well over 1 KiB');
      assert.equal(typeof JSON.parse(gunzipSync(data.body).toString()), 'object');
      assert.equal(data.headers.vary, 'accept-encoding');

      const ev = await firstEvent(`${S.url}/__pxsig/events`);
      assert.equal(ev.status, 200);
      assert.match(String(ev.headers['content-type']), /^text\/event-stream/);
      assert.equal(ev.headers['content-encoding'], undefined, 'an event stream is never encoded');
      assert.match(ev.first, /event: hello/);
    } finally {
      await S.stop();
    }
  }
);

test('the dashboard check server: the build gzipped when asked, the event stream never', async () => {
  const dir = tempDir('check-build');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>pxsig</title>');
  writeFileSync(join(dir, 'app.js'), SCRIPT);
  const big = { stories: Array.from({ length: 200 }, (_, i) => ({ id: `story-${i}` })) };
  const fixtures = /** @type {DashboardFixtures} */ ({
    LOAD_ERROR: 'load error',
    SERVER_STATES: [],
    SCENARIOS: {},
    scenarioData: () => big,
    projectsOf: () => [],
    approvingOf: () => ({ allowed: false, folder: '', command: '' }),
  });
  const server = await scenarioServer({
    dir,
    scenario: 'changed',
    fixtures,
    images: sampleImages(),
    posts: [],
  });
  try {
    const gz = await get(`${server.base}/report/app.js`, GZIP);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.vary, 'accept-encoding');
    assert.equal(gunzipSync(gz.body).toString(), SCRIPT);
    const plain = await get(`${server.base}/report/app.js`);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), SCRIPT);

    const data = await get(`${server.base}/__pxsig/data`, GZIP);
    assert.equal(data.headers['content-encoding'], 'gzip');
    assert.deepEqual(JSON.parse(gunzipSync(data.body).toString()), big);

    const png = await get(`${server.base}/p/demo/renders/latest/x.png`, GZIP);
    assert.equal(png.headers['content-encoding'], undefined, 'images go as they are');

    const ev = await firstEvent(`${server.base}/__pxsig/events`);
    assert.equal(ev.headers['content-encoding'], undefined);
    assert.match(ev.first, /event: hello/);
  } finally {
    server.close();
  }
});
