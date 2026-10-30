/**
 * guard-server.test.mjs — `pxsig serve` enforcing lib/guard.mjs: decisions an agent posts, from
 * another site or through another host are refused while the dashboard gets through, and the MCP
 * server's pxsig_review rejects through the server.
 *
 *   node --test packages/pxsig/test/guard-server.test.mjs
 *
 * Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NEEDS_LINK_CODE, NEEDS_PERSON, readToken, tokenFile } from '../src/lib/guard.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { src, raw, dashboardCookie, serve } from './guard-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { CheckRow, ManifestEntry } from '../src/types.js' */
/** @import { ToolResult } from './guard-helpers.mjs' */

// --- the server -----------------------------------------------------------------------------------

test(
  'the server refuses decisions an agent posts (no token), from another site, or through another host; the dashboard gets through',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
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
  { skip: skipUnless(hasRust, 'Rust binary not built') },
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
      env: { ...testEnv(testHome), PXSIG_URL: S.url, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
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
