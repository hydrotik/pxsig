/**
 * machine.test.mjs — what pxsig keeps per machine (lib/machine.mjs): the folder on each OS,
 * settings.json read and written whole, and where the server's token files go on Windows.
 *
 *   node --test packages/pxsig/test/machine.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tokenFile } from '../src/lib/guard.mjs';
import {
  displayPath,
  machineDir,
  readSettings,
  settingsPath,
  windowsTokenDir,
  writeSettings,
} from '../src/lib/machine.mjs';
import { fixture, tempDir, testEnv, testHome } from './fixture.mjs';

const tmp = () => tempDir('machine');

test('one folder per machine, never the roaming profile', () => {
  assert.equal(
    machineDir({ platform: 'darwin', home: '/Users/a', env: {} }),
    join('/Users/a', 'Library', 'Application Support', 'pxsig')
  );
  assert.equal(
    machineDir({ platform: 'linux', home: '/home/a', env: {} }),
    join('/home/a', '.config', 'pxsig')
  );
  assert.equal(
    machineDir({ platform: 'linux', home: '/home/a', env: { XDG_CONFIG_HOME: '/cfg' } }),
    join('/cfg', 'pxsig')
  );
  assert.equal(
    machineDir({
      platform: 'win32',
      home: 'C:\\Users\\a',
      env: {
        LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
        APPDATA: 'C:\\Users\\a\\AppData\\Roaming',
      },
    }),
    join('C:\\Users\\a\\AppData\\Local', 'pxsig')
  );
  assert.equal(
    machineDir({ platform: 'win32', home: 'C:\\Users\\a', env: {} }),
    join('C:\\Users\\a', 'AppData', 'Local', 'pxsig'),
    'without LOCALAPPDATA: its default place'
  );
});

test('settings.json: missing means not set up; a write replaces it whole', () => {
  const opts = { platform: 'linux', env: { XDG_CONFIG_HOME: tmp() } };
  assert.deepEqual(readSettings(opts), { path: settingsPath(opts), exists: false, settings: {} });
  writeSettings({ managed: true }, opts);
  writeSettings({ managed: false, trigger: 'manual' }, opts);
  assert.deepEqual(readSettings(opts).settings, { managed: false, trigger: 'manual' });
  assert.deepEqual(readdirSync(machineDir(opts)), ['settings.json'], 'no temp file left behind');
  assert.ok(readFileSync(settingsPath(opts), 'utf8').endsWith('\n'));
});

test('an unreadable settings.json reads as not set up', () => {
  const opts = { platform: 'linux', env: { XDG_CONFIG_HOME: tmp() } };
  writeSettings({}, opts);
  const p = settingsPath(opts);
  spawnSync(process.execPath, [
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(p)}, '{ broken')`,
  ]);
  assert.equal(readSettings(opts).exists, false);
});

test('Windows token files: in the profile, one folder per workspace, case-insensitive', () => {
  const opts = { env: { LOCALAPPDATA: 'C:\\L' } };
  assert.equal(windowsTokenDir('C:\\Repo\\a', opts), windowsTokenDir('c:\\repo\\A', opts));
  assert.notEqual(windowsTokenDir('C:\\Repo\\a', opts), windowsTokenDir('C:\\Repo\\b', opts));
  assert.ok(windowsTokenDir('C:\\Repo\\a', opts).startsWith(join('C:\\L', 'pxsig', 'tokens')));
  const root = tmp();
  assert.equal(
    dirname(tokenFile(root, 'http://127.0.0.1:6070', 'cli', 'darwin')),
    join(root, 'node_modules', '.cache', 'pxsig'),
    'macOS and Linux: beside server.json, as before'
  );
  assert.equal(
    dirname(tokenFile(root, 'http://127.0.0.1:6070', 'mcp', 'win32')),
    windowsTokenDir(root)
  );
  assert.match(tokenFile(root, 'http://127.0.0.1:6071', 'mcp', 'win32'), /serve-6071\.mcp\.token$/);
});

test("pxsig doctor names this machine's settings and token folder", () => {
  const f = fixture();
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
  const cfg = tmp();
  const r = spawnSync(process.execPath, [cli, 'doctor', '--offline', '--json'], {
    cwd: f.repo,
    encoding: 'utf8',
    env: {
      ...testEnv(testHome),
      PXSIG_WORKSPACE: '',
      PXSIG_NO_DELEGATE: '1',
      XDG_CONFIG_HOME: cfg,
      LOCALAPPDATA: cfg,
      HOME: cfg,
    },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.machine.setUp, false);
  assert.ok(out.machine.settings.endsWith('settings.json'));
  assert.ok(out.machine.tokens.length > 0);
  assert.ok(!existsSync(join(cfg, 'pxsig')), 'doctor only reads');
});

test('doctor prints machine paths home-relative, so pasted output carries no user name', () => {
  const mac = { platform: 'darwin', home: '/Users/a', env: {} };
  assert.equal(
    displayPath(`${mac.home}/Library/Application Support/pxsig/settings.json`, mac),
    '~/Library/Application Support/pxsig/settings.json'
  );
  assert.equal(displayPath(`${mac.home}b/x`, mac), `${mac.home}b/x`, 'only the home folder itself');
  assert.equal(
    displayPath('/srv/repo/node_modules/.cache/pxsig', mac),
    '/srv/repo/node_modules/.cache/pxsig'
  );
  const win = {
    platform: 'win32',
    home: 'C:\\Users\\a',
    env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' },
  };
  assert.equal(
    displayPath('c:\\users\\a\\AppData\\Local\\pxsig\\settings.json', win),
    '%LOCALAPPDATA%\\pxsig\\settings.json'
  );
  assert.equal(displayPath('C:\\Users\\a\\repo\\x', win), '%USERPROFILE%\\repo\\x');

  const f = fixture();
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
  const cfg = tmp();
  const r = spawnSync(process.execPath, [cli, 'doctor', '--offline', '--plain'], {
    cwd: f.repo,
    encoding: 'utf8',
    env: {
      ...testEnv(testHome),
      PXSIG_WORKSPACE: '',
      PXSIG_NO_DELEGATE: '1',
      XDG_CONFIG_HOME: join(cfg, '.config'),
      LOCALAPPDATA: join(cfg, 'AppData', 'Local'),
      HOME: cfg,
      USERPROFILE: cfg,
    },
  });
  assert.match(
    r.stdout,
    /Settings.*(~|%LOCALAPPDATA%).*settings\.json \(not used in this version\)/
  );
  assert.match(r.stdout, /Approval guard files/);
  assert.ok(!r.stdout.includes(join(cfg, 'Library')), 'no absolute home path');
});
