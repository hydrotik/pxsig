import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTree } from './lib/copy-tree.mjs';
import { devOnlyKeys, publishedManifest } from './pack-manifest.mjs';

const script = fileURLToPath(new URL('./pack-manifest.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

test('the published manifest drops scripts and devDependencies and keeps everything else in order', () => {
  const pj = {
    name: 'x',
    version: '1.0.0',
    scripts: { test: 't' },
    dependencies: { a: '1' },
    devDependencies: { b: '2' },
    files: ['src'],
  };
  assert.deepEqual(Object.keys(publishedManifest(pj)), [
    'name',
    'version',
    'dependencies',
    'files',
  ]);
  assert.deepEqual(devOnlyKeys(pj), ['scripts', 'devDependencies']);
  assert.deepEqual(devOnlyKeys(publishedManifest(pj)), []);
});

test('the packages that are published carry engines that agree', () => {
  const engines = ['pxsig', 'storybook-addon'].map(
    (p) => JSON.parse(readFileSync(join(repo, 'packages', p, 'package.json'), 'utf8')).engines?.node
  );
  assert.deepEqual(engines, ['>=22', '>=22']);
});

test(
  'a package rewritten and packed has no scripts in its tarball; --check finds one that does',
  {
    skip:
      spawnSync('npm', ['--version'], { shell: process.platform === 'win32' }).status !== 0 &&
      'npm is not on PATH',
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxsig-pack-manifest-'));
    /**
     * @param {string[]} args
     * @param {string} cwd
     */
    const npm = (args, cwd) =>
      spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
    try {
      const pkg = join(dir, 'pkg');
      const out = join(dir, 'out');
      for (const d of [pkg, out]) mkdirSync(d, { recursive: true });
      writeFileSync(join(pkg, 'index.js'), 'module.exports = 1;\n');
      const manifest = {
        name: 'pack-manifest-fixture',
        version: '1.0.0',
        scripts: { prepack: 'node -e 0' },
        devDependencies: { left: '1' },
      };
      writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
      assert.equal(npm(['pack', '--ignore-scripts', '--pack-destination', out], pkg).status, 0);
      const before = join(out, readdirSync(out)[0]);
      assert.equal(
        spawnSync(process.execPath, [script, '--check', before]).status,
        1,
        'an unrewritten manifest fails the check'
      );
      rmSync(before);
      // Rewritten but without its LICENSE: the check names the missing file.
      writeFileSync(join(pkg, 'package.json'), JSON.stringify(publishedManifest(manifest)));
      assert.equal(npm(['pack', '--ignore-scripts', '--pack-destination', out], pkg).status, 0);
      const bare = join(out, readdirSync(out)[0]);
      const noLicence = spawnSync(process.execPath, [script, '--check', bare], {
        encoding: 'utf8',
      });
      assert.equal(noLicence.status, 1);
      assert.match(noLicence.stderr, /does not hold LICENSE/);
      rmSync(bare);
      assert.equal(spawnSync(process.execPath, [script, pkg]).status, 0);
      assert.equal(
        readFileSync(join(pkg, 'LICENSE'), 'utf8'),
        readFileSync(join(repo, 'LICENSE'), 'utf8')
      );
      assert.equal(npm(['pack', '--ignore-scripts', '--pack-destination', out], pkg).status, 0);
      const r = spawnSync(process.execPath, [script, '--check', join(out, readdirSync(out)[0])], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'pxsig and the addon, prepared as the pack job prepares them, pack with the root LICENSE',
  {
    skip:
      spawnSync('npm', ['--version'], { shell: process.platform === 'win32' }).status !== 0 &&
      'npm is not on PATH',
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxsig-pack-licence-'));
    try {
      for (const name of ['pxsig', 'storybook-addon']) {
        const pkg = join(dir, name);
        copyTree(join(repo, 'packages', name), pkg, {
          filter: (p) => !p.split(/[\\/]/).some((s) => s === 'node_modules' || s === 'test'),
        });
        assert.equal(spawnSync(process.execPath, [script, pkg]).status, 0, name);
        const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
          cwd: pkg,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        });
        assert.equal(r.status, 0, r.stderr);
        /** @type {{ files: { path: string }[] }[]} */
        const [packed] = JSON.parse(r.stdout);
        assert.ok(
          packed.files.some((f) => f.path === 'LICENSE'),
          `${name}: LICENSE is in the tarball`
        );
        // A package.json: an object with `files`.
        const pj = /** @type {{ files: string[] }} */ (
          JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8'))
        );
        assert.ok(pj.files.includes('LICENSE'), `${name}: files lists LICENSE`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
