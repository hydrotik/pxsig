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
import { test } from 'node:test';
import {
  AGENT_DECISIONS,
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
  TICKET_MS,
} from '../src/lib/guard.mjs';
import { own, storybook, session, dashboard, refuse, viaOf } from './guard-helpers.mjs';
/** @import { Refusal } from './guard-helpers.mjs' */

// --- the rules ------------------------------------------------------------------------------------

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

test('the dashboard link: a ticket works once, accessed within five minutes; the cookie cannot be read by scripts', () => {
  const l = new Links();
  const t0 = 1_000_000;
  const t = l.mint(t0);
  assert.match(t, /^[0-9a-f]{64}$/);
  const s = l.redeem(t, t0 + 1000);
  assert.ok(l.has(s));
  assert.equal(l.redeem(t, t0 + 2000), null, 'used once');
  assert.equal(TICKET_MS, 5 * 60 * 1000, 'five minutes to access the link');
  assert.ok(l.redeem(l.mint(t0), t0 + 4 * 60 * 1000), 'four minutes in: still good');
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
