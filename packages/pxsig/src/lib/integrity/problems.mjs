/** Setup and environment problems the ledger reports (integrity.mjs). */
import { conflictedStoreFiles } from '../approvals.mjs';
import { enforcementProblems, readinessTally, resolveEnforcement } from '../enforcement.mjs';
import { iso } from './context.mjs';
/** @import { EnvSummary, StoryIndex, TornLine } from '../../types.js' */
/** @import { IntegrityReport, IntegrityRow, LedgerSetup } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

/**
 * @param {{
 *   report: IntegrityReport | null, reportAt: number | null, manifestMtime: number | null,
 *   sigAt: number | null, latestAt: number | null, row: IntegrityRow | null
 * }} facts
 */
export function neverCheckedReason({ report, reportAt, manifestMtime, sigAt, latestAt, row }) {
  if (!report) return 'no report yet (reports/check.json is missing): run a full check';
  if (row?.skipped) return 'carried forward by a partial check with no earlier result to carry';
  const parts = [];
  // The signature's write time is the best evidence of when the entry appeared (the manifest's own
  // mtime moves with every later edit).
  const added = sigAt ?? manifestMtime;
  if (reportAt != null && added != null && added > reportAt)
    parts.push(
      `added after the last full check (${iso(reportAt)}): its ${sigAt != null ? 'signature' : 'manifest entry'} dates from ${iso(added)}`
    );
  else
    parts.push(
      `absent from the last full check (${iso(reportAt)}), which ran on a different manifest or a --modes / --manifest subset`
    );
  if (latestAt != null && reportAt != null && latestAt > reportAt)
    parts.push(
      `rendered ${iso(latestAt)} by a partial re-check that did not record it (re-checks only updated rows already in the report)`
    );
  return parts.join('; ');
}

/**
 * Baselines no approval line covers: a warning before strict `approve verify` fails a pull request on them.
 * @param {string[]} ids
 * @param {IntegrityContext} _ctx
 * @returns {LedgerSetup[]}
 */
export function unloggedProblems(ids, _ctx) {
  if (!ids.length) return [];
  return [
    {
      code: 'verify-unlogged',
      severity: 'warn',
      count: ids.length,
      reason: `${ids.length} baselines have no approval log line (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}): \`pxsig approve verify\` fails on them (strict by default since 0.4.0). For baselines from before pxsig kept a log, a person runs \`pxsig approve verify --adopt\` once; \`--no-strict\` only reports them`,
    },
  ];
}

/**
 * Renders made in a different environment than their baseline (lib/env.mjs): one setup-level
 * warning, never a per-entry code, so story cards and `doctor`'s exit stay as they are
 * (docs/integrity.md#setup-problems). `integrity.severity['env-mismatch']` overrides the severity.
 * @param {IntegrityReport | null} report
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export function envProblems(report, ctx) {
  const n = report?.summary?.envMismatch ?? 0;
  if (!n) return [];
  // A count was read from report.summary on the line before: both are there.
  const fields = /** @type {{ summary: Partial<EnvSummary> }} */ (report).summary.envFields?.length
    ? ` (${/** @type {{ summary: { envFields: string[] } }} */ (report).summary.envFields.join(', ')})`
    : '';
  const severity = ctx.integrity?.severity?.['env-mismatch'] ?? 'warn';
  return [
    {
      code: 'env-mismatch',
      severity,
      count: n,
      reason: `${n} entries were rendered in a different environment than their baseline${fields}: a change there can be the machine, not the code. Render where the baselines were made (the pinned container), or re-take them there (\`pxsig check --full --update --kind environment\`); \`--strict-env\` refuses such a run instead`,
    },
  ];
}

/**
 * Warn mode (lib/enforcement.mjs): `enforcement-warn`, `enforcement-ending`, `enforcement-expired`
 * when the committed config chose warn for a gate. The quiet built-in a11y default adds nothing
 * (docs/configuration.md#enforcement). A config this process cannot resolve
 * (PXSIG_ENFORCEMENT=warn) adds nothing here: the gated commands refuse it themselves.
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export function warnModeProblems(ctx) {
  if (!ctx.project) return [];
  let enf;
  try {
    enf = resolveEnforcement(ctx.project, {
      flags: {},
    });
  } catch {
    return [];
  }
  return enforcementProblems(enf, enf.configured.length ? readinessTally(ctx.project) : null).map(
    (x) => ({ ...x, severity: ctx.integrity?.severity?.[x.code] ?? x.severity })
  );
}

/**
 * Store files a merge or rebase left conflicted (docs/ci.md#rebasing-with-baselines).
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export function conflictProblems(ctx) {
  if (!ctx.project) return [];
  const files = conflictedStoreFiles(ctx.project);
  if (!files.length) return [];
  return [
    {
      code: 'store-conflict',
      severity: 'error',
      count: files.length,
      reason: `${files.length} store files are conflicted (a merge or rebase is not finished): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}. Take main's version of each baseline, keep both sides' lines of a log, then \`pxsig check --since main\` and approve again (docs/ci.md, "Rebasing with baselines")`,
    },
  ];
}

/**
 * A log line a crash cut short: left out of every reading, removed only by a person.
 * @param {string} file
 * @param {TornLine[]} torn
 * @returns {LedgerSetup[]}
 */
export function tornProblems(file, torn) {
  if (!torn.length) return [];
  return [
    {
      code: 'log-torn',
      severity: 'warn',
      count: torn.length,
      reason: `${torn.length} line(s) of ${file} were cut short by a crash (line ${torn.map((t) => t.line).join(', ')}) and are left out: \`pxsig doctor --repair --only log-torn --apply\` (a person at a terminal) removes them`,
    },
  ];
}

/**
 * @param {StoryIndex} index
 * @returns {LedgerSetup[]}
 */
export function setupProblems(index) {
  /** @type {LedgerSetup[]} */
  const out = [];
  if (index.storybook?.reachable && !index.storybook.healthy)
    out.push({
      code: 'storybook-index-broken',
      severity: 'error',
      // An unhealthy index that answered always carries its error (fetchStoryIndex).
      reason: /** @type {string} */ (index.storybook.error),
    });
  else if (!index.storybook?.reachable && index.source === 'static')
    out.push({
      code: 'storybook-unreachable',
      severity: 'info',
      reason: `${index.storybook?.error ?? 'not reachable'}: reconciled against a static scan of the story files`,
    });
  return out;
}
