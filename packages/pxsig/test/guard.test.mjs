/**
 * guard.test.mjs — who may write through `pxsig serve` (lib/guard.mjs), and the server enforcing it:
 * decisions need the server's token, which the dashboard page and `pxsig approve apply` have and
 * an agent posting with curl does not; writes from another site are refused; so is a Host that is
 * not loopback.
 *
 *   node --test packages/pxsig/test/guard.test.mjs
 *
 * The server tests need the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { authorize, DECISIONS, loopbackHost, NEEDS_PERSON, pageLoad, readToken, tokenFile, withToken } from '../src/lib/guard.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// --- the rules ------------------------------------------------------------------------------------

const own = 'http://127.0.0.1:6070';
const storybook = new Set(['http://localhost:6006']);
const tokens = { dashboard: 'abc', cli: 'xyz' };
/** null when allowed, else the refusal; `via` of an allowed decision through `viaOf`. */
const refuse = (action, headers) => {
  const a = authorize({ action, headers, tokens, ownOrigin: own, allowedOrigins: storybook });
  return a.ok ? null : { status: a.status, error: a.error };
};
const viaOf = (action, headers) => authorize({ action, headers, tokens, ownOrigin: own, allowedOrigins: storybook }).via;

test('a decision without the token is refused, with the way a person does it', () => {
  for (const action of DECISIONS) {
    assert.deepEqual(refuse(action, {}), { status: 403, error: NEEDS_PERSON }, action);
    assert.equal(refuse(action, { 'x-pxsig-token': 'abd' })?.status, 403, `${action}: a wrong token`);
    assert.equal(refuse(action, { 'x-pxsig-token': 'abc', origin: own, 'sec-fetch-site': 'same-origin' }), null, `${action}: the dashboard`);
  }
  assert.match(NEEDS_PERSON, /needs a person: use the dashboard or `pxsig approve` in a terminal/);
});

test("a decision's `via` is the token it carried, never the request's word", () => {
  assert.equal(viaOf('approve', { 'x-pxsig-token': 'abc', origin: own, 'sec-fetch-site': 'same-origin' }), 'dashboard');
  assert.equal(viaOf('approve', { 'x-pxsig-token': 'xyz' }), 'cli', 'pxsig approve apply: no Origin, no Sec-Fetch-Site');
  assert.equal(refuse('approve', { 'x-pxsig-token': 'xyz', origin: own, 'sec-fetch-site': 'same-origin' })?.status, 403, "a browser never has the CLI's token");
  assert.equal(viaOf('check', {}), null);
  assert.equal(refuse('approve', { 'x-pxsig-token': '' })?.status, 403, 'an empty token');
});

test('a decision from another origin is refused even with the token; a Storybook may only ask for checks', () => {
  assert.equal(refuse('approve', { 'x-pxsig-token': 'abc', origin: 'http://evil.example' }).status, 403);
  assert.equal(refuse('approve', { 'x-pxsig-token': 'abc', origin: 'http://localhost:6006' }).status, 403, 'not from the Storybook either');
  assert.equal(refuse('approve', { 'x-pxsig-token': 'abc', 'sec-fetch-site': 'cross-site' }).status, 403);
  assert.equal(refuse('approve', { 'x-pxsig-token': 'abc', 'sec-fetch-site': 'same-site' }).status, 403);
  assert.equal(refuse('check', { origin: 'http://localhost:6006', 'sec-fetch-site': 'cross-site' }), null, 'the addon');
  assert.equal(refuse('check', {}), null, 'the CLI and the MCP');
  assert.equal(refuse('repair', {}), null);
  assert.equal(refuse('check', { origin: 'http://evil.example' }).status, 403);
  assert.equal(refuse('check', { 'sec-fetch-site': 'cross-site' }).status, 403, 'a page on another site, Origin or not');
  assert.equal(refuse('check', { origin: 'null' }).status, 403, 'a sandboxed frame');
});

test('loopback hosts only, on this port', () => {
  for (const h of ['127.0.0.1:6070', 'localhost:6070', 'LOCALHOST:6070', '[::1]:6070', undefined]) assert.ok(loopbackHost(h, 6070), String(h));
  for (const h of ['evil.example:6070', '127.0.0.1:6071', '127.0.0.1', '127.0.0.1.evil.example:6070', '10.0.0.2:6070']) assert.ok(!loopbackHost(h, 6070), h);
});

