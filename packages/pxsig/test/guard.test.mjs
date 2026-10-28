/**
 * guard.test.mjs — who may write through `pxsig serve` (lib/guard.mjs), and the server enforcing it:
 * decisions need the dashboard link's cookie (a page opened from the link `pxsig serve` prints) or
 * the CLI's token (`pxsig approve apply`), which an agent posting with curl, or reading the page,
 * does not have; writes from another site are refused; so is a Host that is not loopback.
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
import {
  AGENT_DECISIONS,
  authorize,
  cookieValue,
  DECISIONS,
  linkCookie,
  linkSetCookie,
  Links,
  loopbackHost,
  NEEDS_LINK,
  NEEDS_LINK_CODE,
  NEEDS_PERSON,
  pageHeaders,
  readToken,
  TICKET_MS,
  tokenFile,
} from '../src/lib/guard.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

/** @import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */
/** @import { CheckRow, ManifestEntry } from '../src/types.js' */
/**
 * @typedef {ReturnType<typeof fixture>} Fixture
 * @typedef {{ status: number, error: string, code?: string }} Refusal
 * A server answer's JSON, as far as these tests read it: flat strings (`link`, `error`, `code`;
 * docs/server.md).
 * @typedef {Record<string, string>} Answer
 * @typedef {{ status: number | undefined, headers: IncomingHttpHeaders, text: string, json: () => Answer }} RawResponse
 * An MCP tool result (docs/mcp.md).
 * @typedef {{ isError?: boolean, content: { text: string }[] }} ToolResult
 * @typedef {{ port: number, url: string, log: () => string, stop: () => Promise<unknown> }} Server
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// --- the rules ------------------------------------------------------------------------------------

const own = 'http://127.0.0.1:6070';
const storybook = new Set(['http://localhost:6006']);
const tokens = { cli: 'xyz', mcp: 'mmm' };
const links = new Links();
const session = links.redeem(links.mint());
/** The dashboard's own request, from a page opened with the dashboard link. */
const dashboard = {
  origin: own,
  'sec-fetch-site': 'same-origin',
  cookie: `other=1; ${linkCookie(6070)}=${session}`,
};
/**
 * null when allowed, else the refusal; `via` of an allowed decision through `viaOf`.
 * @param {string} action
 * @param {IncomingHttpHeaders} headers
 * @returns {Refusal | null}
 */
const refuse = (action, headers) => {
  const a = authorize({
    action,
    headers,
    tokens,
    links,
    port: 6070,
    ownOrigin: own,
    allowedOrigins: storybook,
  });
  return a.ok ? null : { status: a.status, error: a.error, ...(a.code ? { code: a.code } : {}) };
};
/**
 * @param {string} action
 * @param {IncomingHttpHeaders} headers
 */
const viaOf = (action, headers) =>
  authorize({
    action,
    headers,
    tokens,
    links,
    port: 6070,
    ownOrigin: own,
    allowedOrigins: storybook,
  }).via;

test('a decision without the dashboard link or a token is refused, with the way a person does it', () => {
  for (const action of DECISIONS) {
    assert.deepEqual(refuse(action, {}), { status: 403, error: NEEDS_PERSON }, action);
    assert.equal(
      refuse(action, { 'x-pxsig-token': 'abd' })?.status,
      403,
      `${action}: a wrong token`
    );
    assert.equal(refuse(action, dashboard), null, `${action}: the dashboard`);
    assert.deepEqual(
      refuse(action, { origin: own, 'sec-fetch-site': 'same-origin' }),
      { status: 403, error: NEEDS_LINK, code: NEEDS_LINK_CODE },
      `${action}: a tab without the link is told how to get it`
    );
    assert.equal(
      refuse(action, { ...dashboard, cookie: `${linkCookie(6070)}=forged` })?.code,
      NEEDS_LINK_CODE,
      `${action}: a made-up cookie`
    );
    assert.equal(
      refuse(action, { ...dashboard, cookie: `${linkCookie(6071)}=${session}` })?.code,
      NEEDS_LINK_CODE,
      `${action}: another server's cookie`
    );
  }
  assert.match(NEEDS_PERSON, /needs a person: use the dashboard or `pxsig approve` in a terminal/);
  assert.match(NEEDS_LINK, /dashboard link/);
});

