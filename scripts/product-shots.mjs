#!/usr/bin/env node
/// <reference lib="dom" />
// (The DOM lib: `page.evaluate`'s callback runs in the page.)
/**
 * product-shots.mjs — re-shoots the product screenshots in docs/product-shots/ from an example.
 *
 *   node scripts/product-shots.mjs [--out docs/product-shots] [--keep]
 *
 * 1. Copies examples/single-package to .local/product-shots/ (git-ignored), with its `link:`
 *    dependencies pointed at this checkout, installs it and builds its Storybook.
 * 2. Records baselines there (what approving every first render does), then makes one small,
 *    deliberate change (the Button's padding) and runs the check again: the Button's entries change.
 * 3. Starts `pxsig serve` on a free port and captures, at 2x, 1600×1000 CSS px, in both themes:
 *      inspector-<theme>.png   the inspector on the changed Button entry, in the diff view
 *      overview-<theme>.png    the Overview after that check
 * 4. Compresses each PNG losslessly with oxipng or zopflipng when one is on the PATH.
 *
 * Nothing it writes outside --out is tracked: the copy, its store and its baselines stay in
 * .local/ (check-clean forbids them anywhere else). Needs the Rust binary
 * (`cargo build --release`), the built dashboard (`pnpm build:dashboard`, see
 * packages/dashboard/README.md), Playwright's Chromium and network access for the install.
 * --keep leaves the server running and prints its URL; --url <that URL> shoots again from it,
 * skipping steps 1–3. --raw skips the compression (it takes minutes with zopflipng).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repo, 'packages', 'pxsig', 'bin', 'pxsig.mjs');
const bin =
  process.env.PXSIG_BIN ??
  join(repo, 'target', 'release', process.platform === 'win32' ? 'pxsig.exe' : 'pxsig');
/** @type {(k: string, d: string | null) => string | null} */
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
// With a string default, `arg` returns a string (or the flag's next argument, undefined at the end).
const out = resolve(/** @type {string} */ (arg('--out', join(repo, 'docs', 'product-shots'))));
const keep = process.argv.includes('--keep');
if (!existsSync(bin)) throw new Error('build the Rust binary first: cargo build --release');
if (!existsSync(join(repo, 'packages', 'pxsig', 'dist', 'dashboard', 'index.html')))
  throw new Error('build the dashboard first: pnpm build:dashboard');
// pxsig's own Playwright (its dependency), required from its package.
const { chromium } = /** @type {import('./types-release.js').ShotsPlaywright} */ (
  createRequire(join(repo, 'packages', 'pxsig', 'package.json'))('playwright')
);

/** The change the shots show, and the entry the inspector opens on. */
const CHANGE = {
  file: 'src/Button/Button.jsx',
  from: "padding: '10px 16px'",
  to: "padding: '12px 22px'",
};
const ENTRY = 'components-button--primary';
/** The inspector's stored view: the diff view, with the boxes round each changed region. */
const INSPECTOR = { mode: 'side', boxes: true, highlight: true, tiles: false };
const SIZE = { width: 1600, height: 1000 };

const log = (/** @type {string} */ m) => console.log(`[shots] ${m}`);
const env = {
  ...process.env,
  PXSIG_BIN: bin,
  PXSIG_FORMAT: 'plain',
  PXSIG_NO_DELEGATE: '1',
  CI: '1',
};
/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ allow?: (number | null)[], stdio?: import('node:child_process').StdioOptions }} [opts]
 */
