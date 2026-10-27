import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devOnlyKeys, publishedManifest } from './pack-manifest.mjs';

const script = fileURLToPath(new URL('./pack-manifest.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

test('the published manifest drops scripts and devDependencies and keeps everything else in order', () => {
  const pj = { name: 'x', version: '1.0.0', scripts: { test: 't' }, dependencies: { a: '1' }, devDependencies: { b: '2' }, files: ['src'] };
  assert.deepEqual(Object.keys(publishedManifest(pj)), ['name', 'version', 'dependencies', 'files']);
  assert.deepEqual(devOnlyKeys(pj), ['scripts', 'devDependencies']);
  assert.deepEqual(devOnlyKeys(publishedManifest(pj)), []);
});

test('the packages that are published carry engines that agree', () => {
  const engines = ['pxsig', 'storybook-addon'].map((p) => JSON.parse(readFileSync(join(repo, 'packages', p, 'package.json'), 'utf8')).engines?.node);
  assert.deepEqual(engines, ['>=22', '>=22']);
});

test('a package rewritten and packed has no scripts in its tarball; --check finds one that does', { skip: spawnSync('npm', ['--version'], { shell: process.platform === 'win32' }).status !== 0 && 'npm is not on PATH' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-pack-manifest-'));
  const npm = (args, cwd) => spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  try {
    const pkg = join(dir, 'pkg');
    const out = join(dir, 'out');
    for (const d of [pkg, out]) mkdirSync(d, { recursive: true });
    writeFileSync(join(pkg, 'index.js'), 'module.exports = 1;\n');
    const manifest = { name: 'pack-manifest-fixture', version: '1.0.0', scripts: { prepack: 'node -e 0' }, devDependencies: { left: '1' } };
    writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
    assert.equal(npm(['pack', '--ignore-scripts', '--pack-destination', out], pkg).status, 0);
    const before = join(out, readdirSync(out)[0]);
    assert.equal(spawnSync(process.execPath, [script, '--check', before]).status, 1, 'an unrewritten manifest fails the check');
    rmSync(before);
    assert.equal(spawnSync(process.execPath, [script, pkg]).status, 0);
    assert.equal(npm(['pack', '--ignore-scripts', '--pack-destination', out], pkg).status, 0);
    const r = spawnSync(process.execPath, [script, '--check', join(out, readdirSync(out)[0])], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