test('the dashboard link: a ticket works once, within two minutes; the cookie cannot be read by scripts', () => {
  const l = new Links();
  const t0 = 1_000_000;
  const t = l.mint(t0);
  assert.match(t, /^[0-9a-f]{64}$/);
  const s = l.redeem(t, t0 + 1000);
  assert.ok(l.has(s));
  assert.equal(l.redeem(t, t0 + 2000), null, 'used once');
  const late = l.mint(t0);
  assert.equal(l.redeem(late, t0 + TICKET_MS + 1), null, 'expired');
  assert.equal(l.redeem(undefined), null);
  assert.ok(!l.has('nope'));
  assert.equal(linkSetCookie(6070, 'v'), 'pxsig_link_6070=v; HttpOnly; SameSite=Strict; Path=/');
  assert.equal(cookieValue('a=1; pxsig_link_6070=v; b=2', 'pxsig_link_6070'), 'v');
  assert.equal(cookieValue(undefined, 'x'), null);
});

test('the dashboard page names what it may load, and is not sniffed', () => {
  const h = pageHeaders(storybook);
  assert.match(h['content-security-policy'], /script-src 'self'(;|$)/);
  assert.match(h['content-security-policy'], /connect-src 'self'/);
  assert.match(h['content-security-policy'], /object-src 'none'/);
  assert.match(h['content-security-policy'], /frame-ancestors 'self' http:\/\/localhost:6006/);
  assert.equal(h['x-content-type-options'], 'nosniff');
});

test("a decision's `via` is what it carried, never the request's word", () => {
  assert.equal(viaOf('approve', dashboard), 'dashboard');
  assert.equal(
    viaOf('approve', { 'x-pxsig-token': 'xyz' }),
    'cli',
    'pxsig approve apply: no Origin, no Sec-Fetch-Site'
  );
  assert.equal(
    refuse('approve', { 'x-pxsig-token': 'xyz', origin: own, 'sec-fetch-site': 'same-origin' })
      ?.status,
    403,
    "a browser never has the CLI's token"
  );
  assert.equal(
    refuse('approve', { 'x-pxsig-token': 'xyz', cookie: dashboard.cookie })?.status,
    undefined,
    'the CLI is the CLI, cookie or not'
  );
  assert.equal(
    viaOf('approve', { cookie: dashboard.cookie }),
    undefined,
    'the cookie counts only on a browser request'
  );
  assert.equal(viaOf('check', {}), null);
  assert.equal(refuse('approve', { 'x-pxsig-token': '' })?.status, 403, 'an empty token');
});

test("the MCP's token rejects and clears rejections, nothing that approves or accepts", () => {
  assert.deepEqual([...AGENT_DECISIONS], ['reject', 'unreview', 'a11y-reject', 'a11y-unreview']);
  for (const action of AGENT_DECISIONS)
    assert.equal(viaOf(action, { 'x-pxsig-token': 'mmm' }), 'mcp', action);
  for (const action of ['approve', 'approve-story', 'a11y-accept', 'a11y-unaccept'])
    assert.deepEqual(
      refuse(action, { 'x-pxsig-token': 'mmm' }),
      { status: 403, error: NEEDS_PERSON },
      action
    );
  assert.equal(
    refuse('reject', { 'x-pxsig-token': 'mmm', origin: own, 'sec-fetch-site': 'same-origin' })
      ?.status,
    403,
    "a browser never has the MCP's token"
  );
});

