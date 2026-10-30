/**
 * tools/read.mjs — the read tools: pxsig_projects, pxsig_status, pxsig_list, pxsig_entry.
 */
import { join } from 'node:path';
import { findWorkspace } from '../lib/workspace.mjs';
import { relPath } from '../lib/paths.mjs';
import {
  brief,
  componentOf,
  ctxOf,
  ID_RE,
  load,
  MAX_IMAGE_BYTES,
  PROBLEMS,
  PROJECT,
  readJson,
  server,
  stateOf,
  text,
} from './context.mjs';
import { affected, editedSince, imageOf, renderedAt, verdictTimes } from './staleness.mjs';
import { warnMode } from './doctor.mjs';

/** @import { EntryArgs, ListArgs, McpContent, ProjectArg } from '../types/t6.js' */

// A const array: each tool keeps its literal name, so types/t6.d.ts can name a tool's result.
export const readTools = /** @type {const} */ ([
  {
    name: 'pxsig_projects',
    description:
      'The projects (packages under test) in this workspace: name, folder, Storybook URL, entry count and integrity headline. Every other tool takes one of these names as `project`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const ws = findWorkspace({});
      return {
        workspace: ws.root,
        projects: ws.projects.map((ref) => {
          try {
            const C = ctxOf(ref.name);
            const m = /** @type {{ stories?: unknown[] }} */ (
              readJson(C.P.manifestPath(), { stories: [] })
            );
            // the ledger pxsig doctor wrote (docs/integrity.md)
            const led = /** @type {{ summary?: { headline?: string } } | null} */ (
              readJson(join(C.P.store.reports, 'integrity.json'), null)
            );
            return {
              name: ref.name,
              root: relPath(ws.root, ref.dir) || '.',
              storybook: C.P.storybook.url,
              entries: m.stories?.length ?? 0,
              integrity: led?.summary?.headline ?? null,
            };
          } catch (e) {
            return { name: ref.name, error: /** @type {Error} */ (e).message };
          }
        }),
      };
    },
  },
  {
    name: 'pxsig_status',
    description:
      "Overview of the visual-regression state: when the report was last written, counts per state (pass, drift, changed, error, flaky, approved, rejected), accessibility totals, the components with the most changed entries, whether the pxsig server is up or busy, design-system files edited since the report (entries the report does not cover yet), the render environment (how many entries' baselines came from a different one), and warn mode (`enforcement`: each gate's setting from the committed config; no tool can change it). Start here.",
    inputSchema: { type: 'object', properties: { project: PROJECT }, additionalProperties: false },
    /** @param {ProjectArg} [args] */
    async run({ project } = {}) {
      const C = ctxOf(project);
      const { check, review, updated } = load(C);
      /** @type {Record<string, number>} */
      const counts = {};
      /** @type {Record<string, number>} */
      const byComponent = {};
      let a11yViolations = 0;
      let a11yNew = 0;
      for (const r of check.rows) {
        const st = stateOf(r, review);
        counts[st] = (counts[st] ?? 0) + 1;
        if (PROBLEMS.has(st))
          byComponent[componentOf(r.id)] = (byComponent[componentOf(r.id)] ?? 0) + 1;
        a11yViolations += r.a11y?.violations?.length ?? 0;
        a11yNew += r.a11y?.new ?? 0;
      }
      const edited = editedSince(C, updated);
      /** @type {{ editedFiles: string[], moreFiles?: number, affectedEntries?: number, hint?: string, error?: string } | null} */
      let stale = null;
      if (edited.length) {
        try {
          const a = affected(C, { files: edited });
          stale = {
            editedFiles: edited.slice(0, 40),
            moreFiles: Math.max(0, edited.length - 40),
            affectedEntries: (a.traced ?? a.ids).length,
            hint: 'pxsig_check { changed_files } re-checks just these',
          };
        } catch (e) {
          stale = { editedFiles: edited.slice(0, 40), error: /** @type {Error} */ (e).message };
        }
      }
      return {
        project: C.P.name,
        reportUpdated: updated.toISOString(),
        fullCheckAt: check.generatedAt,
        entries: check.rows.length,
        modes: check.summary?.modes,
        counts,
        problems: [...PROBLEMS].reduce((n, s) => n + (counts[s] ?? 0), 0),
        a11y: { violations: a11yViolations, new: a11yNew },
        mostChanged: Object.entries(byComponent)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([component, n]) => ({ component, n })),
        server: await server(C),
        stale,
        approvals: { level: C.P.config?.approvals?.level ?? 'standard' },
        // The environment of the last renders, and how many entries' baselines came from another one.
        env: {
          // filter(Boolean) keeps the env ids
          current: [
            ...new Set(/** @type {string[]} */ (check.rows.map((r) => r.env).filter(Boolean))),
          ].map((id) => check.envs?.[id] ?? { id }),
          mismatched: check.summary?.envMismatch ?? 0,
        },
        ...warnMode(C),
      };
    },
  },
  {
    name: 'pxsig_list',
    description:
      'List entries (story × mode × interaction state) by state, with their metrics and the gate reasons. `state` defaults to "problems" (changed, error, flaky, rejected). Filter by component name substring (e.g. "hovercard") and mode (dark, light, …).',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        state: {
          type: 'string',
          enum: [
            'problems',
            'changed',
            'new',
            'error',
            'flaky',
            'rejected',
            'approved',
            'drift',
            'pass',
            'skipped',
            'a11y',
            'all',
          ],
          default: 'problems',
        },
        component: {
          type: 'string',
          description: 'Substring of the entry id, e.g. "toast" or "components-datagrid".',
        },
        mode: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
      additionalProperties: false,
    },
    /** @param {ListArgs} args */
    async run({ project, state = 'problems', component, mode, limit = 50 }) {
      const { check, review } = load(ctxOf(project));
      const rows = check.rows.filter((r) => {
        const st = stateOf(r, review);
        if (state === 'problems' && !PROBLEMS.has(st)) return false;
        if (state === 'a11y' && !r.a11y?.violations?.length) return false;
        if (!['problems', 'a11y', 'all'].includes(state) && st !== state) return false;
        if (component && !r.id.includes(component.toLowerCase())) return false;
        if (mode && r.mode !== mode) return false;
        return true;
      });
      return {
        total: rows.length,
        shown: Math.min(rows.length, limit),
        entries: rows.slice(0, limit).map((r) => brief(r, review)),
      };
    },
  },
  {
    name: 'pxsig_entry',
    description:
      "One entry in full: the gate's metrics and reasons, the changed pixel regions, accessibility violations, the review decision, the render environment against its baseline's (envMatch: same, compatible, mismatch or unknown) — and the images, inline: the baseline render, the latest render and the diff heat map. Use it to see what actually changed.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        id: {
          type: 'string',
          description: 'Entry id, e.g. "components-toast--default__shown@light".',
        },
        images: {
          type: 'array',
          items: { type: 'string', enum: ['baseline', 'current', 'diff'] },
          default: ['baseline', 'current', 'diff'],
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    /** @param {EntryArgs} args */
    async run({ project, id, images = ['baseline', 'current', 'diff'] }) {
      if (!ID_RE.test(id)) throw new Error(`bad id: ${id}`);
      const C = ctxOf(project);
      const { check, review } = load(C);
      const row = check.rows.find((r) => r.id === id);
      if (!row) {
        const near = check.rows
          .filter((r) => r.id.startsWith(id.split('--')[0]))
          .slice(0, 10)
          .map((r) => r.id);
        throw new Error(
          `no entry ${id}${near.length ? `; entries of that component: ${near.join(', ')}` : ''}`
        );
      }
      /** @type {McpContent[]} */
      const content = [
        text({
          ...brief(row, review),
          story: row.story,
          browser: row.browser,
          metrics: row.metrics,
          detail: row.detail,
          pixels: row.pixels,
          a11y: row.a11y,
          review: review[id] ?? null,
          // lib/env.mjs: the render's environment id, its baseline's, and how they compare.
          env: row.env ?? null,
          baselineEnv: row.baselineEnv ?? null,
          envMatch: row.envMatch ?? 'unknown',
          envDiff: row.envDiff ?? null,
          ...(row.envFonts ? { envFonts: row.envFonts } : {}),
          checkedAt: verdictTimes(C, check).get(id)?.at.toISOString() ?? null,
          renderedAt: renderedAt(C, id)?.toISOString() ?? null,
          diffPage: relPath(C.root, join(C.P.store.diffLatest, `${id}.diff.html`)),
        }),
      ];
      for (const kind of images) {
        const { bytes, where } = imageOf(C, kind, id);
        if (!bytes) {
          content.push(text(`${kind}: none (${where})`));
          continue;
        }
        if (bytes.length > MAX_IMAGE_BYTES) {
          content.push(
            text(`${kind}: ${(bytes.length / 1e6).toFixed(1)} MB, too large to inline — ${where}`)
          );
          continue;
        }
        content.push(text(`${kind} (${where}):`));
        content.push({
          type: 'image',
          mimeType: 'image/png',
          data: Buffer.from(bytes).toString('base64'),
        });
      }
      return { content };
    },
  },
]);
