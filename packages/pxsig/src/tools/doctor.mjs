/**
 * tools/doctor.mjs — the doctor (reconcile, write the ledger, plan or apply the safe repairs),
 * shared by `pxsig_doctor` and `pxsig doctor`; a re-check's summary; warn mode for pxsig_status.
 */
import { dirname } from 'node:path';
import {
  CODES,
  filterLedger,
  ledgerPath,
  reconcile,
  resolveContext,
  writeLedger,
} from '../lib/integrity.mjs';
import { tokenFile } from '../lib/guard.mjs';
import { readSettings } from '../lib/machine.mjs';
import { detectAgent } from '../lib/agents.mjs';
import { applyRepairs, defaultHooks, planRepairs, serverStatus } from '../lib/repair.mjs';
import { relPath } from '../lib/paths.mjs';
import {
  checkFindings,
  outcome,
  readinessTally,
  resolveEnforcement,
  speaks,
} from '../lib/enforcement.mjs';
import { brief, ctxOf, load, PROBLEMS, stateOf } from './context.mjs';
import { preflight } from './preflight.mjs';

/** @import { CheckToolResult, DoctorOptions } from '../types/t6.js' */
/** @import { ProjectContext } from './context.mjs' */

/** @typedef {ReturnType<typeof filterLedger>['components'][number]} ViewComponent */
/** @typedef {ReturnType<typeof filterLedger>['entries'][number]} ViewEntry */

/**
 * The doctor: reconcile, write the ledger, and (optionally) plan or apply the safe repairs.
 * Shared by `pxsig_doctor` and `pxsig doctor`; the CLI adds the TTY-only prune itself.
 * @param {DoctorOptions} [opts]
 */
async function doctor({
  project,
  component,
  status,
  limit = 40,
  repair = 'none',
  only,
  offline = false,
  via = 'mcp',
  confirmPrune = null,
  confirmTorn = null,
  prune = false,
  stale = false,
} = {}) {
  const C = ctxOf(project);
  const ctx = resolveContext(C.P);
  const serverUrl = C.serverUrl;
  /** @type {Awaited<ReturnType<typeof reconcile>>} */
  let ledger;
  try {
    ledger = await reconcile(ctx, { offline });
  } catch (e) {
    // Before a manifest exists: the setup preflight rides on the error (CLI and MCP print it).
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'no-manifest')
      Object.assign(/** @type {Error} */ (e), {
        detail: { preflight: await preflight(C), next: 'pxsig manifest' },
      });
    throw e;
  }
  writeLedger(ctx, ledger);
  const settings = readSettings();
  /** @type {{ project: string, ledgerPath: string, machine: { settings: string, setUp: boolean, tokens: string }, agent: ReturnType<typeof detectAgent>, plan?: ReturnType<typeof planRepairs>, applied?: Awaited<ReturnType<typeof applyRepairs>>['steps'] }} */
  const out = {
    project: C.P.name,
    ledgerPath: relPath(C.root, ledgerPath(ctx)),
    machine: {
      settings: settings.path,
      setUp: settings.exists,
      tokens: dirname(tokenFile(C.P.workspaceRoot, serverUrl ?? 'http://127.0.0.1:6070')),
    },
    agent: detectAgent(),
  };
  if (repair !== 'none') {
    const server = await serverStatus(serverUrl, C.root);
    const plan = planRepairs(ledger, { only, prune: prune && !!confirmPrune, server, stale });
    out.plan = plan;
    if (repair === 'apply') {
      const hooks = {
        ...defaultHooks(ctx, { serverUrl, root: C.root }),
        confirmPrune,
        confirmTorn,
      };
      const res = await applyRepairs(ctx, plan, { hooks, via, reconcileOpts: { offline } });
      ledger = res.ledger;
      writeLedger(ctx, ledger);
      out.applied = res.steps;
    }
  }
  const view = filterLedger(ledger, { component, status });
  /** @type {Record<string, number>} */
  const sev = { error: 0, warn: 1, info: 2 };
  const focus = component || status;
  const comps = view.components
    .filter((/** @type {ViewComponent} */ c) => focus || c.severity !== 'info')
    .sort(
      (/** @type {ViewComponent} */ a, /** @type {ViewComponent} */ b) =>
        sev[a.severity] - sev[b.severity] || (a.component < b.component ? -1 : 1)
    );
  const ents = view.entries
    .filter((/** @type {ViewEntry} */ x) => focus || x.severity !== 'info')
    .sort(
      (/** @type {ViewEntry} */ a, /** @type {ViewEntry} */ b) =>
        sev[a.severity] - sev[b.severity] ||
        // every status is one of CODES (lib/integrity.mjs)
        /** @type {Record<string, { rank: number }>} */ (CODES)[a.status].rank -
          /** @type {Record<string, { rank: number }>} */ (CODES)[b.status].rank
    );
  return {
    schemaVersion: ledger.schemaVersion,
    generatedAt: ledger.generatedAt,
    summary: ledger.summary,
    setup: ledger.setup,
    sources: ledger.sources,
    components: {
      total: comps.length,
      shown: Math.min(comps.length, limit),
      list: comps.slice(0, limit),
    },
    entries: {
      total: ents.length,
      shown: Math.min(ents.length, limit),
      list: ents.slice(0, limit).map((/** @type {ViewEntry} */ x) => ({
        id: x.id,
        component: x.component,
        status: x.status,
        severity: x.severity,
        issues: x.issues.map(
          (/** @type {ViewEntry['issues'][number]} */ { code, severity, reason }) => ({
            code,
            severity,
            reason,
          })
        ),
      })),
    },
    ...out,
  };
}

