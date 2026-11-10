// The installed addon's self-test: what npm put in node_modules/@pxsig/storybook-addon gives
// Storybook a working preset and manager entry. Node built-ins and the addon's own files only: no
// Storybook, no network, no browser.
//
//   node --test "node_modules/@pxsig/storybook-addon/test/installed/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
/** @type {{ name: string, main: string, files: string[] }} */
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
/** @type {typeof import('../../preset.cjs')} */
const preset = require(manifest.name);

test('every file the manifest lists is in the package', () => {
  for (const f of manifest.files) assert.ok(existsSync(join(pkg, f)), f);
  assert.ok(existsSync(join(pkg, manifest.main)), manifest.main);
});

test('the package and its ./preset export resolve to one preset with the hooks Storybook calls', () => {
  assert.equal(require(`${manifest.name}/preset`), preset);
  for (const hook of /** @type {const} */ (['managerEntries', 'managerHead', 'staticDirs']))
    assert.equal(typeof preset[hook], 'function', hook);
});

test('managerEntries keeps the entries given and adds the shipped manager.mjs', () => {
  const entries = preset.managerEntries(['other-addon/manager']);
  assert.equal(entries.length, 2);
  assert.equal(entries[0], 'other-addon/manager');
  assert.ok(isAbsolute(entries[1]), entries[1]);
  assert.equal(entries[1], join(pkg, 'manager.mjs'));
});

test('managerHead appends one script that tells the manager which servers to probe', () => {
  const head = preset.managerHead('<meta name="x">', { server: 'http://127.0.0.1:7070/' });
  const m = /^<meta name="x"><script>window\.__PXSIG__=(.*)<\/script>$/.exec(head);
  assert.ok(m, head);
  assert.deepEqual(JSON.parse(m[1]), { servers: ['http://127.0.0.1:7070'], workspaceId: null });
});

test('staticDirs outside a production build returns the dirs as given', async () => {
  const dirs = [{ from: 'public', to: '/' }];
  assert.deepEqual(await preset.staticDirs(dirs, { configType: 'DEVELOPMENT' }), dirs);
});

test('manager.mjs parses, and each file it imports is shipped and exports the names it uses', async () => {
  const check = spawnSync(process.execPath, ['--check', join(pkg, 'manager.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr);
  const source = readFileSync(join(pkg, 'manager.mjs'), 'utf8');
  const local = [...source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/gm)];
  assert.ok(local.length > 0, 'manager.mjs imports its helpers');
  for (const [, names, from] of local) {
    assert.ok(manifest.files.includes(from.slice(2)), `${from} is listed in files`);
    const mod = await import(pathToFileURL(join(pkg, from)).href);
    for (const name of names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean))
      assert.ok(name in mod, `${from} exports ${name}`);
  }
});

test('the helpers run without Storybook', async () => {
  const pick = await import(pathToFileURL(join(pkg, 'server-pick.mjs')).href);
  assert.match(pick.DEFAULT_SERVER, /^http:\/\/127\.0\.0\.1:\d+$/);
  const view = await import(pathToFileURL(join(pkg, 'snapshot-view.mjs')).href);
  assert.equal(view.parseSnapshot('not a snapshot'), null);
  const snap = { format: 'pxsig-snapshot', version: 1, projects: [] };
  assert.equal(view.parseSnapshot(snap), snap);
  assert.equal(view.isLocalHost('localhost'), true);
});
