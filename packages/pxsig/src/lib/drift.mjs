/**
 * drift.mjs — entries that pass while their render differs from the baseline (docs/integrity.md,
 * "Drift"). A passing entry keeps its old baseline, so a change the gate does not see passes this
 * way, unrecorded: the count is reported on every check (the `[check] drift:` line, summary.md,
 * SARIF, `pxsig doctor`, the dashboard), and past `drift.warnAt` it is the `drift-high` warning.
 * Never a verdict: nothing here changes a pass or a fail.
 */
import { join } from 'node:path';
import { readJson } from './files.mjs';
/** @import { CheckRow, DriftSummary, DriftWarnAt, Project } from '../types.js' */
/** @import { LedgerSetup } from '../types/t3.js' */

/** `drift.warnAt`'s defaults: same-content re-renders of pxsig's own dashboard drift up to 7.4%. */
export const DRIFT_WARN_AT = Object.freeze({ count: 5, share: 0.2 });
/** Its limits (schema/project.json): a value past one reads as the limit, so it never turns off. */
export const DRIFT_LIMITS = Object.freeze({ count: 100, share: 0.5 });

/**
 * A row that passes while its render's pixels are not its baseline image's: the engine's `differs`
 * (0.7.7 and later), else, for a row an older engine wrote, SSIM below 1. A skipped, flaky or
 * failed row never drifts.
 * @param {Partial<CheckRow> | null | undefined} row
 */
export function drifts(row) {
  if (!row || row.skipped || row.error || row.flaky || row.pass !== true) return false;
  if (typeof row.differs === 'boolean') return row.differs;
  const m = /** @type {{ ssim?: number } | null | undefined} */ (row.metrics);
  return typeof m?.ssim === 'number' && m.ssim < 1;
}

/** The reason on an entry's `drift` issue. @param {Partial<CheckRow>} row */
export const driftReason = (row) => {
  const m = /** @type {{ ssim?: number } | null | undefined} */ (row.metrics);
  return `passes, while its render differs from the baseline${typeof m?.ssim === 'number' ? ` (ssim ${m.ssim})` : ''}`;
};

/**
 * `drift.warnAt` from a project config, each value held to its limit.
 * @param {{ drift?: { warnAt?: Partial<DriftWarnAt> } } | null | undefined} config
 * @returns {DriftWarnAt}
 */
export function warnAt(config) {
  const w = config?.drift?.warnAt ?? {};
  /** @param {'count' | 'share'} k */
  const v = (k) => {
    const x = Number(w[k]);
    return Number.isFinite(x) && x > 0 ? Math.min(x, DRIFT_LIMITS[k]) : DRIFT_WARN_AT[k];
  };
  return { count: Math.ceil(v('count')), share: v('share') };
}

/**
 * check.json's `summary.drift`: of the checked entries that pass, those whose render differs from
 * the baseline. `count` and `share` leave out renders from a different environment than their
 * baseline (`envMatch: mismatch`), which the `env` line already explains; those are `otherEnv`.
 * `warn` when both `count` and `share` reach `warnAt`.
 * @param {Partial<CheckRow>[]} rows
 * @param {DriftWarnAt} [at]
 * @returns {{ drift: DriftSummary }}
 */
export function driftSummary(rows, at = DRIFT_WARN_AT) {
  const passing = rows.filter((r) => !r.skipped && !r.error && !r.flaky && r.pass === true);
  const own = passing.filter((r) => r.envMatch !== 'mismatch');
  const count = own.filter(drifts).length;
  const share = own.length ? Math.round((count / own.length) * 1000) / 1000 : 0;
  return {
    drift: {
      count,
      of: own.length,
      share,
      otherEnv: passing.filter((r) => r.envMatch === 'mismatch' && drifts(r)).length,
      warnAt: at,
      warn: count > 0 && count >= at.count && share >= at.share,
    },
  };
}

/** "136 of 161 passing entries (84.5%)". @param {DriftSummary} d */
const counted = (d) =>
  `${d.count} of ${d.of} passing ${d.of === 1 ? 'entry' : 'entries'} (${Math.round(d.share * 1000) / 10}%)`;
/** @param {DriftWarnAt} at */
const limits = (at) => `drift.warnAt: ${at.count} entries and ${Math.round(at.share * 100)}%`;

/**
 * The `[check] drift:` line, or null when nothing drifts.
 * @param {DriftSummary | null | undefined} d
 */
export function driftLine(d) {
  if (!d || !(d.count + d.otherEnv)) return null;
  const other = d.otherEnv ? `; ${d.otherEnv} more rendered in a different environment` : '';
  return d.warn
    ? `drift: ${counted(d)} differ from their baseline, at or over ${limits(d.warnAt)}${other}: a change the gate does not see passes this way → pxsig list drift`
    : `drift: ${counted(d)} differ from their baseline, within the gate${other} → pxsig list drift`;
}

/**
 * `drift-high`: the last check's drift at or over `drift.warnAt`. A warning at least, like
 * `gate-color-off`: `integrity.severity['drift-high']` can raise it to error; a lower value is not
 * applied but named in the reason. `drift.warnAt` is how a project tunes it, within its limits.
 * @param {{ summary?: { drift?: DriftSummary } } | null} report
 * @param {{ integrity?: { severity?: Record<string, string> } }} ctx
 * @returns {LedgerSetup[]}
 */
export function driftProblems(report, ctx) {
  const d = report?.summary?.drift;
  if (!d?.warn) return [];
  const set = ctx.integrity?.severity?.['drift-high'];
  const lowered =
    set && set !== 'warn' && set !== 'error'
      ? `. integrity.severity sets drift-high to "${set}", which is not applied: it is a warning at least, and can only be raised to error`
      : '';
  return [
    {
      code: 'drift-high',
      severity: set === 'error' ? 'error' : 'warn',
      count: d.count,
      reason: `${counted(d)} pass while their render differs from the baseline, at or over ${limits(d.warnAt)}. A change the gate does not see, such as a color change in a small area, passes this way, and their baselines stay as they were. \`pxsig list drift\` (or the dashboard's Stories, "Passing, but differs from the baseline") lists them. An intended change gets new baselines from a person (\`pxsig check --full --update --only <ids>\`); one the gate should have failed means the gate is too loose for this project (\`pxsig config\` names the layer that sets it)${lowered}`,
    },
  ];
}

/**
 * The last check's drift, for `pxsig doctor`: check.json's `summary.drift`, or counted from its rows
 * when a check before 0.7.7 wrote it. null with no report.
 * @param {Project} P
 * @returns {DriftSummary | null}
 */
export function driftOf(P) {
  // check.json, as pxsig writes it.
  const check = /** @type {{ summary?: { drift?: DriftSummary }, rows?: CheckRow[] } | null} */ (
    readJson(join(P.store.reports, 'check.json'), null)
  );
  if (!check) return null;
  return check.summary?.drift ?? driftSummary(check.rows ?? [], warnAt(P.config)).drift;
}

/**
 * Doctor's `Drift` line: the count, or `none`.
 * @param {DriftSummary | null} d
 */
export function driftCell(d) {
  if (!d) return 'no report';
  return driftLine(d)?.replace(/^drift: /, '') ?? `none of ${d.of} passing entries`;
}
