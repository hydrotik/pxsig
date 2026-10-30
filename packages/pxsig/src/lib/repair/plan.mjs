/** The repair plan (repair.mjs): which steps a ledger needs, for which entries, and why. */
import { SCHEMA_VERSION } from '../integrity.mjs';
/** @import { IntegrityCode, Ledger, LedgerEntry, ManualItem, PlanOptions, RepairAction, RepairPlan, RepairStep } from '../../types/t3.js' */

/** @type {RepairAction[]} */
export const ACTIONS = [
  'register',
  'recheck',
  'restore-baseline-image',
  'convert-legacy',
  'prune',
  'log-torn',
];
/**
 * What a repair re-checks: entries with no usable verdict or render.
 * @type {IntegrityCode[]}
 */
const RECHECK_CODES = ['never-checked', 'missing-render', 'render-error'];
/**
 * Stale verdicts are re-checked only where a later step needs a fresh render, or when asked.
 * @type {IntegrityCode[]}
 */
const NEEDS_FRESH_RENDER = ['missing-baseline-image', 'legacy-format'];

// --- plan -------------------------------------------------------------------------------------------------

/**
 * @param {Ledger} ledger
 * @param {IntegrityCode[]} codes
 */
const idsWith = (ledger, codes) =>
  ledger.entries.filter((x) => x.issues.some((i) => codes.includes(i.code)));

/**
 * The repair plan for a ledger: ordered steps, each with the entries it covers, why, and — when
 * it cannot run here — why it is blocked. `only` limits to some actions; `prune` adds the prune step.
 * @param {Ledger} ledger
 * @param {PlanOptions} [opts]
 * @returns {RepairPlan}
 */
export function planRepairs(ledger, { only, prune = false, server = null, stale = false } = {}) {
  // prune and log-torn change the store's own records: planned only when asked for by name.
  /** @param {RepairAction} a */
  const want = (a) =>
    (!only || only.includes(a)) &&
    (a !== 'prune' || prune) &&
    (a !== 'log-torn' || !!only?.includes('log-torn'));
  const sb = ledger.sources.storyIndex;
  /** @type {RepairStep[]} */
  const steps = [];
  const unregistered = idsWith(ledger, ['unregistered']);
  if (unregistered.length && want('register'))
    steps.push({
      action: 'register',
      ids: unregistered.map((x) => x.id),
      why: 'stories in the index with no manifest entry: add them (modes and states from parameters.pxsig) and render them in the re-check step; they arrive without a signature, as NEW, for a person to approve',
      blocked:
        sb.source === 'storybook'
          ? null
          : `needs a running, healthy Storybook to read parameters.pxsig (${sb.error ?? 'index not loaded'})`,
      // The entries register adds are rendered in this same run (the re-check step takes them).
      recheckAfter: want('recheck'),
    });
  // A stale verdict is a warning: re-checking hundreds of them is not a repair of the errors.
  // They are re-checked here only when a later step gates on a fresh render, or when asked.
  /** @param {LedgerEntry} x */
  const needsRender = (x) =>
    x.issues.some((i) => RECHECK_CODES.includes(i.code)) ||
    (x.issues.some((i) => i.code === 'stale') &&
      (stale || x.issues.some((i) => NEEDS_FRESH_RENDER.includes(i.code))));
  // An orphaned entry's story is gone: rendering it can only fail.
  const recheck = ledger.entries.filter(
    (x) => x.files && needsRender(x) && !x.issues.some((i) => i.code === 'orphaned')
  );
  if ((recheck.length || (unregistered.length && want('register'))) && want('recheck')) {
    /** @type {Record<string, number>} */
    const why = {};
    for (const x of recheck)
      for (const i of x.issues)
        if (RECHECK_CODES.includes(i.code) || i.code === 'stale')
          why[i.code] = (why[i.code] ?? 0) + 1;
    const reasons = Object.entries(why).map(([k, n]) => `${n} ${k}`);
    if (unregistered.length && want('register')) reasons.push('the entries the register step adds');
    steps.push({
      action: 'recheck',
      ids: recheck.map((x) => x.id),
      why: `re-render and re-check (${reasons.join(', ')}); never writes baselines`,
      blocked:
        server?.up || sb.source === 'storybook'
          ? null
          : `needs the pxsig server or a healthy Storybook (${sb.error ?? 'index not loaded'})`,
    });
  }
  const missing = idsWith(ledger, ['missing-baseline-image']);
  if (missing.length && want('restore-baseline-image'))
    steps.push({
      action: 'restore-baseline-image',
      ids: missing.map((x) => x.id),
      why: 'restore each missing baseline image from its latest render, only where that render passes the signature gate (fresh Rust check, no cache); otherwise leave it flagged and keep the signature reconstruction for display',
      blocked: null,
    });
  const legacy = idsWith(ledger, ['legacy-format']);
  if (legacy.length && want('convert-legacy'))
    steps.push({
      action: 'convert-legacy',
      ids: legacy.map((x) => x.id),
      why: 'convert each legacy .pxsig.json baseline to .psig with its latest render as the image, only where that render passes the signature gate; the record and signature bytes are packed unchanged and the old file moves to the store trash/',
      blocked: null,
    });
  const orphans = idsWith(ledger, ['orphaned']);
  if (orphans.length && want('prune'))
    steps.push({
      action: 'prune',
      ids: orphans.map((x) => x.id),
      why: 'move orphaned signatures / baseline images to the store trash//<timestamp>/ and drop manifest entries whose story is gone (nothing is deleted)',
      blocked: null,
      needsPerson: true,
    });
  const torn = ledger.setup?.find((x) => x.code === 'log-torn');
  if (torn && want('log-torn'))
    steps.push({
      action: 'log-torn',
      ids: [],
      count: torn.count,
      why: 'remove the approval-log lines a crash cut short (every complete line keeps its bytes); they are already left out of every reading',
      blocked: null,
      needsPerson: true,
    });
  /** @type {ManualItem[]} */
  const manual = [];
  if (torn && !want('log-torn'))
    manual.push({
      code: 'log-torn',
      count: torn.count,
      what: 'report only: `pxsig doctor --repair --only log-torn --apply` (a person at a terminal) removes them',
      sample: [],
    });
  for (const [code, what] of /** @type {[IntegrityCode, string][]} */ ([
    ['changed', 'review in the dashboard (A approves, R rejects)'],
    ...(stale
      ? []
      : [
          [
            'stale',
            're-check them: `pxsig check --since <ref>`, or `pxsig doctor --repair --stale`',
          ],
        ]),
    ['flaky', 're-check, then review if it keeps failing'],
    ['unbaselined', 'NEW: approve its first render in the dashboard'],
    ['a11y-new', 'fix the violation or accept it into the a11y baseline'],
  ])) {
    const xs = idsWith(ledger, [code]);
    if (xs.length)
      manual.push({ code, count: xs.length, what, sample: xs.slice(0, 5).map((x) => x.id) });
  }
  if (orphans.length && !prune)
    manual.push({
      code: 'orphaned',
      count: orphans.length,
      what: "report only: `pxsig doctor --repair --prune --apply` (a person at a terminal) moves them to the store's trash/",
      sample: orphans.slice(0, 5).map((x) => x.id),
    });
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    basedOn: ledger.generatedAt,
    steps,
    manual,
  };
}
