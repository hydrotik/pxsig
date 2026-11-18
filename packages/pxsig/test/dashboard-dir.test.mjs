// Which dashboard `pxsig serve` serves (lib/dashboard-dir.mjs): every branch, on folders built here.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { buildDirFor, chooseDashboard, shellWord, STAMP } from '../src/lib/dashboard-dir.mjs';
import { fixture, hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { startServer } from './server-proc.mjs';
import { skipUnless } from './strict.mjs';

/** @typedef {{ name: string, dir: string, configPath: string }} DirProject */

/** @type {string} */
let root;
const prebuilt = '/prebuilt/dashboard';
const VERSION = '9.9.9';
beforeEach(() => (root = tempDir('dash')));
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * A project folder with a pxsig.config.json (and an adapter folder when `ui` is a path).
 * @param {string} name
 * @param {string} [ui]
 * @returns {DirProject}
 */
function project(name, ui) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pxsig.config.json'), JSON.stringify(ui ? { dashboard: { ui } } : {}));
  if (ui && ui.startsWith('./')) {
    mkdirSync(join(dir, ui), { recursive: true });
    writeFileSync(join(dir, ui, 'index.tsx'), 'export const name = "x";');
  }
  return { name, dir, configPath: join(dir, 'pxsig.config.json') };
}
/**
 * A build in the default folder, `ageMs` ago, stamped with `version`.
 * @param {DirProject} p
 * @param {{ version?: string, ageMs?: number, stamp?: boolean }} [opts]
 */
function built(p, { version = VERSION, ageMs = 0, stamp = true } = {}) {
  const out = buildDirFor(p.dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), '<!doctype html>');
  if (stamp)
    writeFileSync(
      join(out, STAMP),
      JSON.stringify({ pxsig: version, builtAt: Date.now() - ageMs })
    );
  return out;
}
/**
 * @param {string} file
 * @param {number} at
 */
const touch = (file, at) => utimesSync(file, at / 1000, at / 1000);
/**
 * @param {DirProject[]} projects
 * @param {Record<string, string | undefined>} [env]
 */
const choose = (projects, env = {}) =>
  chooseDashboard({ projects, prebuilt, version: VERSION, root, env });

test('no dashboard.ui: the prebuilt dashboard, silently', () => {
  assert.deepEqual(choose([project('a')]), { dir: prebuilt, source: 'prebuilt', note: null });
});

test('PXSIG_DASHBOARD_DIR wins over everything', () => {
  const p = project('a', './pxsig-ui');
  built(p);
  const r = choose([p], { PXSIG_DASHBOARD_DIR: join(root, 'mine') });
  assert.equal(r.source, 'env');
  assert.equal(r.dir, join(root, 'mine'));
});

test('dashboard.ui with a current build: that build', () => {
  const p = project('a', './pxsig-ui');
  touch(join(p.dir, 'pxsig-ui', 'index.tsx'), Date.now() - 60_000);
  touch(join(p.dir, 'pxsig-ui'), Date.now() - 60_000);
  const out = built(p);
  const r = choose([p]);
  assert.equal(r.source, 'adapter');
  assert.equal(r.dir, out);
  assert.match(
    // This branch always writes a note.
    /** @type {string} */ (r.note),
    /built with the UI adapter \.\/pxsig-ui/
  );
});

test('dashboard.ui without a build: the prebuilt dashboard and the command to run', () => {
  const r = choose([project('a', './pxsig-ui')]);
  assert.equal(r.dir, prebuilt);
  assert.match(
    // This branch always writes a note.
    /** @type {string} */ (r.note),
    /has no build yet: run `pxsig dashboard build` in a\. Serving the prebuilt dashboard\./
  );
});

test('an adapter edited after its build: stale, so the prebuilt dashboard and the command', () => {
  const p = project('a', './pxsig-ui');
  built(p, { ageMs: 60_000 });
  touch(join(p.dir, 'pxsig-ui', 'index.tsx'), Date.now());
  const r = choose([p]);
  assert.equal(r.dir, prebuilt);
  assert.match(
    // This branch always writes a note.
    /** @type {string} */ (r.note),
    /changed after its last build: run `pxsig dashboard build` in a/
  );
});

