import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuild } from './check-dashboard-build.mjs';

const script = fileURLToPath(new URL('./check-dashboard-build.mjs', import.meta.url));
const SHA = 'a'.repeat(40);

/** @param {(dir: string) => void} fn */
const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-dashboard-build-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
/** @param {string} dir @param {unknown} record */
const write = (dir, record) => writeFileSync(join(dir, 'BUILD.json'), JSON.stringify(record));
const hydrotik = { adapter: 'hydrotik', designSystem: { commit: SHA, dirty: false }, bundled: [] };

test('a dashboard without BUILD.json fails, and the CLI exits 1', () =>
  inDir((dir) => {
    assert.match(checkBuild(dir).errors.join(), /no BUILD\.json/);
    const r = spawnSync(process.execPath, [script, dir, '--adapter', 'hydrotik'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'true' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^::error::no BUILD\.json/);
  }));

test('a release build records its adapter, its design-system commit and what it bundles', () =>
  inDir((dir) => {
    write(dir, hydrotik);
    assert.deepEqual(checkBuild(dir, { adapter: 'hydrotik', commit: SHA }), {
      errors: [],
      warnings: [],
    });
    assert.equal(spawnSync(process.execPath, [script, dir, '--commit', SHA]).status, 0);
    assert.deepEqual(checkBuild(dir, { adapter: 'plain' }).errors, [
      'BUILD.json: built with the hydrotik adapter, not plain',
    ]);
    assert.match(checkBuild(dir, { commit: 'b'.repeat(40) }).errors.join(), /not b{40}/);
    write(dir, { ...hydrotik, designSystem: null, bundled: undefined });
    assert.deepEqual(checkBuild(dir).errors, [
      'BUILD.json has no `bundled` list (the SBOM needs it)',
      'BUILD.json records no design-system commit (40-character SHA)',
    ]);
    write(dir, { ...hydrotik, designSystem: { commit: SHA, dirty: true } });
    assert.deepEqual(checkBuild(dir), {
      errors: [],
      warnings: ['the design-system checkout had changes when the dashboard was built'],
    });
    write(dir, { adapter: 'plain', designSystem: null, bundled: [] });
    assert.deepEqual(checkBuild(dir).errors, [], 'the plain adapter has no design system');
    writeFileSync(join(dir, 'BUILD.json'), '{');
    assert.match(checkBuild(dir).errors.join(), /not JSON/);
  }));

test('usage errors exit 2', () => {
  assert.equal(spawnSync(process.execPath, [script]).status, 2);
  assert.equal(spawnSync(process.execPath, [script, '.', '--commit']).status, 2);
});