test('a decision from another origin is refused even with the token; a Storybook may only ask for checks', () => {
  // Each `.status` read is on a refusal (a null fails the test there).
  assert.equal(
    /** @type {Refusal} */ (refuse('approve', { ...dashboard, origin: 'http://evil.example' }))
      .status,
    403
  );
  assert.equal(
    /** @type {Refusal} */ (refuse('approve', { ...dashboard, origin: 'http://localhost:6006' }))
      .status,
    403,
    'not from the Storybook either'
  );
  assert.equal(
    /** @type {Refusal} */ (refuse('approve', { ...dashboard, 'sec-fetch-site': 'cross-site' }))
      .status,
    403
  );
  assert.equal(
    /** @type {Refusal} */ (refuse('approve', { ...dashboard, 'sec-fetch-site': 'same-site' }))
      .status,
    403
  );
  assert.equal(
    refuse('check', { origin: 'http://localhost:6006', 'sec-fetch-site': 'cross-site' }),
    null,
    'the addon'
  );
  assert.equal(refuse('check', {}), null, 'the CLI and the MCP');
  assert.equal(refuse('repair', {}), null);
  assert.equal(
    /** @type {Refusal} */ (refuse('check', { origin: 'http://evil.example' })).status,
    403
  );
  assert.equal(
    /** @type {Refusal} */ (refuse('check', { 'sec-fetch-site': 'cross-site' })).status,
    403,
    'a page on another site, Origin or not'
  );
  assert.equal(
    /** @type {Refusal} */ (refuse('check', { origin: 'null' })).status,
    403,
    'a sandboxed frame'
  );
});

test('loopback hosts only, on this port', () => {
  for (const h of ['127.0.0.1:6070', 'localhost:6070', 'LOCALHOST:6070', '[::1]:6070', undefined])
    assert.ok(loopbackHost(h, 6070), String(h));
  for (const h of [
    'evil.example:6070',
    '127.0.0.1:6071',
    '127.0.0.1',
    '127.0.0.1.evil.example:6070',
    '10.0.0.2:6070',
  ])
    assert.ok(!loopbackHost(h, 6070), h);
});

// --- the server -----------------------------------------------------------------------------------

const freePort = () =>
  /** @type {Promise<number>} */ (
    new Promise((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        // A TCP listener: its address is an AddressInfo.
        const p = /** @type {AddressInfo} */ (s.address()).port;
        s.close(() => ok(p));
      });
    })
  );

/**
 * A raw request (fetch will not send every header a browser does, Host among them).
 * @param {number} port
 * @param {{ method?: string, path: string, headers?: OutgoingHttpHeaders, body?: unknown }} req
 * @returns {Promise<RawResponse>}
 */
const raw = (port, { method = 'GET', path, headers = {}, body }) =>
  new Promise((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () =>
          ok({ status: res.statusCode, headers: res.headers, text: s, json: () => JSON.parse(s) })
        );
      }
    );
    req.on('error', fail);
    req.end(data);
  });

/** A stand-in dashboard build (the real one may not be built where the tests run). */
const dashboardDir = () => {
  const dash = mkdtempSync(join(tmpdir(), 'pxsig-dash-'));
  writeFileSync(
    join(dash, 'index.html'),
    '<!doctype html><html><head><title>pxsig</title></head><body></body></html>'
  );
  return dash;
};

/**
 * The cookie a page opened with a fresh dashboard link gets (as `pxsig serve --link`, then the page).
 * @param {Server} S
 * @param {string} cliToken
 */
async function dashboardCookie(S, cliToken) {
  const link = (
    await raw(S.port, {
      method: 'POST',
      path: '/__pxsig/ticket',
      headers: { 'x-pxsig-token': cliToken },
    })
  ).json().link;
  const ticket = link.split('#ticket=')[1];
  const r = await raw(S.port, {
    method: 'POST',
    path: '/__pxsig/session',
    headers: { origin: S.url, 'sec-fetch-site': 'same-origin' },
    body: { ticket },
  });
  // A traded ticket answers with its cookie.
  return /** @type {string[]} */ (r.headers['set-cookie'])[0].split(';')[0];
}

/**
 * @param {Fixture} f
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Server>}
 */
async function serve(f, env = {}) {
  const port = await freePort();
  const proc = spawn(
    process.execPath,
    [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
    {
      cwd: f.repo,
      env: {
        ...process.env,
        PXSIG_BIN: rustBin,
        PXSIG_WORKSPACE: '',
        PXSIG_DASHBOARD_DIR: dashboardDir(),
        ...env,
      },
    }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await /** @type {Promise<void>} */ (
    new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
      proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
    })
  );
  const exited = new Promise((ok) => proc.on('exit', ok));
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    log: () => log,
    stop: () => (proc.kill('SIGTERM'), exited),
  };
}