test('a build for another major UI contract is not served; the same major is', () => {
  const p = project('a', './pxsig-ui');
  touch(join(p.dir, 'pxsig-ui', 'index.tsx'), Date.now() - 60_000);
  touch(join(p.dir, 'pxsig-ui'), Date.now() - 60_000);
  const out = buildDirFor(p.dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), '<!doctype html>');
  writeFileSync(
    join(out, STAMP),
    JSON.stringify({ pxsig: VERSION, contract: '1.2.0', builtAt: Date.now() })
  );
  /** @param {string | null} contract */
  const at = (contract) =>
    chooseDashboard({ projects: [p], prebuilt, version: VERSION, contract, root, env: {} });
  assert.equal(at('1.4.0').dir, out);
  const r = at('2.0.0');
  assert.equal(r.dir, prebuilt);
  assert.match(
    // This branch always writes a note.
    /** @type {string} */ (r.note),
    /is for UI contract 1\.2\.0 \(this pxsig has 2\.0\.0\): update the adapter/
  );
  assert.equal(at(null).dir, out, 'no contract known: judged as before');
});

test('a build from another pxsig version is stale', () => {
  const p = project('a', './pxsig-ui');
  touch(join(p.dir, 'pxsig-ui', 'index.tsx'), Date.now() - 60_000);
  built(p, { version: '0.0.1' });
  const r = choose([p]);
  assert.equal(r.dir, prebuilt);
  assert.match(
    // This branch always writes a note.
    /** @type {string} */ (r.note),
    /from pxsig 0\.0\.1 \(this is 9\.9\.9\)/
  );
});

test('a build that records no pxsig version is stale', () => {
  const p = project('a', './pxsig-ui');
  touch(join(p.dir, 'pxsig-ui', 'index.tsx'), Date.now() - 60_000);
  touch(join(p.dir, 'pxsig-ui'), Date.now() - 60_000);
  built(p, { stamp: false });
  const r = choose([p]);
  assert.equal(r.dir, prebuilt);
  assert.equal(
    r.note,
    `dashboard: the build for dashboard.ui (./pxsig-ui) in ${join('a', 'pxsig.config.json')} records no pxsig version (this is 9.9.9): run \`pxsig dashboard build\` in a. Serving the prebuilt dashboard.`
  );
});

/**
 * A folder with a built dashboard in it, recording `pxsig` in `file` (or nothing).
 * @param {string} name
 * @param {{ file?: string, pxsig?: string }} [o]
 */
function envBuild(name, { file = STAMP, pxsig } = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, file), JSON.stringify(pxsig ? { pxsig } : { adapter: 'x' }));
  return dir;
}

test('PXSIG_DASHBOARD_DIR: a build for this version, by its stamp or its BUILD.json, is served', () => {
  for (const file of [STAMP, 'BUILD.json']) {
    const dir = envBuild(`mine-${file}`, { file, pxsig: VERSION });
    const r = choose([project('a')], { PXSIG_DASHBOARD_DIR: dir });
    assert.deepEqual([r.source, r.dir], ['env', dir], file);
  }
});

test('PXSIG_DASHBOARD_DIR: another version, or none, serves the prebuilt one and says what to run', () => {
  const old = envBuild('old', { file: 'BUILD.json', pxsig: '0.0.1' });
  const r = choose([project('a')], { PXSIG_DASHBOARD_DIR: old });
  assert.deepEqual([r.source, r.dir], ['prebuilt', prebuilt]);
  assert.equal(
    r.note,
    `dashboard: the build in ${old} (PXSIG_DASHBOARD_DIR) is from pxsig 0.0.1 (this is 9.9.9): run \`pxsig dashboard build --out ${shellWord(old)}\`. Serving the prebuilt dashboard.`
  );
  const none = envBuild('my build');
  const n = choose([project('a')], { PXSIG_DASHBOARD_DIR: none });
  assert.equal(n.dir, prebuilt);
  assert.equal(
    n.note,
    `dashboard: the build in ${none} (PXSIG_DASHBOARD_DIR) records no pxsig version (this is 9.9.9): run \`pxsig dashboard build --out ${shellWord(none)}\`. Serving the prebuilt dashboard.`
  );
});

test('projects naming different adapters: the prebuilt dashboard and why', () => {
  const r = choose([project('a', './ui-a'), project('b', './ui-b'), project('c')]);
  assert.equal(r.dir, prebuilt);
  assert.match(
    // This branch always writes a note.
    /** @type {string} */ (r.note),
    /different UI adapters \(a: \.\/ui-a, b: \.\/ui-b\)/
  );
});

