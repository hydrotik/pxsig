// tools/calibrate-*.mjs and scripts/product-shots.mjs on bad input: a clear message, never a TypeError.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
/**
 * @param {string} script
 * @param {string[]} args
 * @param {string} [cwd]
 */
const run = (script, args, cwd = repo) =>
  spawnSync(process.execPath, [join(repo, script), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PXSIG_WORKSPACE: '', PXSIG_PROJECT: '' },
  });

/** A project with an empty manifest and a scenarios report that is not JSON. */
const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-research-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.pxsig', 'reports'), { recursive: true });
  writeFileSync(join(root, 'pxsig.config.json'), '{}');
  writeFileSync(join(root, '.pxsig', 'manifest.json'), '{"version":2,"stories":[]}');
  writeFileSync(join(root, '.pxsig', 'reports', 'scenarios.json'), '{not json');
  return root;
};

for (const tool of ['calibrate-gate', 'calibrate-detail'])
  test(`${tool}: a scenarios report that cannot be read is named, exit 1`, () => {
    const r = run(`tools/${tool}.mjs`, [], project());
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(`^\\[${tool}\\] .*scenarios\\.json`, 'm'));
    assert.doesNotMatch(r.stderr, /TypeError/);
  });

test('calibrate-detail: --builds without a value is a usage error, exit 2', () => {
  const r = run('tools/calibrate-detail.mjs', ['--builds'], project());
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^usage: node tools\/calibrate-detail\.mjs/m);
});

test('calibrate-gate: --detail-build without a value is a usage error, exit 2', () => {
  const r = run('tools/calibrate-gate.mjs', ['--detail-build'], project());
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^usage: node tools\/calibrate-gate\.mjs/m);
});

test('product-shots: --out without a value is a usage error, exit 2', () => {
  const r = run('scripts/product-shots.mjs', ['--out']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^usage: node scripts\/product-shots\.mjs/m);
});
