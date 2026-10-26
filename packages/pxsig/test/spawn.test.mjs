/**
 * spawn.test.mjs — the programs pxsig starts (docs/platforms.md, "Programs pxsig starts"): one
 * module starts them, it refuses anything off the list, and --debug prints each start.
 *
 *   node --test packages/pxsig/test/spawn.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { refused, spawnSync } from '../src/lib/spawn.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the list, per OS', () => {
  for (const os of ['darwin', 'linux', 'win32']) {
    assert.equal(refused(process.execPath, os), null, `node on ${os}`);
    assert.equal(refused('git', os), null, `git on ${os}`);
    assert.equal(refused('/x/target/release/pxsig', os), null, `the engine on ${os}`);
    assert.equal(refused('C:\\x\\pxsig.exe', os), null, `the engine .exe on ${os}`);
  }
  for (const p of ['ps', 'osascript', 'open']) assert.equal(refused(p, 'darwin'), null, p);
  for (const p of ['ps', 'xdg-open']) assert.equal(refused(p, 'linux'), null, p);
  for (const p of ['ps', 'osascript', 'open', 'xdg-open']) assert.match(refused(p, 'win32'), /does not start/, `${p} on Windows`);
});

test('never a shell or a system tool', () => {
  for (const os of ['darwin', 'linux', 'win32'])
    for (const p of ['cmd.exe', 'cmd', 'start', 'powershell', 'pwsh', 'icacls', 'whoami', 'rundll32', 'reg', 'schtasks', 'sh', 'bash', 'npx', 'curl'])
      assert.match(refused(p, os), /Programs pxsig starts/, `${p} on ${os}`);
  assert.throws(() => spawnSync('git', ['--version'], { shell: true }), /does not start a shell/);
  assert.throws(() => spawnSync('cmd.exe', ['/c', 'echo']), /does not start "cmd\.exe"/);
});

test('every start goes through lib/spawn.mjs', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name) && /node:child_process|['"]child_process['"]/.test(readFileSync(p, 'utf8'))) offenders.push(relative(pkg, p).split('\\').join('/'));
    }
  };
  walk(join(pkg, 'src'));
  walk(join(pkg, 'bin'));
  assert.deepEqual(offenders, ['src/lib/spawn.mjs']);
});

test('PXSIG_DEBUG=spawn prints each start', () => {
  const code = `import { spawnSync } from ${JSON.stringify(new URL('../src/lib/spawn.mjs', import.meta.url).href)}; spawnSync(process.execPath, ['-e', '']);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, PXSIG_DEBUG: 'spawn' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^\[spawn\] .*node(\.exe)? -e/m);
});
