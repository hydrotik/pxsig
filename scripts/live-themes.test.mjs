/**
 * live-themes.test.mjs — the live screens' per-theme log (scripts/live/themes.mjs): every line
 * names its theme, and the lines that already do (a run's start, the repeat summary, which tooling
 * may read) stay exactly as they are.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { themeBase, themeLog } from './live/themes.mjs';
import { LIVE_BASE } from './live/stage.mjs';

const logged = (/** @type {string} */ theme, /** @type {string[]} */ lines) => {
  /** @type {string[]} */
  const out = [];
  const log = themeLog((m) => out.push(m), theme);
  for (const l of lines) log(l);
  return out;
};

test('the repeat summary and a run start are logged as they are', () => {
  const lines = [
    '[live] dark: 2 runs, 18 of 18 steps the same pixels and structure',
    '[live] dark: run 1 of 2',
  ];
  assert.deepEqual(logged('dark', lines), lines);
});

test('a line without its theme gets it', () => {
  assert.deepEqual(
    logged('light', [
      '[live] scratch store: 9 pass, 3 new',
      '[live] live--dismiss-1@light: fetch failed',
      'Error: something else',
    ]),
    [
      '[live] light: scratch store: 9 pass, 3 new',
      '[live] light: live--dismiss-1@light: fetch failed',
      '[live] light: Error: something else',
    ]
  );
});

test("each theme's workspace sits beside the staged one, at its depth", () => {
  assert.equal(themeBase('dark'), `${LIVE_BASE}-dark`);
  assert.notEqual(themeBase('dark'), themeBase('light'));
});
