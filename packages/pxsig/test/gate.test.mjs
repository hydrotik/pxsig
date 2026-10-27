// Gate precedence through the real binary: story `parameters.pxsig.gate` > CLI flags > PXSIG_*
// environment > the project config (manifest gate) > defaults. Synthetic PNGs, a temp folder.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BROKEN, CHECKER, hasRust, rustBin } from './fixture.mjs';

const lenient = { threshold: 255, minSsim: 0, maxChangedPct: 100, minCells: 100000, detail: false };
const strict = { threshold: 4, minSsim: 0.999, maxChangedPct: 0, minCells: 1, detail: false };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-gate-'));
  mkdirSync(join(dir, 'base'));
  mkdirSync(join(dir, 'cur'));
  for (const id of ['plain', 'pinned']) {
    writeFileSync(join(dir, 'base', `${id}.png`), CHECKER);
    writeFileSync(join(dir, 'cur', `${id}.png`), BROKEN);
    const r = spawnSync(
      rustBin,
      [
        'capture',
        join(dir, 'base', `${id}.png`),
        '--out',
        join(dir, `${id}.pxsig.json`),
        '--grid',
        '16',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
  }
  // The project config gate is strict; `pinned` carries its own strict story gate.
  const manifest = {
    version: 2,
    grid: 16,
    detail: false,
    gate: strict,
    stories: [
      { id: 'plain', sig: 'plain.pxsig.json' },
      { id: 'pinned', sig: 'pinned.pxsig.json', gate: strict },
    ],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

const check = (dir, extra = [], env = {}) => {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^PXSIG_(THRESHOLD|MIN_SSIM|MAX_CHANGED_PCT|MAX_EDGE_PCT|MIN_CELLS)$/.test(k)
    )
  );
  const r = spawnSync(
    rustBin,
    [
      'check',
      '--manifest',
      join(dir, 'manifest.json'),
      '--png-dir',
      join(dir, 'cur'),
      '--root',
      dir,
      '--artifacts',
      'none',
      '--json',
      ...extra,
    ],
    { encoding: 'utf8', env: { ...clean, ...env } }
  );
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  return Object.fromEntries(JSON.parse(r.stdout).results.map((x) => [x.id, x]));
};

const envOf = (g) => ({
  PXSIG_THRESHOLD: String(g.threshold),
  PXSIG_MIN_SSIM: String(g.minSsim),
  PXSIG_MAX_CHANGED_PCT: String(g.maxChangedPct),
  PXSIG_MIN_CELLS: String(g.minCells),
});
const flagsOf = (g) => [
  '--threshold',
  String(g.threshold),
  '--min-ssim',
  String(g.minSsim),
  '--max-changed-pct',
  String(g.maxChangedPct),
  '--min-cells',
  String(g.minCells),
];

test('the project gate fails a real change', { skip: !hasRust && 'Rust binary not built' }, () => {
  const r = check(setup());
  assert.equal(r.plain.pass, false);
  assert.equal(r.pinned.pass, false);
});

test(
  'environment beats the project gate, but not a story gate',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const r = check(setup(), [], envOf(lenient));
    assert.equal(r.plain.pass, true);
    assert.equal(r.plain.gate.minSsim, 0);
    assert.equal(r.pinned.pass, false, 'PXSIG_* must not override parameters.pxsig.gate');
    assert.equal(r.pinned.gate.minSsim, 0.999);
  }
);

test(
  'CLI flags beat the environment, but not a story gate',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const dir = setup();
    const r = check(dir, flagsOf(lenient), envOf(strict));
    assert.equal(r.plain.pass, true, 'flags beat env');
    assert.equal(r.pinned.pass, false, 'flags must not override parameters.pxsig.gate');
    const r2 = check(dir, flagsOf(strict), envOf(lenient));
    assert.equal(r2.plain.pass, false, 'flags beat env (other way round)');
  }
);
