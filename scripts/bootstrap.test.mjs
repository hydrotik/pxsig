// bootstrap.mjs: the pins it reads, the version test, and how it starts programs without a shell.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { atLeast, newest, onPath, parseVersion, pins, pnpmCommand } from './bootstrap.mjs';

/** @param {import('node:test').TestContext} t */
const tmp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-bootstrap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('versions: parsed from any tool output, compared field by field', () => {
  assert.deepEqual(parseVersion('v22.18.0'), [22, 18, 0]);
  assert.deepEqual(parseVersion('22.18'), [22, 18, 0]);
  assert.deepEqual(parseVersion('rustc 1.99.0 (b940084d7 2026-09-28)'), [1, 99, 0]);
  assert.equal(parseVersion('none'), null);
  assert.ok(atLeast([22, 22, 1], [22, 18, 0]));
  assert.ok(atLeast([22, 18, 0], [22, 18, 0]));
  assert.ok(!atLeast([22, 9, 9], [22, 18, 0]));
  assert.ok(atLeast([23, 0, 0], [22, 18, 0]));
});

test('pins: .nvmrc, packageManager and the rust-toolchain channel', (t) => {
  const dir = tmp(t);
  writeFileSync(join(dir, '.nvmrc'), '22.18\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.30.3' }));
  writeFileSync(join(dir, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.99.0"\n');
  assert.deepEqual(pins(dir), { node: '22.18', pnpm: '10.30.3', rust: '1.99.0' });
  assert.deepEqual(pins(tmp(t)), { node: null, pnpm: null, rust: null });
});

test('programs: a Windows .cmd shim is never picked (it needs cmd.exe)', (t) => {
  const dir = tmp(t);
  writeFileSync(join(dir, 'pnpm.cmd'), '');
  const win = { env: { PATH: dir }, platform: 'win32' };
  assert.equal(onPath('pnpm', win), null);
  assert.equal(pnpmCommand(win), null);
  writeFileSync(join(dir, 'pnpm.exe'), '');
  assert.equal(onPath('pnpm', win), join(dir, 'pnpm.exe'));
  // Run by pnpm: its own JS entry, through this Node.
  const ep = join(dir, 'pnpm.cjs');
  assert.deepEqual(pnpmCommand({ env: { npm_execpath: ep, PATH: '' }, platform: 'win32' }), [
    process.execPath,
    ep,
  ]);
  // npm's entry is not pnpm.
  assert.equal(pnpmCommand({ env: { npm_execpath: '/x/npm-cli.js', PATH: '' } }), null);
});

test('newest: the latest source time, skipping target/ and dot folders', (t) => {
  const dir = tmp(t);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'target'));
  writeFileSync(join(dir, 'src', 'a.rs'), '');
  writeFileSync(join(dir, 'target', 'b'), '');
  utimesSync(join(dir, 'src', 'a.rs'), 1000, 1000);
  utimesSync(join(dir, 'target', 'b'), 5000, 5000);
  assert.equal(newest([dir]), 1000 * 1000);
  assert.equal(newest([join(dir, 'missing')]), 0);
});

test('usage: an unknown flag exits 2 and changes nothing', () => {
  const script = fileURLToPath(new URL('bootstrap.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--chek'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/bootstrap\.mjs \[--check\]/);
});
