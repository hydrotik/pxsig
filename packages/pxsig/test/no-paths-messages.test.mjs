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
import { notKept } from '../src/lib/decisions.mjs';
import { herePath, machinePath } from '../src/lib/machine.mjs';
import { reconcile } from '../src/lib/integrity/reconcile.mjs';
import { ensureStorybook } from '../src/lib/static.mjs';
import { findWorkspace, loadProject, openProject } from '../src/lib/workspace.mjs';
import { readJsonFile } from '../src/lib/workspace/core.mjs';
import { fixture, hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { startServer } from './server-proc.mjs';
import { skipUnless } from './strict.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Fails when `text` names `dir` (as given or resolved), the temp folder or the home folder.
 * @param {string} text
 * @param {string} dir
 */
function noAbsolute(text, dir) {
  for (const p of [dir, realpathSync(dir), tmpdir(), realpathSync(tmpdir()), homedir()])
    assert.ok(!text.includes(p), `names an absolute path: ${text}`);
}

// POSIX paths (a made-up home folder): the spawned commands below cover each OS's own paths.
const posix = { skip: process.platform === 'win32' && 'POSIX paths' };

test(
  'machinePath: workspace-relative, else ~/…, else ../ from the workspace; never absolute',
  posix,
  () => {
    const mac = { platform: 'darwin', home: '/h/a' };
    const root = '/srv/repo';
    assert.equal(
      machinePath(`${root}/node_modules/.cache/pxsig`, { ...mac, root }),
      'node_modules/.cache/pxsig'
    );
    assert.equal(machinePath('/h/a/.config/pxsig', { ...mac, root }), '~/.config/pxsig');
    assert.equal(machinePath('/srv/other/.cache/pxsig', { ...mac, root }), '../other/.cache/pxsig');
    assert.equal(machinePath('/h/a/repo/x', { ...mac, root: '/h/a/repo' }), 'x');
  }
);

test(
  'herePath: ./ inside the current folder, ../ outside, ~/ when only that hides the home folder',
  posix,
  () => {
    const mac = { platform: 'darwin', home: '/h/a' };
    const cwd = '/h/a/repo';
    assert.equal(herePath('/h/a/repo/.pxsig/x.png', { ...mac, cwd }), './.pxsig/x.png');
    assert.equal(herePath('/h/a/repo', { ...mac, cwd }), '.');
    assert.equal(herePath('/h/a/site/index.html', { ...mac, cwd }), '../site/index.html');
    assert.equal(herePath('/srv/site', { ...mac, cwd }), '../../../srv/site');
    // From outside the home folder, a ../ path would spell it out.
    assert.equal(herePath('/h/a/site', { ...mac, cwd: '/srv/repo' }), '~/site');
    assert.equal(herePath('/opt/site', { ...mac, cwd: '/srv/repo' }), '../../opt/site');
  }
);

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

test('"Reason not kept" and doctor\'s reports-not-ignored name the store, never an absolute path', () => {
  const f = fixture({ withSigs: false });
  spawnSync('git', ['init', '-q', f.repo]);
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
  const r = spawnSync(process.execPath, [cli, 'doctor', '--offline', '--json'], {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...testEnv(testHome), PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1' },
  });
  const d = JSON.parse(r.stdout);
  const setup = /** @type {{ code: string, reason: string }[]} */ ((d.projects?.[0] ?? d).setup);
  const w = setup.find((x) => x.code === 'reports-not-ignored');
  assert.match(w?.reason ?? '', /^\.pxsig\/reports\/ is not git-ignored/, r.stdout + r.stderr);
  noAbsolute(String(w?.reason), f.repo);
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  const m = notKept(P);
  assert.equal(
    m,
    'Reason not kept: .pxsig/reports/ is not git-ignored. pxsig doctor shows the fix.'
  );
  noAbsolute(m, f.repo);
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

test('check names a missing engine binary from the current folder', () => {
  const f = fixture({ withSigs: false });
  const r = spawnSync(process.execPath, [join(src, 'check.mjs'), '--only', f.ids.ok], {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...f.env, PXSIG_BIN: join(f.repo, 'tools', 'pxsig'), PXSIG_WORKSPACE: '' },
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /the pxsig binary is missing \(\.\/tools\/pxsig\): /);
  noAbsolute(r.stderr, f.repo);
});

test(
  "the server's answer for a dashboard that is not built names it relative to the workspace",
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture({ withSigs: false });
    const server = await startServer({
      cwd: f.repo,
      env: {
        ...f.env,
        PXSIG_BIN: rustBin,
        PXSIG_WORKSPACE: '',
        PXSIG_DASHBOARD_DIR: join(f.repo, 'no-dashboard'),
      },
    });
    try {
      const r = await fetch(`${server.url}/report/`);
      assert.equal(r.status, 404);
      // The server answers JSON (docs/server.md).
      const { error } = /** @type {{ error: string }} */ (await r.json());
      assert.equal(error, 'the dashboard is not built (no-dashboard)');
    } finally {
      await server.stop();
    }
  }
);
