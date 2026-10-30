/** The ledger's vocabulary (integrity.mjs): codes, severities, issues, the summary and filters. */
/** @import { CodeInfo, IntegrityCode, Issue, IssueExtra, Ledger, LedgerComponent, LedgerEntry, LedgerFilter, LedgerSummary, Severity } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

export const SCHEMA_VERSION = 1;

/**
 * Status codes. Stable and machine-readable: never renamed, only added to.
 * `rank` orders codes within a severity when picking an entry's primary status.
 * @type {Record<IntegrityCode, CodeInfo>}
 */
export const CODES = {
  unregistered: {
    severity: 'error',
    rank: 1,
    title: 'Story has no coverage',
    help: 'The story is in the story index but not in the manifest: nothing renders or checks it.',
  },
  'render-error': {
    severity: 'error',
    rank: 2,
    title: 'Render failed',
    help: 'The last render of this entry failed (timeout, missing selector, Storybook error page).',
  },
  'never-checked': {
    severity: 'error',
    rank: 3,
    title: 'Never checked',
    help: 'In the manifest, with a signature, but absent from the last report.',
  },
  'missing-baseline-image': {
    severity: 'error',
    rank: 4,
    title: 'Baseline image missing',
    help: 'The signature exists but the baseline display PNG does not: the dashboard and the approval list cannot show the baseline.',
  },
  'legacy-format': {
    severity: 'warn',
    rank: 4.5,
    title: 'Legacy baseline format',
    help: 'A pre-0.2 `.pxsig.json` baseline: it holds the signature but cannot hold the baseline image. `pxsig doctor --repair` converts it to `.psig` when its latest render passes the gate; `pxsig migrate` moves a whole legacy store.',
  },
  unbaselined: {
    severity: 'warn',
    rank: 5,
    title: 'New: no baseline yet',
    help: 'In the manifest without a signature. A person must review and approve its first render.',
  },
  'missing-render': {
    severity: 'warn',
    rank: 6,
    title: 'No latest render',
    help: 'There is no latest render on disk to compare or review.',
  },
  orphaned: {
    severity: 'warn',
    rank: 7,
    title: 'Orphaned',
    help: 'A signature or baseline image whose story no longer exists (renamed or deleted).',
  },
  changed: {
    severity: 'warn',
    rank: 8,
    title: 'Changed',
    help: 'The gate failed: the render differs from the baseline. Needs review.',
  },
  flaky: {
    severity: 'warn',
    rank: 9,
    title: 'Flaky',
    help: 'Failed, then passed on a fresh render.',
  },
  stale: {
    severity: 'warn',
    rank: 10,
    title: 'Stale verdict',
    help: 'A source the entry depends on changed after its verdict (or its render was rewritten after it).',
  },
  'a11y-new': {
    severity: 'warn',
    rank: 11,
    title: 'New a11y violations',
    help: 'axe reports violations not in the a11y baseline.',
  },
  'skipped-unaffected': {
    severity: 'info',
    rank: 11.5,
    title: 'Skipped: unaffected',
    help: 'A partial run (--since / --changed) left it out because no edit can change it (import graph). It has a baseline but no verdict of its own yet: ok, unverified.',
  },
  drift: { severity: 'info', rank: 12, title: 'Drift', help: 'Passes the gate, but SSIM < 1.' },
  excluded: {
    severity: 'info',
    rank: 13,
    title: 'Excluded',
    help: 'Excluded by configuration (nonVisual folder, parameters.pxsig.disable or the no-pxsig tag).',
  },
  ok: {
    severity: 'info',
    rank: 14,
    title: 'OK',
    help: 'Covered, rendered, checked, fresh and passing.',
  },
};
/** @type {Severity[]} */
export const SEVERITIES = ['error', 'warn', 'info'];
/** @param {Severity} s */
const sevRank = (s) => SEVERITIES.indexOf(s);

/**
 * @param {IntegrityContext} ctx
 * @param {IntegrityCode} code
 * @param {string} reason
 * @param {IssueExtra} [extra]
 * @returns {Issue}
 */
export const issue = (ctx, code, reason, extra = {}) => ({
  code,
  severity: ctx.integrity.severity[code] ?? CODES[code].severity,
  reason,
  ...extra,
});

/**
 * Most severe first, then by code rank: the order issues are listed in.
 * @param {{ code: IntegrityCode, severity: Severity }} a
 * @param {{ code: IntegrityCode, severity: Severity }} b
 */
export const byGravity = (a, b) =>
  sevRank(a.severity) - sevRank(b.severity) || CODES[a.code].rank - CODES[b.code].rank;

/**
 * The primary status of a list of issues: the most severe, then the lowest rank.
 * @param {readonly { code: IntegrityCode, severity: Severity }[]} issues
 * @returns {{ code: IntegrityCode, severity: Severity }}
 */
