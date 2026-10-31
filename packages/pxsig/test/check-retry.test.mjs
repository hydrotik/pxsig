/**
 * check-retry.test.mjs — what `check` re-renders after a failure. An entry with no baseline yet has
 * nothing to compare with, so a fresh render cannot pass: it is not retried, and not called flaky.
 *
 *   node --test packages/pxsig/test/check-retry.test.mjs
 *
 * Needs the Rust binary and Chromium; skipped without them.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, rowsOf, src } from './server-helpers.mjs';
import { noBaseline } from '../src/lib/rows.mjs';

test('noBaseline is the engine verdict on an entry with no signature, nothing else', () => {
  assert.equal(
    noBaseline({ pass: false, error: 'no baseline sig (run baseline first): s/a.psig' }),
    true
  );
  assert.equal(noBaseline({ pass: false, error: 'PNG not found: a.png' }), false);
  assert.equal(noBaseline({ pass: false }), false);
  assert.equal(noBaseline(null), false);
});

test('a NEW entry is not retried: no retry render, not flaky', { skip: needs }, async () => {
  const f = fixture();
  const sb = await fakeStorybook(f.index.stories);
  try {
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: sb.url } }, null, 2));
    const out = await new Promise((ok) => {
      const p = spawn(
        process.execPath,
        [join(src, 'check.mjs'), '--only', f.ids.unregistered, '--retries', '2', '--no-a11y'],
        { cwd: f.repo, env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
      );
      let log = '';
      p.stdout.on('data', (d) => (log += d));
      p.stderr.on('data', (d) => (log += d));
      p.on('exit', (code) => ok({ code, log }));
    });
    assert.equal(out.code, 1, out.log);
    assert.doesNotMatch(out.log, /\[check\] retry \d/, out.log);
    const row = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.unregistered);
    assert.equal(row?.new, true);
    assert.notEqual(row?.flaky, true);
    assert.equal(row?.retry, undefined);
  } finally {
    sb.close();
  }
});
