// Which dashboard `pxsig serve` serves (lib/dashboard-dir.mjs): every branch, on folders built here.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDirFor, chooseDashboard, STAMP } from '../src/lib/dashboard-dir.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

/** @typedef {{ name: string, dir: string, configPath: string }} DirProject */

/** @type {string} */
let root;
const prebuilt = '/prebuilt/dashboard';
const VERSION = '9.9.9';
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'pxsig-dash-'))));
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

test('a build without a stamp is judged by its index.html', () => {
  const p = project('a', './pxsig-ui');
  touch(join(p.dir, 'pxsig-ui', 'index.tsx'), Date.now() - 60_000);
  touch(join(p.dir, 'pxsig-ui'), Date.now() - 60_000);
  const out = built(p, { stamp: false });
  assert.equal(choose([p]).dir, out);
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

const serveJs = fileURLToPath(new URL('../src/serve.mjs', import.meta.url));
const PXSIG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * @param {string} repo
 * @param {(io: { log: string, get: (p: string) => Promise<Response> }) => Promise<void>} run
 */
async function serving(repo, run) {
  const port = await new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      // Listening on TCP: the address is an AddressInfo.
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => ok(p));
    });
  });
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' };
  delete env.PXSIG_DASHBOARD_DIR;
  const proc = spawn(process.execPath, [serveJs, '--port', String(port), '--no-open'], {
    cwd: repo,
    env,
  });
  let log = '';
  try {
    await /** @type {Promise<void>} */ (
      new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
        proc.stdout.on(
          'data',
          (d) => ((log += d), /dashboard →/.test(log) && (clearTimeout(t), ok()))
        );
        proc.stderr.on('data', (d) => (log += d));
      })
    );
    await run({ log, get: (p) => fetch(`http://127.0.0.1:${port}${p}`) });
  } finally {
    proc.kill();
  }
}

test(
  'serve: dashboard.ui without a build prints the command and serves the prebuilt dashboard',
  { skip: !hasRust && 'Rust binary not built' },
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
  { skip: !hasRust && 'Rust binary not built' },
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
