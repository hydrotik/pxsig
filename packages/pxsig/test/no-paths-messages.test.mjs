/**
 * no-paths-messages.test.mjs — messages and log lines a person reads (and pastes into an issue)
 * carry no absolute path: doctor's machine rows, the "no readable manifest" error the server logs,
 * and the setup errors about a workspace or config file. An absolute path names the user.
 *
 *   node --test packages/pxsig/test/no-paths-messages.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { displayPath } from '../src/lib/machine.mjs';
import { reconcile } from '../src/lib/integrity/reconcile.mjs';
import { ensureStorybook } from '../src/lib/static.mjs';
import { findWorkspace, loadProject } from '../src/lib/workspace.mjs';
import { readJsonFile } from '../src/lib/workspace/core.mjs';
import { fixture, tempDir, testEnv, testHome } from './fixture.mjs';

/**
 * Fails when `text` names `dir` (as given or resolved), the temp folder or the home folder.
 * @param {string} text
 * @param {string} dir
 */
function noAbsolute(text, dir) {
  for (const p of [dir, realpathSync(dir), tmpdir(), realpathSync(tmpdir()), homedir()])
    assert.ok(!text.includes(p), `names an absolute path: ${text}`);
}

test('displayPath: workspace-relative, home-relative, else the name; never absolute', () => {
  const mac = { platform: 'darwin', home: '/Users/a', env: {} };
  assert.equal(
    displayPath('/srv/repo/node_modules/.cache/pxsig', { ...mac, root: '/srv/repo' }),
    'node_modules/.cache/pxsig'
  );
  assert.equal(displayPath('/srv/other/.cache/pxsig', { ...mac, root: '/srv/repo' }), 'pxsig');
  assert.equal(displayPath('/srv/other/.cache/pxsig/', mac), 'pxsig');
  const win = { platform: 'win32', home: 'C:\\Users\\a', env: { LOCALAPPDATA: '' } };
  assert.equal(displayPath('D:\\work\\repo\\.cache\\pxsig', win), 'pxsig');
});

test('doctor prints the approval guard folder without the workspace path', () => {
  const f = fixture({ withSigs: false });
  const cfg = tempDir('machine-home');
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
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
  assert.match(r.stdout, /Approval guard files/, r.stdout + r.stderr);
  noAbsolute(r.stdout + r.stderr, f.repo);
});

test('reconcile without a manifest names it relative to the workspace (the server logs it)', async () => {
  const root = tempDir('no-manifest');
  const ctx = /** @type {import('../src/lib/integrity/context.mjs').IntegrityContext} */ (
    /** @type {unknown} */ ({ repoRoot: root, manifestPath: join(root, '.pxsig', 'manifest.json') })
  );
  await assert.rejects(reconcile(ctx), (e) => {
    const err = /** @type {Error & { code?: string }} */ (e);
    assert.equal(err.message, 'no readable manifest at .pxsig/manifest.json');
    assert.equal(err.code, 'no-manifest');
    return true;
  });
});

test('setup errors about a workspace or config file name no absolute path', () => {
  const root = tempDir('setup-errors');
  mkdirSync(join(root, '.git'));
  const ws = join(root, 'pxsig.workspace.json');

  writeFileSync(ws, '{ "version": ');
  assert.throws(
    () => readJsonFile(ws),
    (e) => (noAbsolute(String(e), root), true)
  );
  assert.throws(
    () => readJsonFile(join(root, 'none.json')),
    (e) => (noAbsolute(String(e), root), true)
  );

  writeFileSync(ws, JSON.stringify({ version: 1, projects: [] }));
  assert.throws(
    () => findWorkspace({ cwd: root, env: {} }),
    (e) => (
      assert.match(/** @type {Error} */ (e).message, /^pxsig\.workspace\.json: "projects"/),
      true
    )
  );

  writeFileSync(ws, JSON.stringify({ version: 1, projects: { app: 'app' } }));
  const W = findWorkspace({ cwd: root, env: {} });
  assert.throws(
    () => loadProject(W, W.projects[0], { env: {} }),
    (e) => {
      assert.match(String(e), /no pxsig\.config\.json at app\/pxsig\.config\.json/);
      noAbsolute(String(e), root);
      return true;
    }
  );
});

test('a staticDir with no Storybook build is logged without its absolute path', async () => {
  const root = tempDir('static-dir');
  const dir = join(root, 'storybook-static');
  mkdirSync(dir);
  /** @type {string[]} */
  const logs = [];
  await ensureStorybook(
    { workspaceRoot: root, storybook: { url: 'http://127.0.0.1:1', staticDir: dir } },
    {
      log: (m) => logs.push(m),
      fetchImpl: () => Promise.reject(new Error('offline')),
    }
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^storybook\.staticDir storybook-static holds no Storybook build/);
  noAbsolute(logs[0], root);
});