test('a built-in adapter by name: staleness from its folder', () => {
  const p = project('a', 'hydrotik');
  const adapters = join(root, 'adapters', 'hydrotik');
  mkdirSync(adapters, { recursive: true });
  writeFileSync(join(adapters, 'index.tsx'), '');
  touch(join(adapters, 'index.tsx'), Date.now() - 60_000);
  touch(adapters, Date.now() - 60_000);
  const out = built(p);
  assert.equal(
    chooseDashboard({
      projects: [p],
      prebuilt,
      version: VERSION,
      root,
      env: {},
      builtinDir: () => adapters,
    }).dir,
    out
  );
});

// --- through `pxsig serve`: the line it prints and the page it serves ---------------------------

const PXSIG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * @param {string} repo
 * @param {(io: { log: string, get: (p: string) => Promise<Response> }) => Promise<void>} run
 * @param {NodeJS.ProcessEnv} [extra] more of the server's environment
 */
async function serving(repo, run, extra = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' };
  delete env.PXSIG_DASHBOARD_DIR;
  Object.assign(env, extra);
  const S = await startServer({ cwd: repo, env });
  const { port } = S;
  try {
    await run({ log: S.log(), get: (p) => fetch(`http://127.0.0.1:${port}${p}`) });
  } finally {
    await S.stop();
  }
}

test(
  'serve: dashboard.ui without a build prints the command and serves the prebuilt dashboard',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const cfg = JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8'));
    writeFileSync(
      join(f.repo, 'pxsig.config.json'),
      JSON.stringify({ ...cfg, dashboard: { ui: './pxsig-ui' } })
    );
    mkdirSync(join(f.repo, 'pxsig-ui'));
    writeFileSync(join(f.repo, 'pxsig-ui', 'index.tsx'), '');
    await serving(f.repo, async ({ log }) => {
      assert.match(
        log,
        /\[serve\] dashboard: dashboard\.ui \(\.\/pxsig-ui\) in pxsig\.config\.json has no build yet: run `pxsig dashboard build` in \.\. Serving the prebuilt dashboard\./
      );
    });
  }
);

test(
  'serve: a current build for dashboard.ui is the dashboard it serves',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const cfg = JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8'));
    writeFileSync(
      join(f.repo, 'pxsig.config.json'),
      JSON.stringify({ ...cfg, dashboard: { ui: './pxsig-ui' } })
    );
    mkdirSync(join(f.repo, 'pxsig-ui'));
    writeFileSync(join(f.repo, 'pxsig-ui', 'index.tsx'), '');
    const old = Date.now() - 60_000;
    touch(join(f.repo, 'pxsig-ui', 'index.tsx'), old);
    touch(join(f.repo, 'pxsig-ui'), old);
    const out = buildDirFor(f.repo);
    mkdirSync(join(out, 'assets'), { recursive: true });
    writeFileSync(
      join(out, 'index.html'),
      '<!doctype html><title>rebuilt</title><!--pxsig:data-->'
    );
    writeFileSync(join(out, STAMP), JSON.stringify({ pxsig: PXSIG, builtAt: Date.now() }));
    await serving(f.repo, async ({ log, get }) => {
      assert.match(log, /\[serve\] dashboard: built with the UI adapter \.\/pxsig-ui/);
      assert.match(await (await get('/report/')).text(), /<title>rebuilt<\/title>/);
    });
  }
);

test(
  'serve: a PXSIG_DASHBOARD_DIR build from another pxsig version is not served; the line says what to run',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const dash = join(f.repo, 'old-dash');
    mkdirSync(dash);
    writeFileSync(join(dash, 'index.html'), '<!doctype html><title>old build</title>');
    writeFileSync(join(dash, STAMP), JSON.stringify({ pxsig: '0.0.1', builtAt: Date.now() }));
    await serving(
      f.repo,
      async ({ log, get }) => {
        assert.ok(
          log.includes(
            `[serve] dashboard: the build in old-dash (PXSIG_DASHBOARD_DIR) is from pxsig 0.0.1 (this is ${PXSIG}): run \`pxsig dashboard build --out old-dash\`. Serving the prebuilt dashboard.`
          ),
          log
        );
        assert.doesNotMatch(await (await get('/report/')).text(), /<title>old build<\/title>/);
      },
      { PXSIG_DASHBOARD_DIR: 'old-dash' }
    );
  }
);
