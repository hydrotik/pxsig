/**
 * tools/react.mjs — pxsig_react: the React Compiler's alerts for the changed files (alert mode:
 * nothing here fails a check, accepts, approves or silences anything), and what pxsig_check adds
 * when it compares with a ref.
 */
import { join } from 'node:path';
import { relPath } from '../lib/paths.mjs';
import { analyse } from '../lib/react/index.mjs';
import { ctxOf, PROJECT, readJson } from './context.mjs';

/** @import { CheckReact, ReactReport, ReactReportFunction, ReactRun, ReactToolArgs, ReactToolFunction, ReactToolResult } from '../types/react.js' */
/** @import { ProjectContext } from './context.mjs' */

/**
 * One function of react.json, reduced: what changed, the outcome on each side, the rules and lines.
 * @param {ReactReportFunction} f
 * @returns {ReactToolFunction}
 */
const fnBrief = (f) => ({
  id: f.id,
  change: f.change,
  alert: f.alert,
  now: f.head?.outcome ?? null,
  before: f.base?.outcome ?? null,
  // A diagnostic with no rule is named by its category (lib/react).
  rules: (f.head?.diagnostics ?? []).map((d) => ({
    rule: d.rule || d.category,
    line: d.line,
    stops: d.stops,
  })),
});

/**
 * react.json for an agent: the summary, every alert (the engine's sentence), the functions (alerts
 * first, up to `limit`) and the base the comparison used.
 * @param {ReactReport} r
 * @param {number} limit
 */
function reduce(r, limit) {
  const fns = [...r.functions].sort((a, b) => Number(b.alert) - Number(a.alert));
  return {
    at: r.generatedAt,
    base: r.base,
    backend: { compiler: r.backend.compiler, babel: r.backend.babel },
    summary: r.summary,
    alerts: r.alerts.map((a) => ({ id: a.id, change: a.change, level: a.level, text: a.text })),
    functions: fns.slice(0, limit).map(fnBrief),
    more: Math.max(0, fns.length - limit),
  };
}

/**
 * pxsig_check's `react` when the call compared with a ref or named changed files: the analysis
 * run beside the check (read-only while the server holds the store), else null.
 * @param {ProjectContext} C
 * @param {{ since?: string, changed_files?: string[] }} sel
 * @returns {Promise<CheckReact | null>}
 */
export async function checkReact(C, { since, changed_files }) {
  if (!since && !changed_files?.length) return null;
  /** @type {ReactRun} */
  const run = await analyse(C.P, {
    ...(changed_files?.length
      ? { files: changed_files.map((f) => relPath(C.root, join(C.root, f))) }
      : { since }),
    workers: 2,
  }).catch((/** @type {Error} */ e) => ({
    ran: /** @type {const} */ (false),
    why: /** @type {const} */ ('failed'),
    text: `react: analysis failed (${e.message}): nothing compared`,
  }));
  if (!run.ran) return { skipped: run.why };
  const { summary, alerts, base, backend } = run.report;
  return { summary, alerts, base, backend };
}

// A const array: each tool keeps its literal name, so types/t6.d.ts can name a tool's result.
export const reactTools = /** @type {const} */ ([
  {
    name: 'pxsig_react',
    description:
      "The React Compiler's verdict on the changed component and hook files, compared with the merge base: functions it compiled before and skips now, new functions it skips, a new reason for one it skipped, and new Rules-of-React findings (`alerts`, each with the engine's sentence), plus every function analysed (alerts first). Alerts only: nothing here fails a check, and nothing accepts, approves or silences an alert. Reads the last `reports/react.json`; `run: true` runs the analysis first, like `pxsig react --since <since>` (no browser; when the pxsig server holds the store, the results are not saved and `heldBy` names it).",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        run: { type: 'boolean', default: false, description: 'Run the analysis first.' },
        since: {
          type: 'string',
          default: 'main',
          description: 'With run: the git ref to compare with.',
        },
        limit: { type: 'number', default: 100, description: 'Functions listed at most.' },
      },
      additionalProperties: false,
    },
    /**
     * @param {ReactToolArgs} args
     * @returns {Promise<ReactToolResult>}
     */
    async run({ project, run = false, since = 'main', limit = 100 }) {
      const C = ctxOf(project);
      if (run) {
        const r = await analyse(C.P, { since });
        if (!r.ran) return { ran: false, why: r.why, text: r.text };
        return {
          ran: true,
          ...reduce(r.report, limit),
          ...(r.heldBy ? { heldBy: r.heldBy } : {}),
        };
      }
      const path = join(C.P.store.reports, 'react.json');
      const report = /** @type {ReactReport | null} */ (readJson(path, null));
      if (!report)
        return {
          ran: false,
          why: 'none',
          text: `no ${relPath(C.root, path)} yet: pxsig_react with run: true, or pxsig check --since <ref>, writes one`,
        };
      return { ran: true, ...reduce(report, limit) };
    },
  },
]);
