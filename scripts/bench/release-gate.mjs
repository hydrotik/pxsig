#!/usr/bin/env node
/**
 * release-gate.mjs — a release tag's commit is not slower than the last release (release.yml,
 * verify; docs/benchmark.md#in-a-release).
 *
 *   node scripts/bench/release-gate.mjs        (GITHUB_REPOSITORY, GITHUB_SHA; gh and git on PATH)
 *
 * The benchmark runs nightly on main (bench.yml), not in the release. So the release reads the
 * newest completed bench run whose commit is the tagged one or an ancestor of it, and its
 * "Benchmark against the last release" step:
 *   success  → passes, naming the run and how far before the tag it ran;
 *   failure  → fails: re-run bench on main (Actions → bench → Run workflow), then this release;
 *   none     → passes with a warning: no run covers the commit (a new repository, runs expired),
 *              so a missing benchmark never blocks a release for good.
 * Only that step counts: the same job's advisory checks are ci.yml's, which the tag has passed.
 * Exit: 0 pass (with or without a warning) · 1 the step failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** bench.yml's step, by name; before it had one, GitHub named it after its command. */
export const STEP = 'Benchmark against the last release';
const OLD_STEP = 'Run node scripts/bench/run.mjs';

/**
 * @typedef {{ databaseId: number, headSha: string, conclusion: string, createdAt?: string, url?: string }} BenchRun
 * @typedef {{ name?: string, conclusion?: string | null }} JobStep
 */

/**
 * The newest run whose commit `isAncestor` accepts (the tag's own commit counts).
 * @param {BenchRun[]} runs newest first, as `gh run list` prints them
 * @param {(sha: string) => boolean} isAncestor
 */
export const pickRun = (runs, isAncestor) => runs.find((r) => isAncestor(r.headSha)) ?? null;

/**
 * The benchmark step's conclusion in a run's jobs (`gh api …/runs/<id>/jobs`), or null.
 * @param {{ jobs?: { steps?: JobStep[] }[] }} jobs
 */
export function stepConclusion(jobs) {
  for (const job of jobs.jobs ?? [])
    for (const s of job.steps ?? [])
      if (s.name === STEP || s.name?.startsWith(OLD_STEP)) return s.conclusion ?? null;
  return null;
}

/**
 * What the release does, as an exit code and one line.
 * @param {BenchRun | null} run
 * @param {string | null} conclusion
 * @returns {{ exit: 0 | 1, level: 'notice' | 'warning' | 'error', text: string }}
 */
export function gate(run, conclusion) {
  if (!run)
    return {
      exit: 0,
      level: 'warning',
      text: 'no bench run on main covers this commit: released without a benchmark result',
    };
  const at = `bench run ${run.databaseId} on ${run.headSha.slice(0, 7)}`;
  if (conclusion === 'success')
    return { exit: 0, level: 'notice', text: `${at}: not slower than the last release` };
  if (conclusion === 'failure')
    return {
      exit: 1,
      level: 'error',
      text: `${at}: the benchmark failed (${run.url ?? 'see its summary'}). Fix it or re-run bench on main (Actions → bench → Run workflow), then re-run this release`,
    };
  return {
    exit: 0,
    level: 'warning',
    text: `${at}: its benchmark step did not finish (${conclusion ?? 'not found'}): released without a benchmark result`,
  };
}

/**
 * @param {string} cmd
 * @param {string[]} args
 */
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (!repo || !sha) {
    console.error('[bench-gate] needs GITHUB_REPOSITORY and GITHUB_SHA');
    process.exit(2);
  }
  const list = run('gh', [
    'run',
    'list',
    '-R',
    repo,
    '-w',
    'bench.yml',
    '--branch',
    'main',
    '--status',
    'completed',
    '-L',
    '50',
    '--json',
    'databaseId,headSha,conclusion,createdAt,url',
  ]);
  if (list.status !== 0) {
    console.error(`[bench-gate] gh run list failed: ${list.stderr.trim()}`);
    process.exit(2);
  }
  const runs = /** @type {BenchRun[]} */ (JSON.parse(list.stdout));
  const picked = pickRun(
    runs,
    (h) => run('git', ['merge-base', '--is-ancestor', h, sha]).status === 0
  );
  let conclusion = null;
  if (picked) {
    const jobs = run('gh', ['api', `repos/${repo}/actions/runs/${picked.databaseId}/jobs`]);
    if (jobs.status === 0)
      conclusion = stepConclusion(
        // gh api's answer for GET /repos/{repo}/actions/runs/{id}/jobs.
        /** @type {{ jobs?: { steps?: JobStep[] }[] }} */ (JSON.parse(jobs.stdout))
      );
  }
  const g = gate(picked, conclusion);
  console.log(`::${g.level}::${g.text}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Benchmark: ${g.text}\n`);
  process.exit(g.exit);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