test(
  'the server refuses decisions an agent posts (no token), from another site, or through another host; the dashboard gets through',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const id = f.ids.changed;
    // The fixture's manifest holds this id.
    const sig = join(
      f.repo,
      /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id)).sig
    );
    const original = readFileSync(sig);
    const S = await serve(f);
    try {
      // The server writes its tokens before it prints its URL (serve() waits for that line).
      const token = /** @type {string} */ (readToken(f.repo, S.url));
      assert.match(token, /^[0-9a-f]{64}$/);
      if (process.platform !== 'win32')
        assert.equal(
          statSync(tokenFile(f.repo, S.url)).mode & 0o777,
          0o600,
          'only the owner reads the token file'
        );
      assert.ok(
        !readFileSync(
          join(f.repo, 'node_modules', '.cache', 'pxsig', 'server.json'),
          'utf8'
        ).includes(token),
        'server.json (read by the MCP and the addon) does not carry it'
      );

      // curl -X POST, as an agent would: refused, nothing written.
      for (const [action, body] of /** @type {[string, object][]} */ ([
        ['approve', { id }],
        ['approve-story', { story: id }],
        ['reject', { id }],
        ['unreview', { id }],
        ['a11y-accept', { id }],
        ['a11y-unaccept', { id, rule: 'x' }],
      ])) {
        const r = await raw(S.port, { method: 'POST', path: `/__pxsig/${action}`, body });
        assert.equal(r.status, 403, `${action}: ${r.text}`);
        assert.equal(r.json().error, NEEDS_PERSON);
      }
      assert.deepEqual(readFileSync(sig), original, 'the baseline is untouched');
      assert.ok(!existsSync(join(f.px, 'approvals.ndjson')), 'nothing was logged');
      assert.match(S.log(), /refused POST \/__pxsig\/approve: approving needs a person/);

      // A web page posting cross-site (the token cannot be read from another origin, but even with it).
      const evil = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/approve',
        headers: {
          origin: 'http://evil.example',
          'sec-fetch-site': 'cross-site',
          'x-pxsig-token': token,
        },
        body: { id },
      });
      assert.equal(evil.status, 403);
      assert.match(evil.json().error, /^cross-origin/);
      const evilCheck = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/check',
        headers: { origin: 'http://evil.example' },
        body: { ids: [] },
      });
      assert.equal(evilCheck.status, 403, 'a check from another site too');
      // DNS rebinding: a page on evil.example resolved to 127.0.0.1 is "same-origin", but its Host is not ours.
      const rebound = await raw(S.port, {
        path: '/__pxsig/status',
        headers: { host: `evil.example:${S.port}` },
      });
      assert.equal(rebound.status, 403);
      const reboundPage = await raw(S.port, {
        path: '/report/',
        headers: {
          host: `evil.example:${S.port}`,
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
        },
      });
      assert.equal(reboundPage.status, 403, 'and gets no page');

      // Reads and checks stay open to agents and the MCP.
      assert.equal((await raw(S.port, { path: '/__pxsig/status' })).status, 200);
      assert.equal(
        (await raw(S.port, { method: 'POST', path: '/__pxsig/check', body: { ids: [] } })).status,
        202
      );

      // The page carries no token, whoever asks and however: a script posing as a browser tab or as
      // the Storybook panel's frame gets the same page as curl.
      for (const headers of [
        {},
        { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' },
        {
          'sec-fetch-dest': 'iframe',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'cross-site',
        },
      ]) {
        const page = await raw(S.port, { path: '/report/', headers });
        assert.equal(page.status, 200);
        assert.ok(
          !/[0-9a-f]{64}/.test(page.text),
          `no token in the page (${JSON.stringify(headers)})`
        );
        assert.ok(!page.text.includes(token), "never the CLI's");
        // A page always carries its CSP (lib/guard.mjs pageHeaders).
        assert.match(
          /** @type {string} */ (page.headers['content-security-policy']),
          /script-src 'self'/
        );
        assert.match(
          /** @type {string} */ (page.headers['content-security-policy']),
          /frame-ancestors 'self' /
        );
        assert.equal(page.headers['x-content-type-options'], 'nosniff');
      }
      // A tab without the dashboard link is told how to get it.
      const tab = { origin: S.url, 'sec-fetch-site': 'same-origin' };
      const noLink = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/approve',
        headers: tab,
        body: { id },
      });
      assert.equal(noLink.status, 403);
      assert.equal(noLink.json().code, NEEDS_LINK_CODE);
      // The dashboard link: `pxsig serve --link` asks the server (the CLI's token, not a browser); a
      // browser, or a request without the token, cannot mint one.
      assert.equal((await raw(S.port, { method: 'POST', path: '/__pxsig/ticket' })).status, 403);
      assert.equal(
        (
          await raw(S.port, {
            method: 'POST',
            path: '/__pxsig/ticket',
            headers: { ...tab, 'x-pxsig-token': token },
          })
        ).status,
        403
      );
      const minted = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/ticket',
        headers: { 'x-pxsig-token': token },
      });
      assert.equal(minted.status, 200, minted.text);
      // The server mints a 64-hex ticket into the link (docs/server.md).
      const ticket = /** @type {RegExpMatchArray} */ (
        minted.json().link.match(/#ticket=([0-9a-f]{64})$/)
      )[1];
      assert.ok(minted.json().link.startsWith(`${S.url}/report/#ticket=`));
      // Only the dashboard's own page trades it, once.
      assert.equal(
        (await raw(S.port, { method: 'POST', path: '/__pxsig/session', body: { ticket } })).status,
        403,
        'not curl'
      );
      assert.equal(
        (
          await raw(S.port, {
            method: 'POST',
            path: '/__pxsig/session',
            headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
            body: { ticket },
          })
        ).status,
        403,
        'not another site'
      );
      const traded = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/session',
        headers: tab,
        body: { ticket },
      });
      assert.equal(traded.status, 200, traded.text);
      // A traded ticket answers with its cookie.
      const setCookie = /** @type {string[]} */ (traded.headers['set-cookie'])[0];
      assert.match(
        setCookie,
        new RegExp(`^pxsig_link_${S.port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`)
      );
      assert.equal(
        (
          await raw(S.port, {
            method: 'POST',
            path: '/__pxsig/session',
            headers: tab,
            body: { ticket },
          })
        ).status,
        403,
        'used once'
      );
      const cookie = setCookie.split(';')[0];
      assert.ok(
        !S.log().includes(ticket) && !S.log().includes(cookie.split('=')[1]),
        'neither the ticket nor the cookie is logged'
      );

      // The dashboard's own request: same-origin, with the cookie. It claims to be the MCP; the log
      // says what it was.
      const ok = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/approve',
        headers: { ...tab, cookie },
        body: { id, via: 'mcp' },
      });
      assert.equal(ok.status, 200, ok.text);
      assert.notDeepEqual(
        readFileSync(sig),
        original,
        'the person approved: the baseline is the latest render'
      );
      const log = () =>
        readFileSync(join(f.px, 'approvals.ndjson'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l));
      assert.equal(log().at(-1).via, 'dashboard');
      // The CLI's request (as `pxsig approve apply` sends it), claiming to be the dashboard.
      assert.equal(
        (
          await raw(S.port, {
            method: 'POST',
            path: '/__pxsig/unreview',
            headers: { 'x-pxsig-token': token },
            body: { id },
          })
        ).status,
        200
      );
      const cli = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/approve',
        headers: { 'x-pxsig-token': token },
        body: { id, via: 'dashboard', batch: 'b-cli' },
      });
      assert.equal(cli.status, 200, cli.text);
      assert.equal(log().at(-1).via, 'cli');

      // The MCP's token: no approving; it may reject and clear a rejection, never a person's approval.
      const mcpToken = /** @type {string} */ (readToken(f.repo, S.url, 'mcp'));
      assert.match(mcpToken, /^[0-9a-f]{64}$/);
      assert.ok(mcpToken !== token);
      if (process.platform !== 'win32')
        assert.equal(statSync(tokenFile(f.repo, S.url, 'mcp')).mode & 0o777, 0o600);
      /**
       * @param {string} action
       * @param {unknown} body
       */
      const mcp = (action, body) =>
        raw(S.port, {
          method: 'POST',
          path: `/__pxsig/${action}`,
          headers: { 'x-pxsig-token': mcpToken },
          body,
        });
      const review = () => JSON.parse(readFileSync(join(f.px, 'reports', 'review.json'), 'utf8'));
      const cleared = await mcp('unreview', { id });
      assert.equal(cleared.status, 403, "the CLI approved it: clearing that is a person's");
      assert.match(cleared.json().error, /^clearing an approval needs a person/);
      assert.equal(review()[id].state, 'approved');
      const other = f.ids.ok;
      assert.equal((await mcp('approve', { id: other })).status, 403);
      assert.equal((await mcp('approve-story', { story: other })).status, 403);
      const rejected = await mcp('reject', { id: other, via: 'dashboard' });
      assert.equal(rejected.status, 200, rejected.text);
      assert.deepEqual([review()[other].state, review()[other].via], ['rejected', 'mcp']);
      assert.equal((await mcp('unreview', { id: other })).status, 200, 'its own kind of decision');
      assert.equal(review()[other], undefined);
    } finally {
      await S.stop();
    }
    // On Windows, kill() terminates the server without running its shutdown; the next serve
    // replaces the token files (a forced stop on any OS does the same).
    if (process.platform !== 'win32') {
      assert.ok(!existsSync(tokenFile(f.repo, S.url)), 'the token file goes with the server');
      assert.ok(!existsSync(tokenFile(f.repo, S.url, 'mcp')), "and the MCP's");
    }
  }
);

