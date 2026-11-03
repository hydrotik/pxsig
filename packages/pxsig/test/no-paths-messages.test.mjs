/**
 * no-paths-messages.test.mjs — messages and log lines a person reads (and pastes into an issue)
 * carry no absolute path: doctor's machine rows and `--json` machine paths, the "no readable
 * manifest" error the server logs, the setup errors about a workspace or config file, and the
 * paths a person pastes or opens from the current folder (`dashboard build`'s serve line, the
 * static report's page, `--plain` image paths). An absolute path names the user.
 *
 *   node --test packages/pxsig/test/no-paths-messages.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtText } from '../src/dashboard.mjs';
import { herePath, machinePath } from '../src/lib/machine.mjs';
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

test('machinePath: workspace-relative, else ~/…, else ../ from the workspace; never absolute', () => {
  const mac = { platform: 'darwin', home: '/Users/a' };
  const root = '/srv/repo';
  assert.equal(
    machinePath(`${root}/node_modules/.cache/pxsig`, { ...mac, root }),
    'node_modules/.cache/pxsig'
  );
  assert.equal(machinePath('/Users/a/.config/pxsig', { ...mac, root }), '~/.config/pxsig');
  assert.equal(machinePath('/srv/other/.cache/pxsig', { ...mac, root }), '../other/.cache/pxsig');
  assert.equal(machinePath('/Users/a/repo/x', { ...mac, root: '/Users/a/repo' }), 'x');
});

test('herePath: ./ inside the current folder, ../ outside, ~/ when only that hides the home folder', () => {
  const mac = { platform: 'darwin', home: '/Users/a' };
  const cwd = '/Users/a/repo';
  assert.equal(herePath('/Users/a/repo/.pxsig/x.png', { ...mac, cwd }), './.pxsig/x.png');
  assert.equal(herePath('/Users/a/repo', { ...mac, cwd }), '.');
  assert.equal(herePath('/Users/a/site/index.html', { ...mac, cwd }), '../site/index.html');
  assert.equal(herePath('/srv/site', { ...mac, cwd }), '../../../srv/site');
  // From outside the home folder, a ../ path would spell it out.
  assert.equal(herePath('/Users/a/site', { ...mac, cwd: '/srv/repo' }), '~/site');
  assert.equal(herePath('/opt/site', { ...mac, cwd: '/srv/repo' }), '../../opt/site');
});

test('dashboard build prints a serve line that pastes from the current folder', () => {
  const cwd = tempDir('dash-build');
  const text = builtText(join(cwd, 'out dir'), false, cwd);
  assert.equal(text, "built ./out dir\nserve it: PXSIG_DASHBOARD_DIR='./out dir' pxsig serve");
  const away = builtText(join(dirname(cwd), 'elsewhere'), true, cwd);
  assert.match(away, /^built \.\.\/elsewhere\n/);
  for (const t of [text, away]) {
    noAbsolute(t, cwd);
    assert.doesNotMatch(t, /(^|[\s='])\//m, 'no path starts with /');
  }
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

/**
 * Run the pxsig CLI in `cwd` with a home folder of its own.
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} home
 * @param {Record<string, string>} [env]
 */
function pxsig(args, cwd, home, env = {}) {
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...testEnv(testHome),
      PXSIG_WORKSPACE: '',
      PXSIG_NO_DELEGATE: '1',
      PXSIG_URL: 'http://127.0.0.1:1',
      XDG_CONFIG_HOME: join(home, '.config'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      HOME: home,
      USERPROFILE: home,
      ...env,
    },
  });
}

test('doctor --json gives its machine paths workspace- or home-relative', () => {
  const f = fixture({ withSigs: false });
  const home = tempDir('json-home');
  const r = pxsig(['doctor', '--offline', '--json'], f.repo, home);
  const { machine } = JSON.parse(r.stdout);
  noAbsolute(JSON.stringify(machine), f.repo);
  noAbsolute(r.stdout, f.repo);
  assert.match(machine.settings, /^~\/.*settings\.json$/);
  for (const p of [machine.settings, machine.tokens]) assert.ok(!isAbsolute(p), p);
});

test('entry --plain prints image paths that open from the current folder', () => {
  const f = fixture();
  const home = tempDir('plain-home');
  const sub = join(f.repo, 'src');
  for (const [cwd, head] of [
    [f.repo, './.pxsig/'],
    [sub, '../.pxsig/'],
  ]) {
    const r = pxsig(['entry', 'components-alpha--default', '--plain'], cwd, home);
    assert.equal(r.status, 0, r.stderr);
    noAbsolute(r.stdout, f.repo);
    const current = /- current: (\S+)/.exec(r.stdout)?.[1] ?? '';
    assert.ok(current.startsWith(head), r.stdout);
    assert.ok(existsSync(resolve(cwd, current)), current);
  }
});

test('report prints the page it wrote relative to the current folder', () => {
  const f = fixture({ withSigs: false });
  const home = tempDir('report-home');
  const dash = tempDir('report-dash');
  mkdirSync(join(dash, 'assets'));
  writeFileSync(join(dash, 'index.html'), '<!doctype html><title>pxsig</title>');
  const out = join(tempDir('report-out'), 'site');
  const r = pxsig(['report', '--out', out], f.repo, home, { PXSIG_DASHBOARD_DIR: dash });
  assert.equal(r.status, 0, r.stderr);
  noAbsolute(r.stdout, f.repo);
  const page = /\[report\] (\S.*?) · project/.exec(r.stdout)?.[1] ?? '';
  assert.match(page, /^\.\.\//);
  assert.ok(existsSync(resolve(f.repo, page)), page);
});
