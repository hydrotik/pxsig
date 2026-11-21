// A crash of the screens harness is an error (exit 2), never "screens to review" (exit 1), and a
// request the live server drops fails the run instead of passing (scripts/lib/crash.mjs,
// scripts/live/volatile.mjs scrubRoutes, .github/workflows/screens.yml).
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { asMain, CRASH, checkExit, reportStamp } from './lib/crash.mjs';
import { scrubber, scrubRoutes } from './live/volatile.mjs';
/**
 * The fake route: the part of Playwright's Route that scrubRoutes uses.
 * @typedef {{ request(): { url(): string, method(): string, headers(): Record<string, string>, postDataBuffer(): Buffer | null }, fulfill(o: unknown): Promise<void>, abort(code?: string): Promise<void> }} FakeRoute
 * @typedef {Parameters<typeof scrubRoutes>[0]} Context
 */

const crashUrl = new URL('./lib/crash.mjs', import.meta.url).href;

/** Run a script that guards itself with asMain, then does `body`. */
function runGuarded(/** @type {string} */ body) {
  const dir = mkdtempSync(join(tmpdir(), 'screens-crash-'));
  const file = join(dir, 'main.mjs');
  writeFileSync(
    file,
    `import { asMain } from ${JSON.stringify(crashUrl)};\nif (asMain(import.meta.url, 'screens')) {\n${body}\n}\n`
  );
  return spawnSync(process.execPath, [file], { encoding: 'utf8' });
}

test('a crash exits 2 with a message that says it is no screen to review', () => {
  for (const body of [
    "throw new Error('boom');",
    "Promise.reject(new Error('boom')); await new Promise((ok) => setTimeout(ok, 50));",
    "await (async () => { throw new Error('boom'); })();",
    // The live run's crash: a rejection out of a callback no one awaits (a route handler).
    "setTimeout(() => Promise.reject(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), 1); await new Promise((ok) => setTimeout(ok, 50));",
  ]) {
    const r = runGuarded(body);
    assert.equal(r.status, CRASH, body);
    assert.equal(CRASH, 2);
    assert.match(r.stderr, /\[screens\] the harness failed: an error, not a screen to review/);
    assert.match(r.stderr, /boom|ECONNRESET/);
  }
  // A verdict still exits as the script says.
  assert.equal(runGuarded('process.exit(1);').status, 1);
  assert.equal(runGuarded('').status, 0);
});

test('a module imported, not run, installs no handler', () => {
  const before = process.listenerCount('uncaughtException');
  assert.equal(asMain(crashUrl, 'screens'), false);
  assert.equal(process.listenerCount('uncaughtException'), before);
});

test('the container reads 0 or 1 as a verdict only with the check.json that run wrote', () => {
  assert.deepEqual(checkExit(1, null, '2026-11-16T00:00:00.000Z'), { code: 1, why: null });
  assert.deepEqual(checkExit(0, 'a', 'b'), { code: 0, why: null });
  // No check.json, or the one an earlier run left: the check crashed.
  assert.equal(checkExit(1, null, null).code, 2);
  assert.match(String(checkExit(1, null, null).why), /no check\.json written by this run/);
  assert.equal(checkExit(1, 'a', 'a').code, 2);
  assert.equal(checkExit(0, 'a', null).code, 2);
  // screens-check's own error, Docker's, a signal or a kill: an error.
  assert.equal(checkExit(2, null, null).code, 2);
  for (const s of [null, 125, 126, 127, 137]) assert.equal(checkExit(s, null, 'b').code, 2);
});

test("a report's stamp is its generatedAt, or null", () => {
  const dir = mkdtempSync(join(tmpdir(), 'screens-stamp-'));
  const f = join(dir, 'check.json');
  assert.equal(reportStamp(f), null);
  writeFileSync(f, '{"generatedAt":');
  assert.equal(reportStamp(f), null);
  writeFileSync(f, JSON.stringify({ generatedAt: '2026-11-16T00:00:00.000Z' }));
  assert.equal(reportStamp(f), '2026-11-16T00:00:00.000Z');
});

/**
 * One routed request through scrubRoutes, with a fake context and route.
 * @param {{ fetch: (url: string, init: object) => Promise<Response>, abort?: () => Promise<void>, method?: string, post?: Buffer }} o
 */
