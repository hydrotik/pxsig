/**
 * screens-engine.mjs — the verdicts of a screens run (scripts/screens-check.mjs), as `pxsig check`
 * makes them: this checkout's engine compares the renders in the store's renders/latest with their
 * baselines (lib/screens-verdict.mjs), and the store's reports/check.json, summary.md and
 * junit.xml are written from its rows, with the earlier verdict of any screen `--only` left out.
 * Review decisions belong to the run they were made on, so review.json and a11y-review.json go.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { annotateRow, byId, envSummary } from '../../packages/pxsig/src/lib/env.mjs';
import { writeJson } from '../../packages/pxsig/src/lib/files.mjs';
import { buildRow, summarize } from '../../packages/pxsig/src/lib/rows.mjs';
import { envPlan } from '../../packages/pxsig/src/lib/text/env-plan.mjs';
import { assertVerdicts, verdictEngine } from './screens-verdict.mjs';

/** @import { CheckRow, ManifestEntry, Project, RunManifest } from '../../packages/pxsig/src/types.js' */
/** @import { EnvFields, EnvRecord } from '../../packages/pxsig/src/types/env.js' */
/** @import { EngineCheckOutput } from '../../packages/pxsig/src/types/t4.js' */

/**
 * Run the engine's check on the selected renders and write the reports; the rows and summary.
 * @param {object} o
 * @param {Project} o.P
 * @param {{ path: string, manifest: RunManifest }} o.run the run manifest (writeRunManifest)
 * @param {ManifestEntry[]} o.entries every entry of the manifest
 * @param {string[]} o.selected the entry ids this run rendered (or failed to)
 * @param {Map<string, { id: string, png?: string, error?: string, ms: number }>} o.render
 * @param {Record<string, EnvRecord>} o.current the render environments (`pool.envs`)
 * @param {ReturnType<typeof import('../../packages/pxsig/src/lib/env.mjs').envConfig>} o.envCfg
 * @param {{ check: () => void, release: () => void }} o.lock the store's lock, released at the end
 * @param {(m: string) => never} o.die
 * @param {string | null | undefined} o.only `--only`'s fixture features, if any
 * @param {number} o.renderWallMs
 */
export function engineVerdicts({
  P,
  run,
  entries,
  selected,
  render,
  current,
  envCfg,
  lock,
  die,
  only,
  renderWallMs,
}) {
  // The engine's check, as `pxsig check` runs it.
  const reports = P.store.reports;
  mkdirSync(reports, { recursive: true });
  const onlyFile = join(reports, '.selected.json');
  writeFileSync(onlyFile, JSON.stringify(selected.filter((id) => render.get(id)?.png)));
  // Each screen's environment: the engine compares text records only within one. The image's
  // engine may predate `check --env` (it then labels no text): the plan goes only to one that takes it.
  const envFile = join(reports, '.check-env.json');
  writeFileSync(envFile, JSON.stringify(envPlan(entries, current)));
  // The verdicts: this checkout's engine when there is a build of it (lib/screens-verdict.mjs).
  const checkBin = verdictEngine(process.env, P.rustBin);
  const takesEnv = spawnSync(checkBin, ['check', '--help'], { encoding: 'utf8' }).stdout?.includes(
    '--env'
  );
  const engineRun = (/** @type {string[]} */ a) => {
    const r = spawnSync(checkBin, a, {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      cwd: P.workspaceRoot,
    });
    if (r.status === 2) die(`pxsig ${a[0]} failed: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  lock.check();
  const rustRes = /** @type {EngineCheckOutput} */ (
    JSON.parse(
      engineRun([
        'check',
        '--manifest',
        run.path,
        '--png-dir',
        P.store.latest,
        '--root',
        P.workspaceRoot,
        '--out-dir',
        P.store.diffLatest,
        '--only',
        `@${onlyFile}`,
        ...(takesEnv ? ['--env', `@${envFile}`] : []),
        '--json',
        '--history',
        join(reports, 'history.ndjson'),
      ])
    )
  );
  const rows = new Map(rustRes.results.map((r) => [r.id, r]));
  try {
    assertVerdicts(rustRes.results);
  } catch (e) {
    die(/** @type {Error} */ (e).message);
  }

  // check.json: this run's rows, and the earlier verdict of any screen --only left out.
  const reportPath = join(reports, 'check.json');
  const previous = existsSync(reportPath)
    ? /** @type {{ rows?: CheckRow[], envs?: Record<string, EnvFields>, fullCheckAt?: string } } */ (
        JSON.parse(readFileSync(reportPath, 'utf8'))
      )
    : null;
  const prevRows = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
  const envs = { ...previous?.envs, ...rustRes.baselineEnvs, ...byId(current) };
  const want = new Set(selected);
  /** @type {CheckRow[]} */
  const out = entries.map((e) => {
    if (!want.has(e.id)) {
      const p = prevRows.get(e.id);
      return p
        ? { ...p, skipped: true, inherited: true }
        : {
            id: e.id,
            story: e.story,
            mode: e.mode,
            state: null,
            skipped: true,
            pass: true,
            metrics: null,
            inherited: false,
          };
    }
    return annotateRow(buildRow(e, rows.get(e.id), render.get(e.id), {}, run.manifest, null), {
      current,
      envs,
      ignore: envCfg.ignore,
    });
  });
  const now = new Date().toISOString();
  const summary = summarize(out, {
    renderWallMs,
    rustEngineMs: rustRes.summary.elapsedMs,
    ...envSummary(out, envs),
  });
  const used = new Set(out.flatMap((r) => [r.env, r.baselineEnv]).filter(Boolean));
  lock.check();
  writeJson(reportPath, {
    generatedAt: now,
    fullCheckAt: only ? (previous?.fullCheckAt ?? null) : now,
    project: P.name,
    suite: null,
    manifest: {
      grid: run.manifest.grid,
      gate: run.manifest.gate,
      modes: run.manifest.modes,
      defaultMode: run.manifest.defaultMode,
    },
    summary,
    affected: null,
    envs: Object.fromEntries(Object.entries(envs).filter(([id]) => used.has(id))),
    rows: out,
  });
  // Review decisions belong to the run they were made on: a new run starts clean.
  for (const f of ['review.json', 'a11y-review.json']) rmSync(join(reports, f), { force: true });
  for (const [format, file] of [
    ['markdown', 'summary.md'],
    ['junit', 'junit.xml'],
  ])
    engineRun(['report', '--input', reportPath, '--format', format, '--out', join(reports, file)]);
  rmSync(onlyFile, { force: true });
  lock.release();
  return { out, summary };
}
