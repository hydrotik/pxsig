/**
 * dashboard-load.test.mjs — `pxsig dashboard check`'s page load (dashboard-check/capture.mjs):
 * one retry on Windows' ERR_NO_BUFFER_SPACE, listed in summary.md.
 *
 *   node --test packages/pxsig/test/dashboard-load.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load, NO_BUFFER_SPACE, RETRY_MS } from '../src/dashboard-check/capture.mjs';
import { summaryMarkdown } from '../src/dashboard-check/gallery.mjs';

/** A page whose goto fails with each of `errors` in turn, then succeeds. */
function page(/** @type {string[]} */ ...errors) {
  const calls = /** @type {string[]} */ ([]);
  return {
    calls,
    goto: async (/** @type {string} */ url) => {
      calls.push(url);
      const e = errors.shift();
      if (e) throw new Error(e);
      return null;
    },
  };
}

const NOBUFS = 'page.goto: net::ERR_NO_BUFFER_SPACE at http://127.0.0.1:1/';

test('a load that succeeds is not retried', async () => {
  const p = page();
  assert.equal(await load(p, 'u'), null);
  assert.deepEqual(p.calls, ['u']);
});

test('ERR_NO_BUFFER_SPACE is retried once, after RETRY_MS, and reported', async () => {
  const p = page(NOBUFS);
  const started = Date.now();
  assert.equal(await load(p, 'u'), NO_BUFFER_SPACE);
  assert.deepEqual(p.calls, ['u', 'u']);
  assert.ok(Date.now() - started >= RETRY_MS - 20, 'waited before the retry');
});

test('a second ERR_NO_BUFFER_SPACE, or any other error, fails as before', async () => {
  const twice = page(NOBUFS, NOBUFS);
  await assert.rejects(load(twice, 'u'), /ERR_NO_BUFFER_SPACE/);
  assert.equal(twice.calls.length, 2);
  const other = page('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/');
  await assert.rejects(load(other, 'u'), /ERR_CONNECTION_REFUSED/);
  assert.equal(other.calls.length, 1, 'not retried');
});

/** A report.json with these screens, as summaryMarkdown reads it. */
const report = (/** @type {object[]} */ screens) =>
  /** @type {any} */ ({
    summary: {
      screens: screens.length,
      rendered: screens.length,
      failed: 0,
      withAxe: 0,
      withLayout: 0,
    },
    build: 'dist',
    contract: { adapter: 1, current: 1 },
    themes: ['dark'],
    reference: { used: false, note: 'none' },
    strict: false,
    screens,
  });

test('summary.md lists the retried screens, and has no section when there are none', () => {
  const screen = {
    feature: 'overview.stats',
    index: 0,
    theme: 'dark',
    rendered: true,
    axe: [],
    layout: [],
  };
  const md = summaryMarkdown(report([screen, { ...screen, index: 1, retried: NO_BUFFER_SPACE }]));
  assert.match(md, /### Retried\n\n.*\n\n- `overview.stats` #2 \(dark\)\n/);
  assert.doesNotMatch(md, /#1 \(dark\)/, 'a screen loaded first time is not listed');
  assert.doesNotMatch(summaryMarkdown(report([screen])), /Retried/);
});
