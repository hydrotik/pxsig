#!/usr/bin/env node
/**
 * run.mjs — the scale benchmark (TEST-PLAN 3.5, decision 100): pxsig's read paths on a store of
 * hydrotik's size, against fixed budgets and the last release's times.
 *
 *   node scripts/bench/run.mjs [--runs 5] [--out results.json] [--keep] [--dir <existing store>]
 *
 * Generates a synthetic project (generate-store.mjs) in a temporary folder, then times, as a
 * person would run them (a fresh `node` process each, start-up included):
 *   affected  `pxsig affected --since HEAD~1`
 *   list      `pxsig list`
 *   doctor    `pxsig doctor --offline`
 *   plan      `pxsig approve plan --all-changed --reason …`
 *   data      the dashboard's data: `buildData()` and its JSON, what GET /__pxsig/data answers
 * One warm-up run, then the median of --runs. Prints a table, appends it to $GITHUB_STEP_SUMMARY
 * when set, writes the results (in baseline.json's shape) to --out.
 *
 * Fails (exit 1) when a median is over its budget (BUDGETS below, decision 100), or more than 50%
 * over the time baseline.json records for this OS at the last release. baseline.json is refreshed
 * at each release from the nightly run's `bench-results` artifact (docs/releasing.md).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateStore } from './generate-store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cli = join(root, 'packages', 'pxsig', 'bin', 'pxsig.mjs');
const report = join(root, 'packages', 'pxsig', 'src', 'report.mjs');
const workspace = join(root, 'packages', 'pxsig', 'src', 'lib', 'workspace.mjs');

/** Milliseconds. `plan` has no fixed budget: only the 50% rule against the last release. */
export const BUDGETS = { affected: 2000, list: 3000, doctor: 3000, plan: null, data: 2000 };
/** Under this, a 50% rise is noise on a shared runner, not a regression (sub-second steps). */
export const SLACK_MS = 100;

const STEPS = {
  affected: ['affected', '--since', 'HEAD~1', '--json'],
  list: ['list', '--json'],
  doctor: ['doctor', '--offline', '--json'],
  plan: ['approve', 'plan', '--all-changed', '--reason', 'The benchmark plans every changed entry at once.', '--json'],
  data: null,
};
// Exit codes that are a result, not a failure: doctor 1 = findings (the synthetic edit makes some).
const OK = { affected: [0], list: [0], doctor: [0, 1], plan: [0, 1], data: [0] };

const dataScript = `
const { openProject } = await import(${JSON.stringify(pathToFileURL(workspace).href)});
const { buildData } = await import(${JSON.stringify(pathToFileURL(report).href)});
const body = JSON.stringify(buildData(openProject({ cwd: process.cwd() })));
process.stdout.write(String(body.length));
`;

function once(step, dir, env) {
  const args = STEPS[step] ? [cli, ...STEPS[step]] : ['--input-type=module', '-e', dataScript];
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!OK[step].includes(r.status)) throw new Error(`${step}: exit ${r.status}\n${(r.stderr || r.stdout || r.error?.message || '').slice(0, 2000)}`);
  return ms;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Each step's verdict against its budget and the baseline for this OS. */
export function judge(times, base) {
  return Object.entries(times).map(([step, ms]) => {
    const budget = BUDGETS[step];
    const was = base?.[step] ?? null;
    const limit = was == null ? null : Math.max(was * 1.5, was + SLACK_MS);
    const why = [];
    if (budget != null && ms > budget) why.push(`over the ${budget} ms budget`);
    if (limit != null && ms > limit) why.push(`more than 50% over the last release (${Math.round(was)} ms)`);
    return { step, ms, budget, was, limit, fail: why.length > 0, why };
  });
}

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(flag(args, '--runs') ?? 5);
  const given = flag(args, '--dir');
  const dir = given ? resolve(given) : mkdtempSync(join(tmpdir(), 'pxsig-bench-'));
  const env = { ...process.env };
  const version = JSON.parse(readFileSync(join(root, 'packages', 'pxsig', 'package.json'), 'utf8')).version;
  try {
    let store = null;
    if (!given) {
      const t0 = Date.now();
      store = generateStore(dir);
      console.log(`[bench] store: ${store.entries} entries + ${store.matrix} matrix, ${store.renders} renders, ${store.storyFiles} story files (${Date.now() - t0} ms)`);
    }
    const times = {};
    for (const step of Object.keys(STEPS)) {
      once(step, dir, env);
      const xs = Array.from({ length: runs }, () => once(step, dir, env));
      times[step] = Math.round(median(xs));
    }
    const os = platform();
    const baselinePath = join(here, 'baseline.json');
    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
    const base = baseline?.times?.[os] ?? null;
    const verdicts = judge(times, base);
    const rows = verdicts.map((v) => `| ${v.step} | ${v.ms} | ${v.budget ?? '—'} | ${v.was ?? '—'} | ${v.fail ? `**fail**: ${v.why.join('; ')}` : 'ok'} |`);
    const table = [
      `### pxsig scale benchmark (${os}, node ${process.version}, pxsig ${version})`,
      '',
      `Median of ${runs} runs, in ms. Baseline: ${base ? `pxsig ${baseline.pxsig}` : `none for ${os} yet (budgets only)`}.`,
      '',
      '| Step | Median | Budget | Last release | Result |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n');
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
    const out = flag(args, '--out');
    // The whole baseline with this OS's times replaced: a release commits the file as it is.
    if (out) writeFileSync(out, JSON.stringify({ ...baseline, pxsig: version, measuredAt: new Date().toISOString(), node: process.version, runs, times: { ...baseline?.times, [os]: times } }, null, 2) + '\n');
    if (verdicts.some((v) => v.fail)) process.exitCode = 1;
  } finally {
    if (!given && !args.includes('--keep')) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    else if (!given) console.log(`[bench] kept ${dir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
