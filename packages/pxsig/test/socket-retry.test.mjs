/**
 * socket-retry.test.mjs — one retry for a transient local socket failure (lib/retry.mjs): the
 * server status probe, the Storybook index probe and the story render's navigation, each against a
 * local server that resets the first connection and then answers.
 *
 *   node --test packages/pxsig/test/socket-retry.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderStories } from '../src/lib/capture.mjs';
import { fetchStoryIndex } from '../src/lib/integrity.mjs';
import { serverStatus } from '../src/lib/repair/apply.mjs';
import { isSocketError, navErrorCode, RETRY_MS, retryOnce } from '../src/lib/retry.mjs';
import { dropFirst, fakeStorybook } from './server-helpers.mjs';
import { freePort } from './server-proc.mjs';
import { skipUnless } from './strict.mjs';

/** @import { Server } from 'node:http' */

/** @type {import('playwright').BrowserType | null} */
let chromium = null;
try {
  const pw = await import('playwright');
  const b = await pw.chromium.launch();
  await b.close();
  chromium = pw.chromium;
} catch {
  chromium = null;
}

const STATUS = { running: false, queued: 0 };

/**
 * A status server on 127.0.0.1 (`port`, or any free one). `drop`: reset the first connections;
 * `hang`: never answer the first requests.
 * @param {{ port?: number, drop?: number, hang?: number }} [opts]
 */
async function statusServer({ port = 0, drop = 0, hang = 0 } = {}) {
  let hung = 0;
  /** @type {Server} */
  const s = createServer((req, res) => {
    if (hung < hang) {
      hung++;
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(STATUS));
  });
  const d = dropFirst(s, drop);
  await /** @type {Promise<void>} */ (new Promise((ok) => s.listen(port, '127.0.0.1', ok)));
  // Listening on TCP: the address is an AddressInfo.
  const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
  return {
    url: `http://127.0.0.1:${p}`,
    drops: d,
    close: () => (s.closeAllConnections(), s.close()),
  };
}

const err = (/** @type {string} */ code) =>
  Object.assign(new TypeError('fetch failed'), { cause: { code } });

