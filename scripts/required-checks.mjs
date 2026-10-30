#!/usr/bin/env node
/**
 * required-checks.mjs — a release tag's commit passed every required check (release.yml, verify).
 *
 *   gh api --paginate --slurp repos/<owner>/<repo>/commits/<sha>/check-runs > runs.json
 *   node scripts/required-checks.mjs runs.json
 *
 * REQUIRED is the one list of the required checks: ci.yml's jobs, each matrix leg by the name
 * GitHub shows (`Rust (ubuntu-latest)`). Its test reads ci.yml, so the two cannot drift. The branch
 * protection on main requires the same names (set in the repository settings).
 * For each name, the latest run on the commit must have concluded `success`.
 * Exit: 0 all passed · 1 one is missing, failed or still running (each named) · 2 usage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OSES = ['ubuntu-latest', 'macos-latest', 'windows-latest'];

/** Every required check, as GitHub names it. */
export const REQUIRED = [
  'Clean repository',
  ...OSES.map((os) => `Rust (${os})`),
  ...OSES.map((os) => `Node (${os})`),
  ...OSES.map((os) => `Examples (end to end) (${os})`),
  'Older pxsig on this store',
];

/**
 * @typedef {{ id?: number, name?: string, status?: string, conclusion?: string | null, started_at?: string | null }} CheckRun
 */

/**
 * The check runs in `gh api` output: one page (`{ check_runs }`) or `--slurp`'s array of pages.
 * @param {unknown} json
 * @returns {CheckRun[]}
 */
export function checkRuns(json) {
  /** @type {unknown[]} */
  const pages = Array.isArray(json) ? json : [json];
  /** @type {CheckRun[]} */
  const runs = [];
  for (const p of pages) {
    const list =
      p && typeof p === 'object' && 'check_runs' in p && Array.isArray(p.check_runs)
        ? p.check_runs
        : [];
    for (const r of list) if (r && typeof r === 'object') runs.push(/** @type {CheckRun} */ (r));
  }
  return runs;
}

/**
 * What is not yet a pass: for each required name, its latest run (a re-run replaces an earlier
 * one) must be completed with `success`. Empty when every one passed.
 * @param {CheckRun[]} runs
 * @param {string[]} [required]
 */
export function missingChecks(runs, required = REQUIRED) {
  /** @type {string[]} */
  const problems = [];
  for (const name of required) {
    const latest = runs
      .filter((r) => r.name === name)
      .sort(
        (a, b) =>
          String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')) ||
          (b.id ?? 0) - (a.id ?? 0)
      )[0];
    if (!latest) problems.push(`${name}: no run on this commit`);
    else if (latest.status !== 'completed') problems.push(`${name}: ${latest.status ?? 'unknown'}`);
    else if (latest.conclusion !== 'success')
      problems.push(`${name}: ${latest.conclusion ?? 'no conclusion'}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/required-checks.mjs <check-runs.json>');
    process.exit(2);
  }
  const problems = missingChecks(checkRuns(JSON.parse(readFileSync(file, 'utf8'))));
  if (problems.length) {
    console.error(`[required-checks] ${problems.length} required check(s) not passed:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`[required-checks] ok · ${REQUIRED.length} required checks passed`);
}
