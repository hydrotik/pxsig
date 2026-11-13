/**
 * A request the server refused, outside the inspector (parts/Failure.tsx): a render error card's
 * re-check says why in the card, with no browser dialog; and no browser alert anywhere in the
 * dashboard's code, where one would hold the page with its button busy until it is closed (the
 * inspector's own is in flows-masks-blocked.test.mjs). Ready to try finding (pull request 322).
 * Skips the browser test when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

test('a refused re-check on a card: why in the card, no browser dialog', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-button--broken';
  const d = data({
    rows: [
      row(id, { pass: false, metrics: null, error: 'locator.click: Timeout 5000ms exceeded' }),
    ],
    entries: [entry(id, [{ code: 'render-error', severity: 'error', reason: 'timeout' }])],
  });
  const { page, posts } = await open(d, {
    hash: '#tab=stories',
    answers: { check: { status: 409, json: { error: 'the store is locked' } } },
  });
  try {
    /** @type {string[]} */
    const dialogs = [];
    page.on('dialog', (dl) => (dialogs.push(dl.message()), void dl.dismiss()));
    const card = page.getByRole('group', { name: id });
    await card.getByRole('button', { name: 'Re-check' }).click();
    await card.getByText('Re-check failed: the store is locked').waitFor();
    assert.deepEqual(dialogs, [], 'never a browser alert');
    assert.equal(posts.filter((p) => p.name === 'check').length, 1);
    assert.ok(await card.getByRole('button', { name: 'Re-check' }).isEnabled(), 'usable');
  } finally {
    await page.close();
  }
});

test('no browser alert in the dashboard', () => {
  const src = fileURLToPath(new URL('../src', import.meta.url));
  /** @param {string} dir @returns {string[]} */
  const files = (dir) =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  const found = files(src).filter((f) => /(^|[^.\w])alert\(/m.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    found.map((f) => f.slice(src.length + 1)),
    []
  );
});