test('the classifiers: socket errors, refused and timeouts by choice, Chromium net errors', () => {
  assert.ok(isSocketError(err('ECONNRESET')));
  assert.ok(isSocketError(err('UND_ERR_SOCKET')));
  assert.ok(!isSocketError(err('ECONNREFUSED')), 'refused is not a broken connection');
  assert.ok(isSocketError(err('ECONNREFUSED'), { refused: true }));
  // What fetch rejects with when AbortSignal.timeout fires (its legacy numeric `code` is 23).
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.ok(!isSocketError(timeout));
  assert.ok(isSocketError(timeout, { timeout: true }));
  assert.equal(
    navErrorCode(new Error('page.goto: net::ERR_NO_BUFFER_SPACE at http://127.0.0.1:1/')),
    'ERR_NO_BUFFER_SPACE'
  );
  assert.equal(navErrorCode(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at x')), null);
  assert.equal(navErrorCode(new Error('HTTP 404')), null);
});

test('retryOnce: one retry for an accepted error, after the pause; never a second', async () => {
  let n = 0;
  const started = Date.now();
  const r = await retryOnce(
    async () => {
      if (n++ === 0) throw err('ECONNRESET');
      return 'ok';
    },
    { when: (e) => isSocketError(e), delayMs: 50 }
  );
  assert.equal(r.value, 'ok');
  assert.ok(r.retried);
  assert.ok(Date.now() - started >= 40);
  let calls = 0;
  await assert.rejects(
    retryOnce(
      async () => {
        calls++;
        throw err('ECONNRESET');
      },
      { when: () => true, delayMs: 1 }
    )
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    retryOnce(
      async () => {
        calls++;
        throw new Error('HTTP 404');
      },
      { when: (e) => isSocketError(e) }
    )
  );
  assert.equal(calls, 1, 'another error is not retried');
});

test('serverStatus: a reset first connection is retried, and the server is up', async () => {
  const s = await statusServer({ drop: 1 });
  try {
    assert.deepEqual(await serverStatus(s.url, null, {}), { up: true, running: false, queued: 0 });
    assert.equal(s.drops.dropped, 1);
  } finally {
    s.close();
  }
});

test('serverStatus: a first request that times out is retried', async () => {
  const s = await statusServer({ hang: 1 });
  try {
    assert.equal((await serverStatus(s.url, null, {})).up, true);
  } finally {
    s.close();
  }
});

test('serverStatus: refused, then listening by the retry, is up; refused twice is down', async () => {
  const port = await freePort();
  /** @type {Awaited<ReturnType<typeof statusServer>> | null} */
  let late = null;
  const starting = new Promise((ok) => setTimeout(ok, RETRY_MS / 5)).then(async () => {
    late = await statusServer({ port });
  });
  try {
    const status = await serverStatus(`http://127.0.0.1:${port}`, null, {});
    await starting;
    assert.equal(status.up, true);
  } finally {
    await starting;
    /** @type {any} */ (late)?.close();
  }
  const down = await freePort();
  const started = Date.now();
  assert.deepEqual(await serverStatus(`http://127.0.0.1:${down}`, null, {}), { up: false });
  assert.ok(Date.now() - started >= RETRY_MS - 20, 'retried once before answering down');
});

test('fetchStoryIndex: a reset first connection is retried; a refused one is not', async () => {
  const sb = await fakeStorybook(
    [{ id: 'a--one', title: 'A', name: 'One', importPath: 'src/a/A.stories.tsx' }],
    { drop: 1 }
  );
  try {
    const idx = await fetchStoryIndex(sb.url);
    assert.equal(idx.healthy, true, JSON.stringify(idx));
    assert.deepEqual(sb.requests, ['/index.json']);
  } finally {
    sb.close();
  }
  const port = await freePort();
  const started = Date.now();
  const idx = await fetchStoryIndex(`http://127.0.0.1:${port}`);
  assert.equal(idx.reachable, false);
  assert.match(String(!idx.reachable && idx.error), /^unreachable: ECONNREFUSED/);
  assert.ok(Date.now() - started < RETRY_MS, 'nothing listens: answered without the retry');
});

const stories = ['a--one', 'a--two', 'a--broken'].map((id) => ({
  id,
  story: id,
  importPath: 'src/a/A.stories.tsx',
}));

/**
 * Render `entries` against a stand-in Storybook whose first `drop` connections are reset.
 * @param {number} drop
 * @param {typeof stories} entries
 */
async function render(drop, entries) {
  const sb = await fakeStorybook([], { drop });
  const out = mkdtempSync(join(tmpdir(), 'pxsig-retry-'));
  // Every test that calls this is skipped when Chromium is missing.
  const browser = await /** @type {NonNullable<typeof chromium>} */ (chromium).launch();
  try {
    const { results } = await renderStories(browser, entries, out, {
      baseUrl: sb.url,
      settleMs: 0,
      concurrency: 1,
    });
    return { results, requests: sb.requests.filter((r) => r.startsWith('/iframe.html')) };
  } finally {
    await browser.close();
    sb.close();
    rmSync(out, { recursive: true, force: true });
  }
}

test(
  'render: a navigation whose connection was reset is retried once on a fresh page',
  { skip: skipUnless(chromium, 'no Chromium') },
  async () => {
    const { results, requests } = await render(1, stories.slice(0, 2));
    assert.deepEqual(
      results.map((r) => [r.id, r.error ?? null, !!r.png]),
      [
        ['a--one', null, true],
        ['a--two', null, true],
      ]
    );
    assert.deepEqual(requests.length, 2, requests.join(' '));
  }
);

test(
  'render: a navigation that fails twice fails its entry only; the next entry renders',
  { skip: skipUnless(chromium, 'no Chromium') },
  async () => {
    const { results } = await render(2, stories.slice(0, 2));
    // Chromium names a reset connection several ways (RESET, EMPTY_RESPONSE, SOCKET_NOT_CONNECTED
    // on a loaded runner): any connection failure the retry covers.
    assert.ok(navErrorCode(results[0].error), String(results[0].error));
    assert.equal(results[1].error ?? null, null, 'no cascade from the failed page');
    assert.ok(results[1].png);
  }
);

test(
  "render: Storybook's error screen is an answer, not retried",
  { skip: skipUnless(chromium, 'no Chromium') },
  async () => {
    const { results, requests } = await render(0, [stories[2]]);
    assert.ok(results[0].error, 'the error screen is a render error');
    assert.equal(requests.length, 1, 'one navigation');
  }
);