/**
 * The states and problems of the rows `ids` names, after a re-check.
 * @param {ProjectContext} C
 * @param {Set<string>} ids
 * @param {string} via
 * @param {number} t0
 * @returns {CheckToolResult}
 */
function summarizeIds(C, ids, via, t0) {
  const { check, review } = load(C);
  const rows = check.rows.filter((r) => ids.has(r.id));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of rows) counts[stateOf(r, review)] = (counts[stateOf(r, review)] ?? 0) + 1;
  // Warn mode: the gates as the committed config sets them (no tool can lower one), and whether
  // these rows would fail a run. Only when warn mode applies (configured, or the quiet a11y gate fired).
  /** @type {{ enforcement?: Record<string, unknown>, wouldFail?: boolean }} */
  let warn = {};
  try {
    const enf = resolveEnforcement(C.P, {
      flags: {},
    });
    const out = outcome(enf, checkFindings(rows));
    if (speaks(enf, out))
      warn = {
        enforcement: {
          gates: enf.gates,
          warned: enf.configured,
          wouldExit: out.wouldExit,
          exit: out.exit,
          reasons: out.reasons,
        },
        wouldFail: out.wouldFail,
      };
  } catch (e) {
    warn = { enforcement: { error: /** @type {Error} */ (e).message } };
  }
  const a11yNew = rows.filter((r) => (r.a11y?.new ?? 0) > 0).length;
  return {
    via,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    checked: rows.length,
    counts,
    problems: rows
      .filter((r) => PROBLEMS.has(stateOf(r, review)))
      .map((r) => brief(r, review))
      .slice(0, 60),
    ...(a11yNew ? { a11yNew } : {}),
    ...warn,
  };
}

/**
 * `pxsig_status.enforcement`, when the config sets warn mode: each gate, warnUntil, the readiness tally.
 * @param {ProjectContext} C
 * @returns {{ enforcement?: { gates?: ReturnType<typeof resolveEnforcement>['gates'], warned?: string[], warnUntil?: string | null, daysLeft?: number | null, readiness?: ReturnType<typeof readinessTally>, error?: string } }}
 */
function warnMode(C) {
  if (C.P.config?.enforcement == null) return {};
  try {
    const enf = resolveEnforcement(C.P, {
      flags: {},
    });
    return {
      enforcement: {
        gates: enf.gates,
        warned: enf.configured,
        warnUntil: enf.warnUntil,
        ...(enf.ending ? { daysLeft: enf.daysLeft } : {}),
        readiness: enf.configured.length ? readinessTally(C.P) : null,
      },
    };
  } catch (e) {
    return { enforcement: { error: /** @type {Error} */ (e).message } };
  }
}

export { doctor, summarizeIds, warnMode };
