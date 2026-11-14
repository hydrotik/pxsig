#!/usr/bin/env node
/**
 * gate-noise.mjs — the gate's false positives on renders of the same content: run to run on one
 * machine, and machine to machine on one OS. The noise workflow (.github/workflows/gate-noise.yml)
 * renders on each runner and compares in one job; run it before a release that changes the gate's
 * defaults (docs/releasing.md).
 *
 *   node tools/gate-noise.mjs render --label <name> --out <dir> [--runs 2] [--suites example,dashboard]
 *   node tools/gate-noise.mjs compare --from <dir> [--json <file>] [--summary <file>]
 *
 * render: each suite rendered `--runs` times on this machine, into <out>/<suite>/run<n>/<id>.png,
 * with <out>/meta.json (the label, OS, architecture, Chromium and GPU class; no host or user name)
 * and <out>/<suite>/settings.json (grid, cell policy, gate). Suites:
 *   example    examples/single-package, staged and built as scripts/examples-test.mjs does, rendered
 *              by `pxsig check --full` on an empty store (every entry NEW: renders, no baseline);
 *   dashboard  the dashboard's fixture screens on the built-in plain adapter (no design-system
 *              source needed), `pxsig dashboard check`, both themes.
 * compare: every machine folder under --from (each has a meta.json), scored by the engine
 * (lib/noise-compare.mjs). Writes the numbers as JSON and the tables as Markdown (append; GitHub's
 * job summary when --summary is $GITHUB_STEP_SUMMARY). Never writes a baseline into a store.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareAll, markdown, pngs } from './lib/noise-compare.mjs';
import { DEFAULTS } from '../packages/pxsig/src/lib/workspace/layers.mjs';
/** @import { Machine, Settings } from './lib/noise-compare.mjs' */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'pxsig.exe' : 'pxsig';
const bin = process.env.PXSIG_BIN || join(repo, 'target', 'release', exe);
const log = (/** @type {string} */ m) => console.log(`[gate-noise] ${m}`);

/** @type {Record<string, string>} */
const flags = {};
const [cmd, ...rest] = process.argv.slice(2);
for (let i = 0; i < rest.length; i++)
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] ?? '';

/** Copy the renders in `from` into `to`; returns how many. */
function copyPngs(/** @type {string} */ from, /** @type {string} */ to) {
  mkdirSync(to, { recursive: true });
  const names = pngs(from);
  for (const f of names) copyFileSync(join(from, f), join(to, f));
  return names.length;
}

/**
 * @typedef {{ stage: (name: string) => string, install: (dir: string) => void,
 *   pnpm: (args: string[], cwd: string, opts?: object) => unknown,
 *   serveStatic: (root: string) => Promise<{ port: number, close: () => boolean }>,
 *   pxsig: (args: string[], cwd: string) => { status: number | null, stdout: string, stderr: string },
 *   env: NodeJS.ProcessEnv }} Examples
 */

/**
 * examples/single-package, rendered `runs` times by `pxsig check --full` on an empty store.
 * @param {string} out
 * @param {number} runs
 * @returns {Promise<{ chromium: string | null, gpu: string | null }>}
 */
async function renderExample(out, runs) {
  // The examples' own harness (scripts/examples/shared.mjs): staging, install, a static server.
  const ex = /** @type {Examples} */ (await import('../scripts/examples/shared.mjs'));
  const dir = ex.stage('single-package');
  ex.install(dir);
  ex.pnpm(['build-storybook'], dir, { stdio: 'inherit' });
  const server = await ex.serveStatic(join(dir, 'storybook-static'));
  ex.env.PXSIG_STORYBOOK_URL = `http://127.0.0.1:${server.port}`;
  const store = join(dir, '.pxsig');
  const project = ['--project', 'example-single'];
  try {
    const m = ex.pxsig(['manifest', ...project], dir);
    if (m.status !== 0) throw new Error(`manifest → ${m.status}\n${m.stdout}\n${m.stderr}`);
    for (let i = 1; i <= runs; i++) {
      rmSync(join(store, 'renders'), { recursive: true, force: true });
      // Every entry is NEW (no baseline): exit 1, with every render on disk.
      const r = ex.pxsig(['check', '--full', ...project, '--no-a11y'], dir);
      if (r.status !== 0 && r.status !== 1)
        throw new Error(`check → ${r.status}\n${r.stdout}\n${r.stderr}`);
      const n = copyPngs(join(store, 'renders', 'latest'), join(out, `run${i}`));
      log(`example: run ${i}, ${n} renders`);
    }
    // What the check wrote (pxsig's own files): its settings and the render environment.
    const run = /** @type {Settings} */ (
      JSON.parse(readFileSync(join(store, 'reports', '.run', 'manifest.json'), 'utf8'))
    );
    const check =
      /** @type {{ envs?: Record<string, { browser?: { version?: string }, render?: { gpu?: string } }> }} */ (
        JSON.parse(readFileSync(join(store, 'reports', 'check.json'), 'utf8'))
      );
    /** @type {Settings} */
    const settings = {
      grid: run.grid,
      minCellPx: run.minCellPx ?? null,
      detail: run.detail !== false,
      gate: run.gate,
    };
    writeFileSync(join(out, 'settings.json'), JSON.stringify(settings, null, 2));
    const env = Object.values(check.envs ?? {})[0];
    return { chromium: env?.browser?.version ?? null, gpu: env?.render?.gpu ?? null };
  } finally {
    server.close();
  }
}

