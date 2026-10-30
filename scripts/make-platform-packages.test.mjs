import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name: string, version: string, license?: string, repository?: { type: string, url: string }, os?: string[], cpu?: string[], libc?: string[], files?: string[], bin?: unknown }} PlatformManifest */

const script = fileURLToPath(new URL('./make-platform-packages.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'];
/** @param {string} id */
const exeOf = (id) => (id.startsWith('win32-') ? 'pxsig.exe' : 'pxsig');

/** @param {string[]} args */
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

/**
 * A temp folder holding `artifacts/pxsig-<id>/pxsig[.exe]` for each id, as download-artifact lays
 * them out in the release's pack job.
 * @param {string[]} ids
 */
function artifacts(ids) {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-platform-packages-'));
  for (const id of ids) {
    mkdirSync(join(dir, 'artifacts', `pxsig-${id}`), { recursive: true });
    writeFileSync(join(dir, 'artifacts', `pxsig-${id}`, exeOf(id)), `engine for ${id}\n`);
  }
  return dir;
}

/**
 * @param {string} out
 * @param {string} id
 * @returns {PlatformManifest}
 */
const manifestOf = (out, id) =>
  /** @type {PlatformManifest} */ (
    JSON.parse(readFileSync(join(out, `cli-${id}`, 'package.json'), 'utf8'))
  );

test('every platform package is named, restricted and laid out as rustBinary() resolves it', () => {
  const dir = artifacts(PLATFORMS);
  try {
    const out = join(dir, 'out');
    const r = run(['--version', '1.2.3', '--artifacts', join(dir, 'artifacts'), '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    for (const id of PLATFORMS) {
      const [platform, arch] = id.split('-');
      const m = manifestOf(out, id);
      assert.equal(m.name, `@pxsig/cli-${id}`);
      assert.equal(m.version, '1.2.3');
      assert.deepEqual(m.os, [platform]);
      assert.deepEqual(m.cpu, [arch]);
      // The Linux binaries are glibc builds (*-unknown-linux-gnu); other platforms have no libc.
      assert.deepEqual(m.libc, platform === 'linux' ? ['glibc'] : undefined, `${id}: libc`);
      // The engine is found by path, not run through a `bin` link.
      assert.equal(m.bin, undefined, `${id}: bin`);
      assert.deepEqual(m.files, ['bin']);
      assert.equal(m.license, 'MIT');
      assert.equal(m.repository?.url, 'git+https://github.com/hydrotik/pxsig.git');
      const bin = join(out, `cli-${id}`, 'bin', exeOf(id));
      assert.equal(readFileSync(bin, 'utf8'), `engine for ${id}\n`, `${id}: bin/${exeOf(id)}`);
      assert.ok(existsSync(join(out, `cli-${id}`, 'README.md')));
    }
    // rustBinary() (packages/pxsig/src/lib/workspace/peers.mjs) resolves the same name and path.
    const workspace = readFileSync(
      join(repo, 'packages/pxsig/src/lib/workspace/peers.mjs'),
      'utf8'
    );
    assert.ok(
      workspace.includes('`@pxsig/cli-${process.platform}-${process.arch}/bin/${exe}`'),
      'rustBinary resolves @pxsig/cli-<platform>-<arch>/bin/<exe>'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--write-optional-deps pins every generated package at the version, sorted, keeping others', () => {
  const dir = artifacts(['linux-x64', 'win32-x64']);
  try {
    const pj = join(dir, 'package.json');
    writeFileSync(
      pj,
      JSON.stringify({ name: 'pxsig', version: '0.0.1', optionalDependencies: { zzz: '1.0.0' } })
    );
    const r = run([
      '--version',
      '0.0.0-ci',
      '--artifacts',
      join(dir, 'artifacts'),
      '--out',
      join(dir, 'out'),
      '--allow-missing',
      '--write-optional-deps',
      pj,
    ]);
    assert.equal(r.status, 0, r.stderr);
    /** @type {{ version: string, repository?: { url: string }, optionalDependencies: Record<string, string> }} */
    const after = JSON.parse(readFileSync(pj, 'utf8'));
    assert.equal(after.version, '0.0.0-ci');
    assert.deepEqual(after.optionalDependencies, {
      '@pxsig/cli-linux-x64': '0.0.0-ci',
      '@pxsig/cli-win32-x64': '0.0.0-ci',
      zzz: '1.0.0',
    });
    assert.equal(after.repository?.url, 'git+https://github.com/hydrotik/pxsig.git');
    assert.match(r.stderr, /skipping darwin-arm64/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--only builds the platforms named; a missing binary fails unless --allow-missing', () => {
  const dir = artifacts(['darwin-arm64']);
  try {
    const base = ['--version', '1.0.0', '--artifacts', join(dir, 'artifacts')];
    const only = run([...base, '--out', join(dir, 'a'), '--only', 'darwin-arm64']);
    assert.equal(only.status, 0, only.stderr);
    assert.ok(existsSync(join(dir, 'a', 'cli-darwin-arm64', 'package.json')));
    assert.ok(!existsSync(join(dir, 'a', 'cli-linux-x64')));
    const missing = run([...base, '--out', join(dir, 'b')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing binaries/);
    assert.ok(!existsSync(join(dir, 'b')), 'nothing is written when a binary is missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage errors exit 2', () => {
  for (const args of [
    [],
    ['--version', 'one', '--artifacts', '.', '--out', 'x'],
    ['--version', '1.0.0', '--artifacts', '.', '--out', 'x', '--only', 'plan9-mips'],
    ['--bogus'],
  ])
    assert.equal(run(args).status, 2, args.join(' '));
});