const sh = (cmd, args, cwd, { allow = [0], ...opts } = {}) => {
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (!allow.includes(r.status))
    throw new Error(`${cmd} ${args.join(' ')} → ${r.status}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return r;
};
/** @type {(args: string[], cwd: string, allow?: number[]) => import('node:child_process').SpawnSyncReturns<string>} */
const pxsig = (args, cwd, allow) => sh(process.execPath, [cli, ...args], cwd, { allow });
/** @type {() => Promise<number>} */
const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      // Listening on a TCP port: the address is an AddressInfo.
      const { port } = /** @type {import('node:net').AddressInfo} */ (s.address());
      s.close(() => ok(port));
    });
  });

// Cast, not annotated: `prepare` assigns it, so it must not narrow to null here.
let server = /** @type {import('node:child_process').ChildProcess | null} */ (null);
let url = arg('--url', null);
if (!url) url = await prepare();
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
/** @type {string[]} */
const shots = [];
try {
  for (const theme of ['dark', 'light']) {
    // Entry ids: the light mode is the bare story id, the others carry `@<mode>`.
    const entry = theme === 'light' ? ENTRY : `${ENTRY}@${theme}`;
    for (const [name, hash] of [
      ['overview', '#overview'],
      ['inspector', `#inspect=${encodeURIComponent(entry)}`],
    ]) {
      // A fresh page each time: the dashboard reads a deep link only as it opens.
      const ctx = await browser.newContext({
        viewport: SIZE,
        deviceScaleFactor: 2,
        colorScheme: /** @type {'dark' | 'light'} */ (theme),
        reducedMotion: 'reduce',
      });
      await ctx.addInitScript(
        (/** @type {string} */ prefs) => localStorage.setItem('pxsig-inspector', prefs),
        JSON.stringify(INSPECTOR)
      );
      const page = await ctx.newPage();
      await page.goto(`${url}?theme=${theme}${hash}`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1000);
      await page.mouse.move(0, SIZE.height - 1); // no hover state in the frame
      const file = join(out, `${name}-${theme}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  if (server && keep) log(`server left running at ${url} (pid ${String(server.pid)})`);
  else server?.kill();
}

/** Steps 1–3: the example copy, its baselines, the change, and a server on it. Returns its URL. */
async function prepare() {
  // 1. A fresh copy of the example, linked to this checkout.
  const dir = join(repo, '.local', 'product-shots', 'single-package');
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(repo, 'examples', 'single-package'), dir, {
    recursive: true,
    filter: (p) => !/node_modules|storybook-static|\.pxsig/.test(p),
  });
  const pjPath = join(dir, 'package.json');
  // The example's package.json.
  const pj = /** @type {Record<string, Record<string, string> | undefined>} */ (
    JSON.parse(readFileSync(pjPath, 'utf8'))
  );
  for (const k of ['dependencies', 'devDependencies'])
    for (const [dep, v] of Object.entries(pj[k] ?? {}))
      if (String(v).startsWith('link:'))
        /** @type {Record<string, string>} */ (pj[k])[dep] =
          `link:${join(repo, 'packages', dep.replace('@pxsig/', ''))}`;
  writeFileSync(pjPath, JSON.stringify(pj, null, 2));
  log(`installing the example in ${dir}`);
  sh(
    'pnpm',
    ['install', '--ignore-workspace', '--no-frozen-lockfile', '--config.confirmModulesPurge=false'],
    dir,
    { stdio: 'inherit' }
  );
  const build = () => sh('pnpm', ['build-storybook'], dir, { stdio: 'inherit' });
  build();

  // The check serves the static build itself when nothing answers at storybook.url.
  const static_ = [
    '--storybook-url',
    'http://127.0.0.1:1',
    '--storybook-static',
    join(dir, 'storybook-static'),
  ];
  pxsig(['manifest', ...static_], dir);
  pxsig(['check', '--full', '--retries', '0', ...static_], dir, [1]);

  // 2. Baselines from the first renders (what approving every NEW entry does), then the change.
  const code = `
    const { openProject, writeRunManifest } = await import(${JSON.stringify(join(repo, 'packages/pxsig/src/lib/workspace.mjs'))});
    const P = openProject({});
    const run = writeRunManifest(P).path;
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(P.rustBin, ['baseline', '--manifest', run, '--png-dir', P.store.latest, '--root', P.workspaceRoot, '--json'], { encoding: 'utf8' });
    process.exit(r.status);`;
  sh(process.execPath, ['--input-type=module', '-e', code], dir);
  pxsig(['check', '--full', '--retries', '1', ...static_], dir);
  log(`changing ${CHANGE.file}`);
  const f = join(dir, CHANGE.file);
  writeFileSync(f, readFileSync(f, 'utf8').replace(CHANGE.from, CHANGE.to));
  build();
  pxsig(['check', '--full', '--retries', '1', ...static_], dir, [1]);
  // check.json, as the check above wrote it.
  const rows = /** @type {{ rows: import('../packages/pxsig/src/types.js').CheckRow[] }} */ (
    JSON.parse(readFileSync(join(dir, '.pxsig', 'reports', 'check.json'), 'utf8'))
  ).rows;
  log(
    `changed: ${rows
      .filter((r) => !r.pass)
      .map((r) => r.id)
      .join(', ')}`
  );

  // 3. The dashboard, and the shots.
  const port = await freePort();
  server = spawn(process.execPath, [cli, 'serve', '--port', String(port), '--no-open'], {
    cwd: dir,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // stdout is 'pipe' (stdio above).
  /** @type {import('node:stream').Readable} */ (server.stdout).on('data', () => {});
  const url = `http://127.0.0.1:${port}/report/`;
  for (let i = 0; ; i++) {
    if (i > 120) throw new Error(`the server did not answer at ${url}`);
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return url;
}

// 4. Lossless compression, with whatever is on the PATH.
const has = (/** @type {string} */ t) =>
  spawnSync(t, ['--help'], { stdio: 'ignore' }).error === undefined;
const raw = process.argv.includes('--raw');
for (const file of shots) {
  if (raw) {
    // (no compression)
  } else if (has('oxipng'))
    spawnSync('oxipng', ['-o', '4', '--strip', 'safe', file], { stdio: 'ignore' });
  else if (has('zopflipng')) spawnSync('zopflipng', ['-y', file, file], { stdio: 'ignore' });
  log(`${file.slice(repo.length)} · ${(statSync(file).size / 1024).toFixed(0)} KB`);
}
if (!readdirSync(out).length) process.exit(1);