test(
  "the MCP server's pxsig_review rejects through the server, logged as via: mcp; it cannot clear a person's accept",
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const id = f.ids.a11y;
    const checkPath = join(f.px, 'reports', 'check.json');
    const check = JSON.parse(readFileSync(checkPath, 'utf8'));
    check.rows.find((/** @type {CheckRow} */ r) => r.id === id).a11y = {
      violations: [{ id: 'color-contrast', impact: 'serious', help: 'x', nodes: 1, targets: [] }],
      new: 1,
      baseline: [],
    };
    writeFileSync(checkPath, JSON.stringify(check));
    const S = await serve(f);
    const mcp = spawn(process.execPath, [join(src, 'mcp.mjs')], {
      cwd: f.repo,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, PXSIG_URL: S.url, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
    });
    /** @type {Map<number, (m: { result: ToolResult }) => void>} */
    const replies = new Map();
    let buf = '';
    mcp.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const m = JSON.parse(buf.slice(0, i));
        replies.get(m.id)?.(m);
      }
    });
    let seq = 0;
    /**
     * @param {string} name
     * @param {unknown} args
     * @returns {Promise<ToolResult>}
     */
    const call = (name, args) =>
      new Promise((ok) => {
        const n = ++seq;
        replies.set(n, (/** @type {{ result: ToolResult }} */ m) => ok(m.result));
        mcp.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } })}\n`
        );
      });
    try {
      const r = await call('pxsig_review', { action: 'a11y-reject', ids: [id], confirm: true });
      assert.ok(!r.isError, r.content[0].text);
      const av = () => JSON.parse(readFileSync(join(f.px, 'reports', 'a11y-review.json'), 'utf8'));
      assert.deepEqual([av()[id].state, av()[id].via], ['rejected', 'mcp']);
      // A person accepts in the dashboard (a page opened with the dashboard link); the MCP may not clear that.
      // The server wrote its token before it printed its URL.
      const cookie = await dashboardCookie(S, /** @type {string} */ (readToken(f.repo, S.url)));
      assert.equal(
        (
          await raw(S.port, {
            method: 'POST',
            path: '/__pxsig/a11y-accept',
            headers: { origin: S.url, 'sec-fetch-site': 'same-origin', cookie },
            body: { id },
          })
        ).status,
        200
      );
      const undo = await call('pxsig_review', {
        action: 'a11y-unreview',
        ids: [id],
        confirm: true,
      });
      assert.equal(undo.isError, true);
      assert.match(undo.content[0].text, /clearing an accept needs a person/);
      assert.equal(av()[id].state, 'accepted');
      assert.deepEqual(
        JSON.parse(readFileSync(join(f.px, 'a11y.json'), 'utf8'))[id],
        ['color-contrast'],
        'the accepted list stands'
      );
    } finally {
      mcp.kill();
      await S.stop();
    }
  }
);
