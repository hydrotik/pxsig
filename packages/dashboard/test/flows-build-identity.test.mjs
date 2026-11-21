/**
 * Which build of the dashboard a page is (`data.build`, the server's lib/build-identity.mjs), in a
 * real browser against a mocked server (flows-helpers.mjs): on hover of "pxsig" after the versions,
 * and as a sentence at the end of Help. The short commit, "modified" and the changes' short
 * fingerprint for a build with uncommitted changes, the design system's commit, the adapter and the build time; a release build names no
 * commit; a page with no build identity shows the versions only. Skips without Chromium.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILD, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const base = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
const versions = { pxsig: '0.7.7', engine: '0.7.7', contract: '1.1.0' };

/**
 * The tooltip of "pxsig" and the Help sentence for `build`.
 * @param {unknown} build
 */
async function shown(build) {
  const { page, errors } = await open({ ...base, versions, build }, { hash: '#help' });
  try {
    const h1 = page.locator('nav').getByRole('heading', { level: 1 });
    await h1.waitFor();
    await page.getByRole('heading', { name: 'Keyboard Shortcuts' }).waitFor();
    const tip = await h1.locator('span[title]').first().getAttribute('title');
    const help = await page
      .locator('main p')
      .evaluateAll((ps) =>
        ps.map((p) => p.textContent ?? '').filter((s) => s.startsWith('Dashboard '))
      );
    assert.deepEqual(errors, []);
    return { tip, help };
  } finally {
    await page.close();
  }
}

test('the build on hover of "pxsig" and in Help: commit, modified, design system, adapter, time', async (t) => {
  if (skip) return t.skip(skip);
  const b = {
    ...BUILD,
    pxsig: '0.7.7',
    commit: '3ae2540ba239b5a8fc272fbf7b3a5b7f5a238664',
    dirty: true,
    changes: '9f8e7d6c'.repeat(8),
    designSystem: { commit: '4142f335fa19cd218c85c932a48bb70d6cde4345', dirty: false },
    builtAt: '2026-11-18T17:18:44.273Z',
  };
  const s = await shown(b);
  const build =
    'build 3ae2540 modified 9f8e7d6 · design system 4142f33 · adapter hydrotik · built 2026-11-18 17:18 UTC';
  assert.equal(s.tip, `pxsig 0.7.7 · engine 0.7.7 · UI contract 1.1.0 · ${build}`);
  assert.deepEqual(s.help, [`Dashboard ${build}.`]);
  // Two modified builds of one commit differ by their changes' fingerprint.
  const other = await shown({ ...b, changes: '1a2b3c4d'.repeat(8) });
  assert.match(other.help[0], /^Dashboard build 3ae2540 modified 1a2b3c4 · /);
  const clean = await shown({ ...b, dirty: false, changes: null });
  assert.match(clean.help[0], /^Dashboard build 3ae2540 · design system/, 'clean: no "modified"');
});

test('a release build names no commit; another version is named; no identity shows the versions only', async (t) => {
  if (skip) return t.skip(skip);
  const release = await shown({
    pxsig: '0.7.6',
    commit: null,
    dirty: null,
    designSystem: null,
    adapter: 'plain',
    builtAt: null,
  });
  assert.deepEqual(release.help, ['Dashboard release build for pxsig 0.7.6 · adapter plain.']);
  const none = await shown(null);
  assert.equal(none.tip, 'pxsig 0.7.7 · engine 0.7.7 · UI contract 1.1.0');
  assert.deepEqual(none.help, []);
});
