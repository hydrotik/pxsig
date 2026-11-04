/**
 * shared.mjs — examples-test.mjs's paths, environment, process helpers and the expect/failure count.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTree } from '../lib/copy-tree.mjs';

/** @import { SpawnSyncReturns, StdioOptions } from 'node:child_process' */
/** @typedef {{ must?: boolean, allow?: (number | null)[], stdio?: StdioOptions, env?: NodeJS.ProcessEnv, shell?: boolean }} ShOpts */

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const cli = join(repo, 'packages', 'pxsig', 'bin', 'pxsig.mjs');
export const bin =
  process.env.PXSIG_BIN ??
  join(repo, 'target', 'release', process.platform === 'win32' ? 'pxsig.exe' : 'pxsig');
// Staging alone (scripts/live/stage.mjs, on a host without the engine) needs no binary.
if (!existsSync(bin) && !process.env.PXSIG_STAGE_ONLY)
  throw new Error(`build the Rust binary first: cargo build --release (looked for ${bin})`);

export const log = (/** @type {string} */ m) => console.log(`[examples] ${m}`);
let failures = 0;
/** How many `expect` calls have failed so far. */
export const failureCount = () => failures;
/** @type {(ok: unknown, what: string) => void} */
export const expect = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
/** @type {NodeJS.ProcessEnv} */
export const env = {
  ...process.env,
  PXSIG_BIN: bin,
  PXSIG_FORMAT: 'plain',
  PXSIG_NO_DELEGATE: '1',
  CI: '1',
};
/** @type {(cmd: string, args: string[], cwd: string, opts?: ShOpts) => SpawnSyncReturns<string>} */
export const sh = (cmd, args, cwd, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (opts.must !== false && r.status !== 0 && !opts.allow?.includes(r.status))
    throw new Error(`${cmd} ${args.join(' ')} → ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
};
/** @type {(args: string[], cwd: string) => SpawnSyncReturns<string>} */
export const pxsig = (args, cwd) => sh(process.execPath, [cli, ...args], cwd, { must: false });
// Warn-mode runs write a readiness line in the machine's state folder: point it at a temp folder.
// Playwright finds its browsers under the same folders, so its own path stays where they are.
export const stateHome = mkdtempSync(join(tmpdir(), 'pxsig-example-state-'));
export const browsers =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'));
/** @type {(args: string[], cwd: string, extra?: NodeJS.ProcessEnv) => SpawnSyncReturns<string>} */
export const pxsigIn = (args, cwd, extra = {}) =>
  sh(process.execPath, [cli, ...args], cwd, {
    must: false,
    env: {
      ...env,
      HOME: stateHome,
      USERPROFILE: stateHome,
      XDG_STATE_HOME: stateHome,
      LOCALAPPDATA: stateHome,
      PLAYWRIGHT_BROWSERS_PATH: browsers,
      ...extra,
    },
  });
export const tail = (/** @type {SpawnSyncReturns<string>} */ r) =>
  `\n${r.stdout.split('\n').slice(-15).join('\n')}\n${r.stderr.split('\n').slice(-15).join('\n')}`;
// pnpm is a .cmd shim on Windows, which Node starts only through a shell. This is the test
// harness on a CI runner; pxsig itself never starts a shell (docs/platforms.md).
/** @type {(args: string[], cwd: string, opts?: ShOpts) => SpawnSyncReturns<string>} */
export const pnpm = (args, cwd, opts = {}) =>
  process.platform === 'win32'
    ? sh('pnpm.cmd', args, cwd, { ...opts, shell: true })
    : sh('pnpm', args, cwd, opts);

// The repository's package.json.
export const rootPackageManager = /** @type {{ packageManager?: string }} */ (
  JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
).packageManager;

/** The packages the examples link to (`link:../../packages/<name>`). */
const LINKED = ['pxsig', 'storybook-addon'];

/**
 * Copy an example to `<temp>/examples/<name>`, beside a `<temp>/packages/` whose entries are links
 * to this checkout's packages, so its `link:` dependencies resolve as written and its committed
 * pnpm-lock.yaml matches its package.json. `base`: a fixed folder instead of a new temp one,
 * emptied first (the live screens' staging, scripts/live/stage.mjs).
 * @param {string} name
 * @param {{ base?: string }} [opts]
 */
export function stage(name, { base: fixed } = {}) {
  // On the checkout's drive: Storybook names a cache folder after the path from the example to a
  // linked package, which across Windows drives contains "D:" and cannot be created.
  if (fixed) rmSync(fixed, { recursive: true, force: true });
  const base = fixed
    ? (mkdirSync(fixed, { recursive: true }), fixed)
    : mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `pxsig-example-${name}-`));
  mkdirSync(join(base, 'packages'));
  // A junction on Windows needs no privilege; elsewhere the type is ignored.
  for (const p of LINKED)
    symlinkSync(join(repo, 'packages', p), join(base, 'packages', p), 'junction');
  const dir = join(base, 'examples', name);
  copyTree(join(repo, 'examples', name), dir, {
    filter: (p) => !/node_modules|storybook-static|\.pxsig|__pxsig__/.test(p),
  });
  // The staged copy is outside the checkout, so Corepack would fetch the newest pnpm (12 fails on
  // ignored build scripts): pin the repository's own.
  const pjPath = join(dir, 'package.json');
  const pj = /** @type {{ packageManager?: string }} */ (JSON.parse(readFileSync(pjPath, 'utf8')));
  if (!pj.packageManager) {
    pj.packageManager = rootPackageManager;
    writeFileSync(pjPath, JSON.stringify(pj, null, 2));
  }
  return dir;
}

/** `--fresh`: install the examples unpinned (the newest versions their ranges allow). */
export const fresh = process.argv.includes('--fresh');

/**
 * Install a staged example from its committed pnpm-lock.yaml (`--frozen-lockfile`), or unpinned
 * with `--fresh`. A workspace example installs as a workspace; another one ignores any workspace
 * above it. `browser: false`: no browser for the example's Playwright (it renders elsewhere).
 * @param {string} dir
 * @param {{ browser?: boolean }} [opts]
 */
export function install(dir, { browser = true } = {}) {
  const ws = existsSync(join(dir, 'pnpm-workspace.yaml'));
  pnpm(
    [
      'install',
      ...(ws ? [] : ['--ignore-workspace']),
      fresh ? '--no-frozen-lockfile' : '--frozen-lockfile',
      '--config.confirmModulesPurge=false',
    ],
    dir,
    { stdio: 'inherit' }
  );
  // The example's own Playwright renders its stories: its browser build, if the lockfile pins
  // another version than the one the job installed (the system libraries are already there). Not
  // in pxsig's image, where PXSIG_PLAYWRIGHT names the Playwright that renders; and never removing
  // another version's browser (Playwright's clean-up would take the image's).
  if (
    browser &&
    !process.env.PXSIG_PLAYWRIGHT &&
    (existsSync(join(dir, 'node_modules', '.bin', 'playwright')) ||
      existsSync(join(dir, 'node_modules', '.bin', 'playwright.cmd')))
  )
    pnpm(['exec', 'playwright', 'install', 'chromium'], dir, {
      stdio: 'inherit',
      env: { ...env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' },
    });
}

/**
 * Serve a storybook-static folder on a free port, in a child process (this script blocks on
 * spawnSync while pxsig renders, so an in-process server could not answer).
 * @param {string} root
 * @returns {Promise<{ port: number, close: () => boolean }>}
 */
export function serveStatic(root) {
  const code = `
    const http = require('http'), fs = require('fs'), path = require('path');
    const root = ${JSON.stringify(resolve(root))};
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    const s = http.createServer((req, res) => {
      let f = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!f.startsWith(root)) return res.writeHead(403).end();
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((ok) =>
    child.stdout.once('data', (d) =>
      ok({ port: Number(String(d).trim()), close: () => child.kill() })
    )
  );
}

/**
 * @param {string} dir
 * @param {string} project
 * @returns {string[]}
 */
export function projectStore(dir, project) {
  // The example's own pxsig.workspace.json: its `projects` map names every project run here.
  const ws = existsSync(join(dir, 'pxsig.workspace.json'))
    ? /** @type {{ projects: Record<string, string> }} */ (
        JSON.parse(readFileSync(join(dir, 'pxsig.workspace.json'), 'utf8'))
      )
    : null;
  return ws ? [ws.projects[project], '.pxsig'] : ['.pxsig'];
}