export function primaryOf(issues) {
  if (!issues.length) return { code: 'ok', severity: 'info' };
  const top = [...issues].sort(byGravity)[0];
  return { code: top.code, severity: top.severity };
}

/** @type {Partial<Record<string, [string, string]>>} */
const PLURAL = {
  unregistered: ['unregistered story', 'unregistered stories'],
  'render-error': ['render error', 'render errors'],
  'never-checked': ['never-checked entry', 'never-checked entries'],
  'missing-baseline-image': ['missing baseline image', 'missing baseline images'],
  'legacy-format': ['legacy .pxsig.json baseline', 'legacy .pxsig.json baselines'],
  'skipped-unaffected': [
    'unaffected entry not yet verified',
    'unaffected entries not yet verified',
  ],
  unbaselined: ['new entry without a baseline', 'new entries without a baseline'],
  'missing-render': ['missing render', 'missing renders'],
  orphaned: ['orphan', 'orphans'],
  changed: ['changed entry', 'changed entries'],
  flaky: ['flaky entry', 'flaky entries'],
  stale: ['stale verdict', 'stale verdicts'],
  'a11y-new': ['entry with new a11y violations', 'entries with new a11y violations'],
};
/**
 * @param {string} code
 * @param {number} n
 */
export const phrase = (code, n) => `${n} ${(PLURAL[code] ?? [code, code])[n === 1 ? 0 : 1]}`;

/** Info-severity statuses that are not findings: `doctor --fail-on info` never fails on these. */
export const BENIGN_INFO = new Set(['ok', 'excluded', 'drift']);

/**
 * @param {LedgerEntry[]} entries
 * @param {LedgerComponent[]} components
 * @returns {LedgerSummary}
 */
export function summarise(entries, components) {
  /** @type {Partial<Record<IntegrityCode, number>>} */
  const byCode = {};
  /** @type {Partial<Record<IntegrityCode, number>>} */
  const byStatus = {};
  /** @type {Record<Severity, number>} */
  const bySeverity = { error: 0, warn: 0, info: 0 };
  for (const x of entries) {
    byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    bySeverity[x.severity]++;
    for (const i of x.issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  }
  const errComps = components.filter((c) => c.severity === 'error');
  const warnComps = components.filter((c) => c.severity === 'warn');
  const errCodes = /** @type {IntegrityCode[]} */ (Object.keys(CODES)).filter(
    (c) =>
      byCode[c] && entries.some((x) => x.issues.some((i) => i.code === c && i.severity === 'error'))
  );
  const headline = errComps.length
    ? `${errComps.length} component${errComps.length === 1 ? '' : 's'} with errors: ${errCodes.map((c) => phrase(c, entries.filter((x) => x.issues.some((i) => i.code === c && i.severity === 'error')).length)).join(', ')}`
    : warnComps.length
      ? `No errors; ${warnComps.length} component${warnComps.length === 1 ? '' : 's'} with warnings`
      : 'No issues';
  return {
    status: errComps.length ? 'attention' : warnComps.length ? 'warnings' : 'clean',
    headline,
    entries: entries.length,
    components: components.length,
    componentsBySeverity: {
      error: errComps.length,
      warn: warnComps.length,
      info: components.length - errComps.length - warnComps.length,
    },
    bySeverity,
    /** Info-severity entries whose status is a finding (not ok / excluded / drift). */
    infoFindings: entries.filter((x) => x.severity === 'info' && !BENIGN_INFO.has(x.status)).length,
    byStatus,
    byCode,
  };
}

/**
 * Filter a ledger for a view (doctor --component / --status, the addon, MCP).
 * @param {Ledger} ledger
 * @param {LedgerFilter} [view]
 */
export function filterLedger(ledger, { component, status, severity } = {}) {
  const c = component?.toLowerCase();
  /** @param {string} name */
  const matchC = (name) => !c || name.toLowerCase().includes(c);
  const codes = status ? new Set(String(status).split(',')) : null;
  const sev = severity ? sevRank(severity) : null;
  const entries = ledger.entries.filter(
    (x) =>
      matchC(x.component) &&
      (!codes || x.issues.some((i) => codes.has(i.code)) || codes.has(x.status)) &&
      (sev == null || sevRank(x.severity) <= sev)
  );
  const names = new Set(entries.map((x) => x.component));
  return { components: ledger.components.filter((x) => names.has(x.component)), entries };
}

/**
 * One line, for check.mjs and the CLI: "integrity: No issues" / "integrity: 3 components with errors: …".
 * @param {Ledger} ledger
 */
export const oneLine = (ledger) =>
  `integrity: ${ledger.summary.headline}${ledger.setup.length ? ` · setup: ${ledger.setup.map((s) => s.code).join(', ')}` : ''}`;
