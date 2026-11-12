/** Setup and environment problems the ledger reports (integrity.mjs). */
import { conflictedStoreFiles } from '../approvals.mjs';
import { enforcementProblems, readinessTally, resolveEnforcement } from '../enforcement.mjs';
import { reportsIgnored } from '../decisions.mjs';
import { relPath } from '../paths.mjs';
import { readJson, readLines } from '../files.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { iso } from './context.mjs';
/** @import { EnvSummary, Project, StoryIndex, TornLine } from '../../types.js' */
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
 * The setup problems the last check's report shows: `env-mismatch` and `gate-colour-off`.
 * @param {IntegrityReport | null} report
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export const reportProblems = (report, ctx) => [
  ...envProblems(report, ctx),
  ...colourGateProblems(report, ctx),
];

/**
 * The colour rule's limits (schema/project.json `$defs/colourGate`): past one, it misses the small
 * colour changes it is there for (a badge tint, a status colour), so it counts as off.
 */
export const COLOUR_LIMITS = Object.freeze({
  deltaE: 10,
  minArea: 1024,
  cellDeltaE: 15,
  minCells: 16,
});

/**
 * `gate-colour-off`: entries the last check judged with the colour rule off, with one of its two
 * checks off (`minArea` or `minCells` 0), or loosened past [COLOUR_LIMITS]. Read from each row's
 * resolved gate, so every layer counts (the project, the workspace defaults, a story's own gate).
 * Rows from an engine before the rule (no `colour` key) are not counted.
 * `integrity.severity['gate-colour-off']` overrides the severity.
 * @param {IntegrityReport | null} report
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export function colourGateProblems(report, ctx) {
  /** @type {string[]} */
  const off = [];
  /** @type {string[]} */
  const loose = [];
  for (const r of report?.rows ?? []) {
    const g = /** @type {{ gate?: { colour?: Record<string, number> | null } }} */ (r).gate;
    if (!g || !('colour' in g)) continue;
    const c = g.colour;
    if (c == null) off.push(r.id);
    else if (
      !c.minArea ||
      !c.minCells ||
      Object.entries(COLOUR_LIMITS).some(([k, max]) => (c[k] ?? 0) > max)
    )
      loose.push(r.id);
  }
  const n = off.length + loose.length;
  if (!n) return [];
  const ids = [...off, ...loose];
  const parts = [
    ...(off.length ? [`${off.length} with it off`] : []),
    ...(loose.length ? [`${loose.length} with it loosened past its limits`] : []),
  ];
  return [
    {
      code: 'gate-colour-off',
      severity: ctx.integrity?.severity?.['gate-colour-off'] ?? 'warn',
      count: n,
      reason: `${n} entries were checked without the colour rule (${parts.join(', ')}: ${ids.slice(0, 3).join(', ')}${n > 3 ? ', …' : ''}): a colour change in a small area, such as a badge tint or a status colour, passes them. \`pxsig config\` names the layer that sets gate.colour; its limits are deltaE ${COLOUR_LIMITS.deltaE}, minArea ${COLOUR_LIMITS.minArea}, cellDeltaE ${COLOUR_LIMITS.cellDeltaE} and minCells ${COLOUR_LIMITS.minCells}, and 0 turns a check off`,
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
 * Decisions and the logs (lib/decisions.mjs, docs/decisions.md): `reports-not-ignored` when git
 * would pick up the store's reports/, so no reason is kept; `approvals-identity` when the config
 * still has the key no pxsig reads; `log-legacy-personal`, the lines written before 0.7.6 that
 * carry a reason or a `by`. `integrity.severity` overrides each severity.
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export function decisionProblems(ctx) {
  const P = ctx.project;
  if (!P) return [];
  /** @type {LedgerSetup[]} */
  const out = [];
  /** @param {string} code @param {LedgerSetup['severity']} severity @param {string} reason */
  const add = (code, severity, reason, count = 0) =>
    out.push({
      code,
      severity: ctx.integrity?.severity?.[code] ?? severity,
      ...(count ? { count } : {}),
      reason,
    });
  if (!reportsIgnored(P)) {
    const store = relPath(P.workspaceRoot, P.store.root) || '.';
    add(
      'reports-not-ignored',
      'warn',
      `${store}/reports/ is not git-ignored: reasons given with a decision, rejection notes and rejection packets are not kept, so none can be committed. Add \`reports/\` to ${store}/.gitignore (pxsig init writes it)`
    );
  }
  const identity = P.config.approvals?.identity;
  if (identity != null)
    add(
      'approvals-identity',
      identity === 'git-email' ? 'warn' : 'info',
      `approvals.identity is no longer read: log lines carry a decision reference, never a name. Remove the key from ${identityFiles(P)}`
    );
  const n = legacyPersonal(ctx.files.approvals);
  const m = legacyPersonal(join(dirname(ctx.files.a11y), 'a11y-decisions.ndjson'));
  if (n + m)
    add(
      'log-legacy-personal',
      'info',
      `${n} lines of approvals.ndjson and ${m} of a11y-decisions.ndjson, written before 0.7.6, carry a reason or a git email. New lines carry neither; old lines stay (the log is append-only, and git history keeps them either way)`,
      n + m
    );
  return out;
}

/**
 * The files that set `approvals.identity`, by name: the project's config, the workspace file's
 * `defaults`, or both. The loader records only the layer that won (`configSources`); a project
 * config that sets it can hide the workspace's, so only then is the workspace file read.
 * @param {Project} P
 */
function identityFiles(P) {
  const project = P.configSources?.['approvals.identity'] !== 'workspace defaults';
  const ws =
    !project ||
    (P.workspaceFile != null &&
      /** @type {{ defaults?: { approvals?: { identity?: unknown } } } | null} */ (
        readJson(P.workspaceFile, null)
      )?.defaults?.approvals?.identity != null);
  const names = [
    ...(project ? ['pxsig.config.json'] : []),
    ...(ws ? ['pxsig.workspace.json (defaults.approvals)'] : []),
  ];
  return names.join(' and ');
}

/** The reasons pxsig itself wrote before 0.7.6 (`check --update`'s default; undo, adopt, migrate). */
const OWN_REASON = new Set(['undo', 'adopt', 'migrate']);
/**
 * Lines of a log, written before 0.7.6, with a person's reason or a `by` (not `pxsig migrate`'s).
 * A log with neither key anywhere is not parsed.
 * @param {string} file
 */
function legacyPersonal(file) {
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8');
  if (!/"(by|reason)"\s*:\s*"/.test(text)) return 0;
  /** @param {Record<string, unknown>} l */
  const personal = (l) =>
    (typeof l.by === 'string' && l.by !== '' && l.by !== 'pxsig migrate') ||
    (typeof l.reason === 'string' &&
      l.reason !== '' &&
      l.reason !== 'pxsig check --update' &&
      !OWN_REASON.has(String(l.via)));
  return /** @type {Record<string, unknown>[]} */ (readLines(file).lines).filter(
    (l) => l && typeof l === 'object' && personal(l)
  ).length;
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
 * The story index's problems, and `project-empty`: a project with no entries at all (no story in
 * its index, none in its manifest, no signature), most often a package registered as a project
 * that is not one, such as a dashboard adapter (docs/integrity.md#setup-problems). A broken index
 * says why it is empty itself. `integrity.severity['project-empty']` overrides the severity.
 * @param {StoryIndex} index
 * @param {IntegrityContext} [ctx]
 * @param {number} [entries] the ledger's entry count
 * @returns {LedgerSetup[]}
 */
export function setupProblems(index, ctx, entries = 1) {
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
  if (ctx && !entries && out[0]?.code !== 'storybook-index-broken')
    out.push({
      code: 'project-empty',
      severity: ctx.integrity?.severity?.['project-empty'] ?? 'warn',
      reason: `project "${ctx.project?.name ?? ctx.config.name}" has no stories: none in its story index under ${ctx.srcRoot || '.'}, none in its manifest. A package registered as a project that is not one (a dashboard adapter, a package without stories) has none: an adapter belongs to a project's dashboard.ui, not to pxsig.workspace.json's projects (docs/ui/build-adapter.md). For a project whose stories are elsewhere, srcRoot names their folder`,
    });
  return out;
}
