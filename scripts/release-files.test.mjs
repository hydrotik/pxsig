import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSums, copyBinaries, writeSums } from './release-files.mjs';

const script = fileURLToPath(new URL('./release-files.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-release-files-'));
  const art = join(root, 'artifacts');
  for (const [dir, exe] of [
    ['pxsig-darwin-arm64', 'pxsig'],
    ['pxsig-win32-x64', 'pxsig.exe'],
  ]) {
    mkdirSync(join(art, dir), { recursive: true });
    writeFileSync(join(art, dir, exe), `binary ${dir}`);
  }
  const out = join(root, 'out');
  mkdirSync(out);
  writeFileSync(join(out, 'pxsig-0.4.0.tgz'), 'tarball');
  return { root, art, out };
}

test('binaries are copied byte for byte and SHA256SUMS covers every file', () => {
  const { root, art, out } = fixture();
  try {
    assert.deepEqual(copyBinaries(art, out), ['pxsig-darwin-arm64', 'pxsig-win32-x64.exe']);
    assert.equal(readFileSync(join(out, 'pxsig-win32-x64.exe'), 'utf8'), 'binary pxsig-win32-x64');
    const sums = writeSums(out).trim().split('\n');
    assert.deepEqual(
      sums.map((l) => l.slice(66)),
      ['pxsig-0.4.0.tgz', 'pxsig-darwin-arm64', 'pxsig-win32-x64.exe']
    );
    assert.match(sums[0], /^[0-9a-f]{64} {2}pxsig-0\.4\.0\.tgz$/);
    assert.equal(checkSums(out).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--check fails on a changed or missing file', () => {
  const { root, art, out } = fixture();
  try {
    const run = spawnSync(process.execPath, [script, '--artifacts', art, '--out', out], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    writeFileSync(join(out, 'pxsig-0.4.0.tgz'), 'tampered');
    rmSync(join(out, 'pxsig-darwin-arm64'));
    const r = checkSums(out);
    assert.deepEqual(
      [r.ok, r.bad, r.missing],
      [false, ['pxsig-0.4.0.tgz'], ['pxsig-darwin-arm64']]
    );
    assert.equal(spawnSync(process.execPath, [script, '--check', out]).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an artifacts folder without binaries is an error', () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-release-files-'));
  try {
    assert.throws(
      () => copyBinaries(root, join(root, 'out')),
      /no pxsig-<platform>-<arch>\/ folders/
    );
    assert.equal(spawnSync(process.execPath, [script]).status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
