/**
 * live-fetch.test.mjs — how the live harness talks to its `pxsig serve` (scripts/live/server.mjs
 * `serverFetch`, run.mjs's `fetch`): a connection of its own per request, so a request is never
 * sent on a kept-alive socket the server is closing (the harness's event loop stalls, and fetch's
 * pool then kept sockets idle past the server's keep-alive timeout); a request the server really
 * drops still rejects as fetch does, and is reported as dropped.
 *
 *   node --test scripts/live-fetch.test.mjs
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { serverFetch } from './live/server.mjs';

/** A server that counts its connections; `/drop` destroys the socket without an answer. */
async function server() {
  let connections = 0;
  const s = createServer((req, res) => {
    if (req.url === '/drop') return req.socket.destroy();
    if (req.url === '/empty') return res.writeHead(204).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  s.on('connection', () => connections++);
  await /** @type {Promise<void>} */ (new Promise((ok) => s.listen(0, '127.0.0.1', ok)));
  const port = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => connections,
    close: () => s.close(),
  };
}

test('one connection per request, and answers read as fetch reads them', async (t) => {
  const s = await server();
  t.after(s.close);
  assert.deepEqual(await (await serverFetch(`${s.url}/a`)).json(), { ok: true });
  assert.equal(await (await serverFetch(`${s.url}/b`, { method: 'POST' })).text(), '{"ok":true}');
  assert.equal((await serverFetch(`${s.url}/empty`)).status, 204);
  assert.equal(s.connections(), 3, 'never a kept-alive socket');
});

test('a request the server drops still rejects as fetch does (TypeError, with the cause)', async (t) => {
  const s = await server();
  t.after(s.close);
  const e = await serverFetch(`${s.url}/drop`).then(
    () => null,
    (/** @type {Error} */ x) => x
  );
  assert.ok(e instanceof TypeError, String(e));
  assert.equal(e.message, 'fetch failed');
  assert.ok(e.cause, 'the socket error');
  // A timeout is not a drop.
  const aborted = await serverFetch(`${s.url}/a`, { signal: AbortSignal.abort() }).catch((x) => x);
  assert.equal(aborted.name, 'AbortError');
});

test("a person's own servers are refused", async () => {
  await assert.rejects(serverFetch('http://127.0.0.1:6070/__pxsig/status'), /refusing/);
});
