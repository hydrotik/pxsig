/**
 * check/compare.mjs — stage 3: `pxsig check` (Rust) on this run's renders: per-entry gates and
 * grids, the content cache, the history line (with the enforcement gates when config sets any, and
 * the React counts when there are any), and each render's environment (`--env`), so text labels
 * compare like for like.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { historyExtra } from './react.mjs';
import { envPlan } from '../lib/text/env-plan.mjs';
import { blockedReasons, LARGE_SHARE, maskChange } from '../lib/mask-words.mjs';
/** @import { CheckSetup } from './setup.mjs' */
/** @import { Selection } from './select.mjs' */
/** @import { Rendered } from './render.mjs' */
/** @import { A11yBaseline, EngineCheckOutput, EngineCheckRow } from '../types/t4.js' */
/** @import { ReactRun } from '../types/react.js' */
/** @import { EnvRecord } from '../types.js' */

/** @typedef {ReturnType<typeof compare>} Compared */

/**
 * @param {CheckSetup} S
 * @param {Selection} sel
 * @param {Rendered} run
 * @param {ReactRun | null} [react] the compiler analysis, when the run asked for it
 * @param {Record<string, EnvRecord>} [current] the run's env per browser (check/prepare.mjs)
 */
export function compare(S, sel, run, react = null, current = {}) {
  const { runPath, P, reports, enf, a11yBaselinePath, rust, pngDir, diffDir } = S;
  const { entries } = sel;
  const { results, onlyFile } = run;
  // --- 3. check (Rust) ------------------------------------------------------------------------
  // Each render's environment: the engine compares text records only within one (the retry too).
  const envFile = join(reports, '.check-env.json');
  writeFileSync(envFile, JSON.stringify(envPlan(entries, current)));
  const checkArgs = (
    /** @type {string} */ dir,
    /** @type {string} */ out,
    /** @type {string[]} */ extra = []
  ) => [
    'check',
    '--manifest',
    runPath,
    '--png-dir',
    dir,
    '--root',
    P.workspaceRoot,
    '--out-dir',
    out,
    '--only',
    `@${onlyFile}`,
    '--json',
    '--env',
    `@${envFile}`,
    ...extra,
  ];
  // Warn mode chosen in config: the history line records the gates and whether the run would fail.
  const enfFile = join(reports, '.enforcement.json');
  /** @type {string[]} */
  const historyEnf = [];
  if (enf?.configured.length) {
    // a11y.json, as pxsig writes it.
    const base = existsSync(a11yBaselinePath)
      ? /** @type {A11yBaseline} */ (JSON.parse(readFileSync(a11yBaselinePath, 'utf8')))
      : {};
    const a11yNew = results.filter((r) =>
      // renderStories gives every result its entry's id.
      r.a11y?.violations?.some((v) => !(base[/** @type {string} */ (r.id)] ?? []).includes(v.id))
    ).length;
    writeFileSync(enfFile, JSON.stringify({ gates: enf.gates, a11yNew }));
    historyEnf.push('--enforcement', `@${enfFile}`);
  }
  // React: the alerts, newly skipped functions and entries still rendering, on the history line.
  const extraFile = join(reports, '.history-extra.json');
  const extra = historyExtra(react, results);
  if (extra) {
    writeFileSync(extraFile, JSON.stringify(extra));
    historyEnf.push('--history-extra', `@${extraFile}`);
  }
  let rc = entries.length
    ? rust(
        checkArgs(pngDir, diffDir, [
          '--cache',
          join(P.store.cache, 'check'),
          '--history',
          join(reports, 'history.ndjson'),
          ...historyEnf,
        ])
      )
    : { out: '{"summary":{"elapsedMs":0},"results":[]}', ms: 0 };
  rmSync(enfFile, { force: true });
  rmSync(extraFile, { force: true });
  // `pxsig check --json` (or the empty result above).
  const rustRes = /** @type {EngineCheckOutput} */ (JSON.parse(rc.out));
  /** @type {Map<string, EngineCheckRow>} */
  const rows = new Map(rustRes.results.map((r) => [r.id, r]));
  console.log(
    `[check] Rust check: ${rustRes.results.length} entries, ${rustRes.summary.failed ?? 0} failed, ${rustRes.summary.cached ?? 0} cached · ${rustRes.summary.elapsedMs.toFixed(0)} ms engine (${rc.ms.toFixed(0)} ms process)`
  );
  for (const g of rustRes.summary.identicalRenders ?? [])
    console.error(
      `[check] ${g.count} failing entries rendered the same image (${g.ids.slice(0, 3).join(', ')}…): the environment, not a design change. Marked as errors; nothing to approve.`
    );
  // Masks: over half a capture or on the story root, a failure no approval clears; changed, for a
  // person to review; over a quarter (all of an entry's masks together), a warning.
  for (const r of rustRes.results) {
    const pct = (/** @type {number} */ n) => `${Math.round(n * 100)}%`;
    if (r.masksBlocked)
      console.error(
        `[check] mask: ${r.id}: ${blockedReasons(r).join('; ')}: no approval passes it until the masks are smaller`
      );
    if (r.masksChanged) console.error(`[check] mask: ${r.id}: ${maskChange(r.masksChanged)}`);
    if (!r.masksBlocked && (r.masksCoverage ?? 0) > LARGE_SHARE)
      console.error(
        `[check] mask: ${r.id}: masks cover ${pct(r.masksCoverage ?? 0)} of the capture (${(r.masks ?? []).map((m) => `${m.selector} ${pct(m.area)}`).join(', ')}), which hides most changes under them`
      );
  }
  return { checkArgs, rc, rustRes, rows };
}
