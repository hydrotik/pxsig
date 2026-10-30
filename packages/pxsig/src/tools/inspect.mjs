/**
 * tools/inspect.mjs — pxsig_a11y, pxsig_affected and pxsig_stale.
 */
import { ctxOf, load, PROJECT } from './context.mjs';
import { affected, prunePlan, staleness } from './staleness.mjs';

/** @import { A11yResult, A11yViolation } from '../types.js' */
/** @import { A11yArgs, AffectedArgs, ReportRow, StaleArgs } from '../types/t6.js' */

// A const array: each tool keeps its literal name, so types/t6.d.ts can name a tool's result.
export const inspectTools = /** @type {const} */ ([
  {
    name: 'pxsig_a11y',
    description:
      "Accessibility (axe) violations per entry: all of them, or only those not in the entry's accepted list (`only_new`). Filter by component substring. Each entry carries its accessibility decision (accepted / rejected) when one was made since its last check. `prune_plan: true` instead lists every accepted rule as prunable (a fresh check shows it no longer fires), still-fires, stale or not-covered, read-only: what `pxsig a11y --prune --dry-run` prints. Removing accepted rules needs a person at a terminal (`pxsig a11y --prune`); no tool does it.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        only_new: { type: 'boolean', default: false },
        component: { type: 'string' },
        limit: { type: 'number', default: 50 },
        prune_plan: {
          type: 'boolean',
          default: false,
          description: 'List accepted rules by whether they could be pruned (read-only).',
        },
        mode: { type: 'string', description: 'With prune_plan: one mode only.' },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'With prune_plan: these entries only.',
        },
      },
      additionalProperties: false,
    },
    /** @param {A11yArgs} args */
    async run({ project, only_new = false, component, limit = 50, prune_plan = false, mode, ids }) {
      if (prune_plan) {
        const plan = await prunePlan({ project, component, mode, only: ids });
        return {
          counts: plan.counts,
          entries: plan.entries,
          prunable: plan.prune.slice(0, limit),
          more: Math.max(0, plan.prune.length - limit),
          notPrunable: plan.items.filter((i) => i.class !== 'prunable').slice(0, limit),
          cover: plan.cover,
          reports: plan.reports,
          hint: plan.prune.length
            ? 'a person removes these with `pxsig a11y --prune` in a terminal'
            : 'nothing to prune',
        };
      }
      const { check, a11yReview } = load(ctxOf(project));
      /** @type {Record<string, number>} */
      const byRule = {};
      // Every row kept has violations: a row with new ones has them (new counts those not on the
      // accepted list).
      const rows =
        /** @type {(ReportRow & { a11y: A11yResult & { violations: A11yViolation[] } })[]} */ (
          check.rows.filter(
            (r) =>
              (only_new ? r.a11y?.new : r.a11y?.violations?.length) &&
              (!component || r.id.includes(component.toLowerCase()))
          )
        );
      for (const r of rows)
        for (const v of r.a11y.violations) byRule[v.id ?? v] = (byRule[v.id ?? v] ?? 0) + 1;
      return {
        entries: rows.length,
        byRule,
        list: rows.slice(0, limit).map((r) => ({
          id: r.id,
          new: r.a11y.new,
          violations: r.a11y.violations,
          decision: a11yReview[r.id]?.state ?? null,
        })),
      };
    },
  },
  {
    name: 'pxsig_affected',
    description:
      'Which entries a set of edited files can change, given file paths relative to the workspace root, or a git ref to diff against. A path the import graph and the store records cannot trace selects every entry, and failSafe says which; unresolved lists imports that add entries to every run.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        files: { type: 'array', items: { type: 'string' } },
        since: { type: 'string', description: 'git ref, e.g. "main" or a commit' },
      },
      additionalProperties: false,
    },
    /** @param {AffectedArgs} args */
    async run({ project, files, since }) {
      if (!files?.length && !since) throw new Error('give files or since');
      const a = affected(ctxOf(project), { files, since });
      return {
        changedFiles: a.changed,
        reason: a.reason,
        entries: a.ids.length,
        ids: a.ids.slice(0, 200),
        all: a.all,
        failSafe: (a.failSafe ?? []).slice(0, 20),
        ignored: (a.ignored ?? []).slice(0, 50),
        baselines: a.baselines ?? [],
        records: a.records ?? {},
        otherSuites: a.otherSuites ?? {},
        warnings: a.warnings ?? [],
        unresolved: (a.unresolved ?? [])
          .filter((u) => !u.accepted && u.selects !== 'none')
          .slice(0, 20),
        remote: (a.remote ?? []).length,
      };
    },
  },
  {
    name: 'pxsig_stale',
    description:
      "Results that cannot be trusted as current. (1) stale: the verdict is older than an edit to a file that can change that entry (the project's sources and the folders it depends on; Rust import graph). (2) inconsistent: the row's recorded pixel size differs from the render on disk, so the verdict was made on a different image. The report file's own timestamp hides both: re-checks rewrite it while other rows keep old results. Re-check what this returns with pxsig_check { ids } before trusting the report.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        limit: { type: 'number', default: 200 },
        max_files: { type: 'number', default: 400 },
      },
      additionalProperties: false,
    },
    /** @param {StaleArgs} args */
    async run({ project, limit = 200, max_files = 400 }) {
      const C = ctxOf(project);
      const { check } = load(C);
      const st = staleness(C, check, { maxFiles: max_files });
      if (st.tooMany)
        return {
          tooMany: st.tooMany,
          oldestVerdict: st.oldest,
          verdictTimes: st.sources,
          inconsistent: st.inconsistent.length,
          hint: 'too many edits since the oldest verdict to trace one by one: run pxsig_check { all: true }',
        };
      const { stale, inconsistent, sources, filesTraced } = st;
      const oldest = st.oldest;
      /** @type {Record<string, number>} */
      const byFile = {};
      for (const x of stale) byFile[x.editedAfter] = (byFile[x.editedAfter] ?? 0) + 1;
      const ids = [...new Set([...stale.map((x) => x.id), ...inconsistent.map((x) => x.id)])];
      return {
        stale: stale.length,
        inconsistent: inconsistent.length,
        of: check.rows.length,
        oldestVerdict: oldest,
        verdictTimes: sources,
        filesTraced,
        byFile,
        inconsistentSample: inconsistent.slice(0, 10),
        ids: ids.slice(0, limit),
        hint: ids.length
          ? 'pxsig_check { ids } re-renders exactly these'
          : 'every result is newer than the edits that can change it',
      };
    },
  },
]);