async function routeOnce({ fetch, abort = async () => {}, method = 'GET', post }) {
  /** @type {{ handler?: (route: FakeRoute) => Promise<void>, match?: (u: URL) => boolean }} */
  const got = {};
  const calls = /** @type {{ fulfilled: unknown[], aborted: (string | undefined)[] }} */ ({
    fulfilled: [],
    aborted: [],
  });
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const failed = [];
  /** The fake context: route() keeps its matcher and handler. */
  const context = {
    route: async (
      /** @type {(u: URL) => boolean} */ match,
      /** @type {(route: FakeRoute) => Promise<void>} */ handler
    ) => void Object.assign(got, { match, handler }),
  };
  await scrubRoutes(
    /** @type {Context} */ (/** @type {unknown} */ (context)),
    scrubber(),
    problems,
    (m) => failed.push(m),
    fetch
  );
  const url = 'http://127.0.0.1:52600/__pxsig/status';
  const { match, handler } = got;
  assert.ok(match && handler);
  assert.ok(match(new URL(url)));
  assert.ok(!match(new URL('http://127.0.0.1:52600/__pxsig/events')));
  await handler({
    request: () => ({
      url: () => url,
      method: () => method,
      headers: () => ({}),
      postDataBuffer: () => post ?? null,
    }),
    fulfill: async (/** @type {unknown} */ o) => void calls.fulfilled.push(o),
    abort: async (/** @type {string | undefined} */ code) => {
      calls.aborted.push(code);
      await abort();
    },
  });
  return { ...calls, problems, failed };
}

test('a request the server resets is aborted and recorded, never passed or left unhandled', async () => {
  // As server.mjs serverFetch rejects: fetch's TypeError, the socket error its cause.
  const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  const reset = new TypeError('fetch failed', { cause });
  const r = await routeOnce({ fetch: () => Promise.reject(reset) });
  assert.deepEqual(r.fulfilled, []);
  assert.deepEqual(r.aborted, ['failed']);
  assert.deepEqual(r.failed, ['GET /__pxsig/status: fetch failed: read ECONNRESET']);
  // An abort that fails too (the page closed) still settles the handler.
  const closed = await routeOnce({
    fetch: () => Promise.reject(reset),
    abort: () => Promise.reject(new Error('Target page, context or browser has been closed')),
  });
  assert.deepEqual(closed.failed, ['GET /__pxsig/status: fetch failed: read ECONNRESET']);
});

test('an answer is scrubbed and fulfilled, with nothing recorded as failed', async () => {
  const body = { dashboard: 'http://127.0.0.1:52600/report/' };
  const r = await routeOnce({
    fetch: async () =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'content-length': '50' },
      }),
  });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.aborted, []);
  assert.equal(r.fulfilled.length, 1);
  assert.deepEqual(r.fulfilled[0], {
    status: 200,
    // The answer's own headers, but its length: the scrubbed body is another length.
    headers: { 'content-type': 'application/json' },
    json: { dashboard: 'http://127.0.0.1:1/report/' },
  });
});

test('a POST goes to the server with its body', async () => {
  /** @type {unknown[]} */
  const sent = [];
  const post = Buffer.from(JSON.stringify({ items: [{ id: 'a--b', file: 'f'.repeat(64) }] }));
  const r = await routeOnce({
    method: 'POST',
    post,
    fetch: async (_url, init) => {
      sent.push(init);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(sent, [{ method: 'POST', headers: {}, body: post }]);
});

test('the workflow fails a crash as an error and reviews only a 1 with its check.json', () => {
  const yml = readFileSync(new URL('../.github/workflows/screens.yml', import.meta.url), 'utf8');
  const step = yml.slice(yml.indexOf('id: check'), yml.indexOf('name: Source parity'));
  assert.match(step, /rm -f "\$report"/);
  assert.match(step, /\[ "\$code" -le 1 \] && \[ ! -f "\$report" \]/);
  assert.match(step, /code=2/);
  assert.match(step, /\[ "\$code" -le 1 \] \|\| \{ echo "::error::/);
  assert.match(yml, /if: steps\.check\.outputs\.code == '1'\n\s+name: Screens to review/);
});
