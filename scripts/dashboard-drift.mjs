#!/usr/bin/env node
/**
 * dashboard-drift.mjs — which dashboard screens look different from an earlier dashboard: both
 * builds rendered on this machine by this checkout's `pxsig dashboard check`, the second with
 * `--compare` against the first. Nothing is stored and nothing needs approving; the result is a
 * list, never a failure.
 *
 *   node scripts/dashboard-drift.mjs --base-ref <git ref> [--adapter <path>] [--out <dir>]
 *       builds the dashboard of <git ref> (a temporary worktree, its own install) and of this
 *       checkout, each with the adapter at <path> in its own tree (default
 *       examples/custom-ui/pxsig-ui), then compares them (CI: a pull request against main)
 *   node scripts/dashboard-drift.mjs --base-build <dir> --head-build <dir> [--out <dir>]
 *       compares two builds already made (the release: the last release's dashboard asset
 *       against this one's)
 *
 * Writes <out>/base and <out>/head (each a `dashboard check --out`; the gallery is
 * <out>/head/index.html), prints the head's summary and appends it to $GITHUB_STEP_SUMMARY when
 * set. Exit 0 when the comparison ran, whatever changed · 1 a build or a check failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const ADAPTER = 'examples/custom-ui/pxsig-ui';

/**
 * @typedef {{ mode: 'ref', ref: string, adapter: string, out: string }
 *   | { mode: 'builds', base: string, head: string, out: string }} DriftPlan
 */

/**
 * The plan for these arguments, or the usage problem.
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {DriftPlan | { error: string }}
 */
export function planFor(args, cwd = process.cwd()) {
  /** @param {string} name */
  const flag = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? null : (args[i + 1] ?? '');
  };
  const out = resolve(
    cwd,
    flag('--out') || join('node_modules', '.cache', 'pxsig', 'dashboard-drift')
  );
  const ref = flag('--base-ref');
  const base = flag('--base-build');
  const head = flag('--head-build');
  if (ref === '' || base === '' || head === '' || flag('--adapter') === '' || flag('--out') === '')
    return { error: 'a flag is missing its value' };
  if (ref && (base || head))
    return { error: '--base-ref and --base-build/--head-build are two ways: pick one' };
  if (ref) return { mode: 'ref', ref, adapter: flag('--adapter') ?? ADAPTER, out };
  if (base && head)
    return { mode: 'builds', base: resolve(cwd, base), head: resolve(cwd, head), out };
  return { error: 'give --base-ref <ref>, or --base-build <dir> and --head-build <dir>' };
}

/**
 * The head check's summary.md cut to what drift is about: the counts, failed screens and the
 * comparison (axe and layout findings are the check's own report, not drift).
 * @param {string} summary
 * @param {string} gallery
 */
export function driftSummary(summary, gallery) {
  const [head, ...sections] = summary.split(/\n(?=### )/);
  const kept = sections.filter((x) => /^### (Failed|Compared)/.test(x));
  return `${[head.replace(/^## pxsig dashboard check/, '## Dashboard drift'), ...kept].join('\n').trimEnd()}\n\nGallery: \`${gallery}\`\n`;
}

/**
 * Run a program; throw with its output when it fails.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [o]
 */
function step(cmd, args, { cwd = repo, env = process.env } = {}) {
  console.log(`[drift] ${cmd} ${args.join(' ')}${cwd === repo ? '' : `  (in ${cwd})`}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: false });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args[0]} failed (exit ${r.status ?? r.error?.message})`);
}

/**
 * Build the dashboard of the checkout at `root` with the adapter at `adapter` (in that tree) into
 * `outDir`.
 * @param {string} root
 * @param {string} adapter
 * @param {string} outDir
 */
function build(root, adapter, outDir) {
  step('pnpm', ['--filter', '@pxsig/dashboard', 'build'], {
    cwd: root,
    env: { ...process.env, PXSIG_UI_ADAPTER: join(root, adapter), PXSIG_DASHBOARD_OUT: outDir },
  });
}

/** @param {string} buildDir @param {string} out @param {string[]} [more] */
function check(buildDir, out, more = []) {
  // The build is its own reference: the gallery has no second column, and the run takes half as long.
  step(process.execPath, [
    join(repo, 'packages', 'pxsig', 'bin', 'pxsig.mjs'),
    'dashboard',
    'check',
    '--build',
    buildDir,
    '--reference',
    buildDir,
    '--out',
    out,
    ...more,
  ]);
}

/** @param {DriftPlan} plan */
function run(plan) {
  const tmp = mkdtempSync(join(tmpdir(), 'pxsig-drift-'));
  let worktree = null;
  try {
    let base = plan.mode === 'builds' ? plan.base : join(tmp, 'base-build');
    let head = plan.mode === 'builds' ? plan.head : join(tmp, 'head-build');
    if (plan.mode === 'ref') {
      worktree = join(tmp, 'base');
      step('git', ['worktree', 'add', '--detach', worktree, plan.ref]);
      step('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree });
      build(worktree, plan.adapter, base);
      build(repo, plan.adapter, head);
    }
    for (const [name, dir] of [
      ['base', base],
      ['head', head],
    ])
      if (!existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'assets')))
        throw new Error(`the ${name} build at ${dir} is not a built dashboard`);
    check(base, join(plan.out, 'base'));
    check(head, join(plan.out, 'head'), ['--compare', join(plan.out, 'base')]);
    const text = driftSummary(
      readFileSync(join(plan.out, 'head', 'summary.md'), 'utf8'),
      join(plan.out, 'head', 'index.html')
    );
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  } finally {
    if (worktree) spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = planFor(process.argv.slice(2));
  if ('error' in plan) {
    console.error(`[drift] ${plan.error}`);
    console.error(
      'usage: dashboard-drift.mjs --base-ref <ref> [--adapter <path>] [--out <dir>]\n       dashboard-drift.mjs --base-build <dir> --head-build <dir> [--out <dir>]'
    );
    process.exit(2);
  }
  try {
    run(plan);
  } catch (e) {
    console.error(`[drift] ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }
}