test('the token goes into the page only when a browser loads it', () => {
  assert.equal(withToken('<html><head><title>x</title></head></html>', 't0'), '<html><head><meta name="pxsig-token" content="t0"><title>x</title></head></html>');
  assert.ok(pageLoad({ 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' }));
  assert.ok(pageLoad({ 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' }), 'the Storybook panel');
  assert.ok(!pageLoad({}), 'curl');
  assert.ok(!pageLoad({ 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' }), 'a fetch');
});

// --- the server -----------------------------------------------------------------------------------

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

/** A raw request (fetch will not send every header a browser does, Host among them). */
const raw = (port, { method = 'GET', path, headers = {}, body }) =>
  new Promise((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port, method, path, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: s, json: () => JSON.parse(s) }));
    });
    req.on('error', fail);
    req.end(data);
  });

async function serve(f, env = {}) {
  const port = await freePort();
  const proc = spawn(process.execPath, [join(src, 'serve.mjs'), '--port', String(port), '--no-open'], { cwd: f.repo, env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', ...env } });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
    proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
  });
  const exited = new Promise((ok) => proc.on('exit', ok));
  return { port, url: `http://127.0.0.1:${port}`, log: () => log, stop: () => (proc.kill('SIGTERM'), exited) };
}

test('the server refuses decisions an agent posts (no token), from another site, or through another host; the dashboard gets through', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const id = f.ids.changed;
  const sig = join(f.repo, f.manifest.stories.find((e) => e.id === id).sig);
  const original = readFileSync(sig);
  const dash = mkdtempSync(join(tmpdir(), 'pxsig-dash-'));
  writeFileSync(join(dash, 'index.html'), '<!doctype html><html><head><title>pxsig</title></head><body></body></html>');
  const S = await serve(f, { PXSIG_DASHBOARD_DIR: dash });
  try {
    const token = readToken(f.repo, S.url);
    assert.match(token, /^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') assert.equal(statSync(tokenFile(f.repo, S.url)).mode & 0o777, 0o600, 'only the owner reads the token file');
    assert.ok(!readFileSync(join(f.repo, 'node_modules', '.cache', 'pxsig', 'server.json'), 'utf8').includes(token), 'server.json (read by the MCP and the addon) does not carry it');

    // curl -X POST, as an agent would: refused, nothing written.
    for (const [action, body] of [['approve', { id }], ['approve-story', { story: id }], ['reject', { id }], ['unreview', { id }], ['a11y-accept', { id }], ['a11y-unaccept', { id, rule: 'x' }]]) {
      const r = await raw(S.port, { method: 'POST', path: `/__pxsig/${action}`, body });
      assert.equal(r.status, 403, `${action}: ${r.text}`);
      assert.equal(r.json().error, NEEDS_PERSON);
    }
    assert.deepEqual(readFileSync(sig), original, 'the baseline is untouched');
    assert.ok(!existsSync(join(f.px, 'approvals.ndjson')), 'nothing was logged');
    assert.match(S.log(), /refused POST \/__pxsig\/approve: approving needs a person/);

    // A web page posting cross-site (the token cannot be read from another origin, but even with it).
    const evil = await raw(S.port, { method: 'POST', path: '/__pxsig/approve', headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site', 'x-pxsig-token': token }, body: { id } });
    assert.equal(evil.status, 403);
    assert.match(evil.json().error, /^cross-origin/);
    const evilCheck = await raw(S.port, { method: 'POST', path: '/__pxsig/check', headers: { origin: 'http://evil.example' }, body: { ids: [] } });
    assert.equal(evilCheck.status, 403, 'a check from another site too');
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 is "same-origin", but its Host is not ours.
    const rebound = await raw(S.port, { path: '/__pxsig/status', headers: { host: `evil.example:${S.port}` } });
    assert.equal(rebound.status, 403);
    const reboundPage = await raw(S.port, { path: '/report/', headers: { host: `evil.example:${S.port}`, 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' } });
    assert.ok(!reboundPage.text.includes('pxsig-token'), 'and gets no page, so no token');

    // Reads and checks stay open to agents and the MCP.
    assert.equal((await raw(S.port, { path: '/__pxsig/status' })).status, 200);
    assert.equal((await raw(S.port, { method: 'POST', path: '/__pxsig/check', body: { ids: [] } })).status, 202);

    // The page: the token only when a browser loads it as a document (or the Storybook panel's frame).
    const scripted = await raw(S.port, { path: '/report/' });
    assert.equal(scripted.status, 200);
    assert.ok(!scripted.text.includes('pxsig-token'), 'a script fetching the page gets no token');
    const page = await raw(S.port, { path: '/report/', headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' } });
    assert.match(page.headers['content-security-policy'], /^frame-ancestors 'self' /);

    const pageToken = page.text.match(/<meta name="pxsig-token" content="([0-9a-f]{64})">/)[1];
    assert.notEqual(pageToken, token, "the page's token is not the CLI's");

    // The dashboard's own request: same-origin, with the token from the page. It claims to be the
    // MCP; the log says what it was.
    const ok = await raw(S.port, { method: 'POST', path: '/__pxsig/approve', headers: { origin: S.url, 'sec-fetch-site': 'same-origin', 'x-pxsig-token': pageToken }, body: { id, via: 'mcp' } });
    assert.equal(ok.status, 200, ok.text);
    assert.notDeepEqual(readFileSync(sig), original, 'the person approved: the baseline is the latest render');
    const log = () => readFileSync(join(f.px, 'approvals.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log().at(-1).via, 'dashboard');
    // The CLI's request (as `pxsig approve apply` sends it), claiming to be the dashboard.
    assert.equal((await raw(S.port, { method: 'POST', path: '/__pxsig/unreview', headers: { 'x-pxsig-token': token }, body: { id } })).status, 200);
    const cli = await raw(S.port, { method: 'POST', path: '/__pxsig/approve', headers: { 'x-pxsig-token': token }, body: { id, via: 'dashboard', batch: 'b-cli' } });
    assert.equal(cli.status, 200, cli.text);
    assert.equal(log().at(-1).via, 'cli');
  } finally {
    await S.stop();
  }
  assert.ok(!existsSync(tokenFile(f.repo, S.url)), 'the token file goes with the server');
});
