/**
 * dashboard-link.test.mjs — what the dashboard says about approving from it (lib/dashboard-link.mjs):
 * the command for a new link in the served folder, whether a request holds the link's session, and
 * the timing, said in full (the five minutes are to access the link, not to decide).
 *
 *   node --test packages/pxsig/test/dashboard-link.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { approving, LINK_EXPIRED, LINK_TIMING, linkCommand } from '../src/lib/dashboard-link.mjs';
import { Links, linkCookie } from '../src/lib/guard.mjs';

test("the command runs the project's own pxsig through its package manager, else this one", () => {
  const root = '/work/app';
  const has =
    (/** @type {string[]} */ ...files) =>
    (/** @type {string} */ p) =>
      files.some((f) => p === join(root, f));
  const bin = join('node_modules', '.bin', 'pxsig');
  // The platform is fixed: on Windows the shim is pxsig.cmd (the case below).
  const linux = 'linux';
  assert.equal(
    linkCommand(root, { exists: has(bin, 'pnpm-lock.yaml'), platform: linux }),
    'pnpm exec pxsig serve --link'
  );
  assert.equal(
    linkCommand(root, { exists: has(bin, 'yarn.lock'), platform: linux }),
    'yarn pxsig serve --link'
  );
  assert.equal(linkCommand(root, { exists: has(bin), platform: linux }), 'npx pxsig serve --link');
  assert.equal(
    linkCommand(root, {
      exists: has(join('node_modules', '.bin', 'pxsig.cmd'), 'pnpm-lock.yaml'),
      platform: 'win32',
    }),
    'pnpm exec pxsig serve --link'
  );
  for (const platform of [linux, 'win32'])
    assert.equal(
      linkCommand(root, { exists: has('pnpm-lock.yaml'), platform }),
      'pxsig serve --link',
      'not installed in the project: pxsig from the PATH, never a path'
    );
});

test('approving: whether the request carries a live session, never the session itself', () => {
  const links = new Links();
  const session = /** @type {string} */ (links.redeem(links.mint()));
  const url = 'http://127.0.0.1:6123';
  const cookie = `${linkCookie(6123)}=${session}`;
  assert.equal(approving({}, links, url, '/work/app').allowed, false);
  assert.equal(
    approving({ cookie: `${linkCookie(6124)}=${session}` }, links, url, '/w').allowed,
    false
  );
  const yes = approving({ cookie }, links, url, '/work/app');
  assert.equal(yes.allowed, true);
  assert.equal(yes.folder, 'app', 'the folder by its own name');
  assert.ok(!JSON.stringify(yes).includes('/work'), 'never its parents');
  assert.ok(!JSON.stringify(yes).includes(session));
});

test('the timing says both halves: 5 minutes to access it, no limit once opened', () => {
  for (const text of [LINK_TIMING, LINK_EXPIRED]) {
    assert.match(text, /5 minutes/);
    assert.match(text, /access/);
    assert.match(text, /no time limit/);
  }
});
