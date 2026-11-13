// The verdicts of pxsig's own screens (lib/screens-verdict.mjs): the dashboard project's gate, this
// checkout's engine, and a badge wash failing on the color rule; an engine without the rule refused.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasRust, png, rustBin, tempDir } from '../packages/pxsig/test/fixture.mjs';
import { openProject } from '../packages/pxsig/src/lib/workspace.mjs';
import { runManifest } from '../packages/pxsig/src/lib/workspace/run-manifest.mjs';
import { assertVerdicts, verdictEngine } from './lib/screens-verdict.mjs';

const dashboard = fileURLToPath(new URL('../packages/dashboard', import.meta.url));

/** A 900×600 white screen with a 40×16 badge filled with `fill`. @param {number[]} fill */
const screen = (fill) =>
  png(900, 600, (x, y) => (x >= 400 && x < 440 && y >= 300 && y < 316 ? fill : [255, 255, 255]));

test("the verdict engine is this checkout's build when PXSIG_LIVE_BIN names one", () => {
  assert.equal(
    verdictEngine({ PXSIG_LIVE_BIN: '/w/target/linux/release/pxsig' }, '/image/pxsig'),
    '/w/target/linux/release/pxsig'
  );
  assert.equal(verdictEngine({}, '/image/pxsig'), '/image/pxsig');
});

test('a verdict made without the color rule is refused, naming the fix', () => {
  assert.throws(
    () => assertVerdicts([{ id: 'overview--counts-1@dark', pass: true, metrics: { ssim: 1 } }]),
    /overview--counts-1@dark was checked by an engine without the color rule[\s\S]*set PXSIG_LIVE_BIN to a Linux build/
  );
  assertVerdicts([
    { id: 'a', pass: true, metrics: { ssim: 1 }, color: null },
    { id: 'b', error: 'no baseline sig' },
  ]);
});

test(
  "the dashboard's screens: a badge wash fails on the color rule, with the project's gate",
  { skip: !hasRust && 'Rust binary not built' },
  (t) => {
    const d = tempDir('screens-verdict', t);
    for (const sub of ['base', 'cur']) mkdirSync(join(d, sub));
    writeFileSync(join(d, 'base', 'e.png'), screen([241, 242, 245]));
    writeFileSync(join(d, 'cur', 'e.png'), screen([222, 233, 226]));
    const bin = verdictEngine({ PXSIG_LIVE_BIN: rustBin }, '/the/image/engine');
    const cap = spawnSync(
      bin,
      ['capture', join(d, 'base', 'e.png'), '--out', join(d, 'e.psig'), '--detail'],
      { encoding: 'utf8' }
    );
    assert.equal(cap.status, 0, cap.stderr);
    // The run manifest as screens-check writes it: the dashboard project's resolved settings.
    const P = openProject({ cwd: dashboard, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
    const run = runManifest(
      P,
      /** @type {any} */ ({
        version: 2,
        stories: [{ id: 'e', story: 'e', mode: 'dark', sig: 'e.psig' }],
      })
    );
    assert.deepEqual(run.gate.color, { deltaE: 3, minArea: 64, cellDeltaE: 5, minCells: 3 });
    writeFileSync(join(d, 'run.json'), JSON.stringify(run));
    const r = spawnSync(
      bin,
      [
        'check',
        '--manifest',
        join(d, 'run.json'),
        '--png-dir',
        join(d, 'cur'),
        '--root',
        d,
        '--json',
        '--artifacts',
        'none',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 1, r.stderr);
    const { results } = JSON.parse(r.stdout);
    assertVerdicts(results);
    assert.equal(results[0].pass, false);
    assert.deepEqual(results[0].reasons, [
      'color ΔE00 7.8 over 532 px (flat area) >= 3',
      'color cells 4 >= 3 (ΔE00 >= 5)',
    ]);
  }
);
