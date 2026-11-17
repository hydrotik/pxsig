// sendFile answers a revalidation with 304 and no body (the Storybook panel re-requests the
// dashboard's scripts on every story switch), keeps the headers a 200 has, and sends the file
// again when it changed or the validators do not match.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { sendFile } from '../src/serve/http.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pxsig-http-'));
const file = join(dir, 'app.js');
/** @type {import('node:http').Server} */
let server;
let base = '';

before(async () => {
  writeFileSync(file, 'console.log(1);\n');
  utimesSync(file, new Date('2026-01-02T03:04:05.678Z'), new Date('2026-01-02T03:04:05.678Z'));
  server = createServer((req, res) => {
    // What the server sets before routing (serve/http.mjs cors), kept on a 304 as on a 200.
    res.setHeader('access-control-allow-origin', 'http://127.0.0.1:56062');
    sendFile(req, res, file);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
});
after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (/** @type {Record<string, string>} */ headers = {}, method = 'GET') =>
  fetch(`${base}/app.js`, { method, headers });

test('a 200 carries an ETag and Last-Modified, revalidated on every use', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'console.log(1);\n');
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(r.headers.get('last-modified'), 'Fri, 02 Jan 2026 03:04:05 GMT');
  assert.match(r.headers.get('etag') ?? '', /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('If-None-Match with the ETag: 304, no body, the same headers bar the length', async () => {
  const etag = /** @type {string} */ ((await get()).headers.get('etag'));
  for (const inm of [etag, etag.replace(/^W\//, ''), `"other", ${etag}`, '*']) {
    const r = await get({ 'if-none-match': inm });
    assert.equal(r.status, 304, inm);
    assert.equal(await r.text(), '');
    assert.equal(r.headers.get('etag'), etag);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://127.0.0.1:56062');
  }
  assert.equal((await get({ 'if-none-match': etag }, 'HEAD')).status, 304);
});

test('If-None-Match decides alone: another tag is a 200 whatever If-Modified-Since says', async () => {
  const r = await get({
    'if-none-match': '"nope"',
    'if-modified-since': 'Fri, 02 Jan 2026 03:04:05 GMT',
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'console.log(1);\n');
});

test('If-Modified-Since: 304 at or after the file, 200 before it or unparsable', async () => {
  for (const ims of ['Fri, 02 Jan 2026 03:04:05 GMT', 'Sat, 03 Jan 2026 00:00:00 GMT'])
    assert.equal((await get({ 'if-modified-since': ims })).status, 304, ims);
  for (const ims of ['Fri, 02 Jan 2026 03:04:04 GMT', 'yesterday'])
    assert.equal((await get({ 'if-modified-since': ims })).status, 200, ims);
});

test('a changed file is sent again to an old validator', async () => {
  const old = await get();
  const etag = /** @type {string} */ (old.headers.get('etag'));
  const lm = /** @type {string} */ (old.headers.get('last-modified'));
  writeFileSync(file, 'console.log(22);\n');
  utimesSync(file, new Date('2026-01-03T00:00:01Z'), new Date('2026-01-03T00:00:01Z'));
  assert.equal((await get({ 'if-none-match': etag })).status, 200);
  const r = await get({ 'if-modified-since': lm });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'console.log(22);\n');
});
