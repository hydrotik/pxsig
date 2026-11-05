/**
 * check/react.mjs — the React analysis beside a check. Alert mode: nothing here changes the exit
 * code, junit.xml or the `--sarif` (a11y) file.
 *
 * With `--since` / `--changed`, the compiler analysis (lib/react/index.mjs, two workers: the browsers
 * need the CPU) starts once the store lock is held and runs while the entries render; the check
 * waits for it before its history line. Render counting (`react.renders`) happens in the renders
 * themselves (lib/capture/render.mjs); this adds its counts to the history line and its terminal
 * line. `--update` writes baselines and analyses nothing.
 */
import { resolve } from 'node:path';
import { analyse } from '../lib/react/index.mjs';
import { warnOnce } from '../lib/react/config.mjs';
import { writeReactSarif } from '../lib/sarif-react.mjs';
import { summaryLine } from '../cli/react.mjs';
import { PXSIG_VERSION } from '../lib/workspace.mjs';
/** @import { CheckSetup } from './setup.mjs' */
/** @import { CheckRow, ManifestEntry } from '../types.js' */
/** @import { CheckReact, ReactRun } from '../types/react.js' */

/** Alerts printed before "… n more". */
const SHOWN = 10;
/** Entries named on the renders line before "…". */
const NAMED = 3;

/**
 * Start the compiler analysis, when the check compares with a ref or names changed files.
 * @param {CheckSetup} S
 * @returns {Promise<ReactRun> | null}
 */
export function startReact(S) {
  const { flags, str, P, runPath } = S;
  const since = str('since');
  const changed = str('changed');
  if (flags.update || (!since && !changed)) return null;
  return analyse(P, {
    // The same selection the check's own `affected` call got (check/select.mjs).
    ...(changed ? { files: changed.split(',') } : { since: since ?? undefined }),
    workers: 2,
    flags,
    manifest: runPath,
  }).catch((/** @type {Error} */ e) => ({
    ran: false,
    why: /** @type {const} */ ('failed'),
    text: `react: analysis failed (${e.message}): nothing compared`,
  }));
}

/**
 * check.json's `react`: the analysis' summary and alerts, or why it did not run; null when the run
 * did not ask for it (no `--since` / `--changed`).
 * @param {ReactRun | null} run
 * @returns {CheckReact | null}
 */
export function reactBlock(run) {
  if (!run) return null;
  if (!run.ran) return { skipped: run.why };
  const { summary, alerts, base, backend } = run.report;
  return { summary, alerts, base, backend };
}

/**
 * The history line's `react` counts, or null when there is nothing to count.
 * @param {ReactRun | null} run
 * @param {{ renders?: { settled: boolean } | null }[]} results this run's renders
 * @returns {{ react: Record<string, number> } | null}
 */
export function historyExtra(run, results) {
  /** @type {Record<string, number>} */
  const react = {};
  if (run?.ran) {
    react.alerts = run.report.summary.alerts;
    react.newBailouts = run.report.summary.newBailouts;
  }
  if (results.some((r) => r.renders !== undefined))
    react.renderAlerts = results.filter((r) => r.renders?.settled === false).length;
  return Object.keys(react).length ? { react } : null;
}

/**
 * The terminal lines, after the summary line: the analysis (or why it did not run) with its first
 * alerts, and the render counts. A switched-off analysis says nothing.
 * @param {ReactRun | null} run
 * @param {CheckRow[]} checked the rows this run checked
 * @returns {string[]}
 */
export function reactLines(run, checked) {
  /** @type {string[]} */
  const lines = [];
  if (run?.ran) {
    const { report } = run;
    lines.push(`[check] ${summaryLine(report, report.summary.cached)}`);
    for (const a of report.alerts.slice(0, SHOWN)) lines.push(`[check]   ${a.text}`);
    if (report.alerts.length > SHOWN)
      lines.push(`[check]   … ${report.alerts.length - SHOWN} more in reports/react.json`);
  } else if (run?.why === 'config') {
    // On stderr, like every settings warning, and once: render counting may have said it already.
    warnOnce(run.text.replace(/^\[pxsig\] /, ''));
  } else if (run?.why === 'failed') {
    lines.push(`[check] ${run.text}. The check is not affected.`);
  } else if (run?.why === 'not-installed') {
    lines.push(`[check] ${run.text}`);
  }
  const counted = checked.filter((r) => r.renders !== undefined);
  if (counted.length) {
    const react = counted.filter((r) => r.renders != null);
    const still = react.filter((r) => r.renders?.settled === false).map((r) => r.id);
    const named = still.length
      ? ` (${still.slice(0, NAMED).join(', ')}${still.length > NAMED ? ', …' : ''})`
      : '';
    lines.push(
      react.length
        ? `[check] renders: ${react.length} entries · ${still.length} still rendering at capture${named}`
        : `[check] renders: no React renderer in the ${counted.length} entries checked`
    );
  }
  return lines;
}

/**
 * `--react-sarif <file>`: the compiler alerts and the entries still rendering at capture.
 * @param {string} file as given
 * @param {ReactRun | null} run
 * @param {CheckRow[]} rows
 * @param {ManifestEntry[]} stories
 * @returns {string} the terminal line
 */
export function reactSarif(file, run, rows, stories) {
  const n = writeReactSarif(resolve(file), {
    alerts: run?.ran ? run.report.alerts : [],
    rows,
    entries: new Map(stories.map((e) => [e.id, e])),
    version: PXSIG_VERSION,
  });
  return `[check] wrote ${n} React alerts to ${file} (SARIF)`;
}