/**
 * The dashboard's fixture screens, on the built-in plain adapter, rendered `runs` times.
 * @param {string} out
 * @param {number} runs
 */
function renderDashboard(out, runs) {
  const tmp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'pxsig-noise-dash-'));
  const build = join(tmp, 'build');
  // pnpm is a .cmd shim on Windows, which Node starts only through a shell (a CI runner's harness).
  const win = process.platform === 'win32';
  const b = spawnSync(win ? 'pnpm.cmd' : 'pnpm', ['--filter', '@pxsig/dashboard', 'build'], {
    cwd: repo,
    stdio: 'inherit',
    shell: win,
    // No adapter and no design-system source: the plain adapter.
    env: { ...process.env, PXSIG_DASHBOARD_OUT: build, PXSIG_UI_ADAPTER: '', PXSIG_DS_SOURCE: '' },
  });
  if (b.status !== 0) throw new Error(`dashboard build → ${b.status}`);
  const cli = join(repo, 'packages', 'pxsig', 'bin', 'pxsig.mjs');
  for (let i = 1; i <= runs; i++) {
    const shots = join(tmp, `run${i}`);
    const args = ['dashboard', 'check', '--build', build, '--reference', build, '--out', shots];
    const r = spawnSync(process.execPath, [cli, ...args], {
      cwd: tmp,
      stdio: 'inherit',
      env: { ...process.env, PXSIG_BIN: bin },
    });
    // 1: a screen with a finding, its shot still taken. 2: a setup problem.
    if (r.status !== 0 && r.status !== 1) throw new Error(`dashboard check → ${r.status}`);
    const n = copyPngs(join(shots, 'shots', 'adapter'), join(out, `run${i}`));
    log(`dashboard: run ${i}, ${n} screens`);
  }
  /** @type {Settings} */
  const settings = { grid: 64, minCellPx: 8, detail: true, gate: DEFAULTS.gate };
  writeFileSync(join(out, 'settings.json'), JSON.stringify(settings, null, 2));
  rmSync(tmp, { recursive: true, force: true });
}

async function render() {
  const label = flags.label ?? '';
  if (!/^[a-z0-9-]{1,40}$/.test(label) || !flags.out) {
    console.error('usage: gate-noise.mjs render --label <a-z0-9-> --out <dir> [--runs 2]');
    process.exit(2);
  }
  const out = resolve(flags.out);
  const runs = Number(flags.runs ?? 2);
  const suites = (flags.suites ?? 'example,dashboard').split(',');
  mkdirSync(out, { recursive: true });
  /** @type {Omit<Machine, 'dir'>} */
  const meta = {
    label,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    chromium: null,
    gpu: null,
  };
  if (suites.includes('example'))
    Object.assign(meta, await renderExample(join(out, 'example'), runs));
  if (suites.includes('dashboard')) renderDashboard(join(out, 'dashboard'), runs);
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  log(
    `${suites.join(', ')} rendered ${runs}× as ${label} (${meta.platform}-${meta.arch}, GPU ${meta.gpu ?? 'unknown'})`
  );
}

function compare() {
  const report = compareAll(bin, resolve(flags.from ?? 'gate-noise'));
  const md = markdown(report);
  if (flags.json) writeFileSync(flags.json, `${JSON.stringify(report, null, 2)}\n`);
  if (flags.summary) writeFileSync(flags.summary, md, { flag: 'a' });
  console.log(md);
}

if (cmd === 'render') await render();
else if (cmd === 'compare') compare();
else {
  console.error(
    'usage: node tools/gate-noise.mjs render --label <name> --out <dir> | compare --from <dir>'
  );
  process.exit(2);
}
