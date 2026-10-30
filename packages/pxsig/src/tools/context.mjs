/**
 * tools/context.mjs — what every pxsig tool shares: the project context of a call, the reports it
 * reads, an entry's state and brief, the pxsig server over HTTP, and the MCP text content item.
 * Used by the tool groups beside it, the MCP server (mcp.mjs) and the CLI.
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProject } from '../lib/workspace.mjs';
import { relPath } from '../lib/paths.mjs';
import { readJson } from '../lib/files.mjs';

/** @import { BriefEntry, CheckReport, McpContent, ReportRow, ReviewFile, ServerStatusReply } from '../types/t6.js' */

// The pxsig source folder (src/): check.mjs is run from it.
const here = fileURLToPath(new URL('..', import.meta.url));

/**
 * One project's paths, for a tool call. Throws (with the project names) when the workspace has
 * several projects and none was named.
 * @param {string | null} [project]
 */
function ctxOf(project) {
  const P = openProject({ project: project ?? null });
  const reports = P.store.reports;
  return {
    P,
    root: P.workspaceRoot,
    checkPath: join(reports, 'check.json'),
    reviewPath: join(reports, 'review.json'),
    historyPath: join(reports, 'history.ndjson'),
    rustBin: P.rustBin,
    serverUrl: P.serverUrl(),
  };
}
/** What `ctxOf` returns: a project and the paths the tools read. */
/** @typedef {ReturnType<typeof ctxOf>} ProjectContext */
const PROJECT = {
  type: 'string',
  description:
    'Project name (pxsig_projects lists them). Optional when the workspace has one project.',
};
// MCP results larger than this lose the image and keep its path.
const MAX_IMAGE_BYTES = 1_500_000;

// --- state ------------------------------------------------------------------------------------

/**
 * One entry's state, as the dashboard and the Storybook addon compute it: a review decision wins.
 * @param {ReportRow} row
 * @param {ReviewFile} review
 * @returns {string}
 */
function stateOf(row, review) {
  const rv = review[row.id]?.state;
  if (rv) return rv;
  if (row.skipped) return 'skipped';
  if (row.new) return 'new';
  if (row.error) return 'error';
  if (row.flaky) return 'flaky';
  if (!row.pass) return 'changed';
  return row.metrics && row.metrics.ssim < 1 ? 'drift' : 'pass';
}
const PROBLEMS = new Set(['changed', 'new', 'error', 'flaky', 'rejected']);

/** @param {ProjectContext} C */
function load(C) {
  const check = /** @type {CheckReport | null} */ (readJson(C.checkPath, null));
  if (!check)
    throw new Error(
      `no report at ${relPath(C.root, C.checkPath)}: run a check first (pxsig check, or the pxsig_check tool)`
    );
  const review = /** @type {ReviewFile} */ (readJson(C.reviewPath, {}));
  const a11yReview = /** @type {ReviewFile} */ (
    readJson(join(dirname(C.reviewPath), 'a11y-review.json'), {})
  );
  const updated = statSync(C.checkPath).mtime;
  return { check, review, a11yReview, updated };
}

/**
 * Component name of an entry id: the story title's last segment (`components-hovercard--x` → `hovercard`).
 * @param {string} id
 */
const componentOf = (id) => id.split('--')[0].split('-').slice(-1)[0];

/**
 * @param {ReportRow} row
 * @param {ReviewFile} review
 * @returns {BriefEntry}
 */
function brief(row, review) {
  return {
    id: row.id,
    state: stateOf(row, review),
    mode: row.mode,
    ...(row.state ? { interaction: row.state } : {}),
    ...(row.metrics
      ? { ssim: row.metrics.ssim, changedCellsPct: row.metrics.changedCellsPct }
      : {}),
    ...(row.pixels ? { changedPx: row.pixels.changed, regions: row.pixels.regionCount } : {}),
    ...(row.reasons?.length ? { reasons: row.reasons } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    ...(row.a11y?.new ? { a11yNew: row.a11y.new } : {}),
  };
}

// --- the server (serve.mjs), when it is up ------------------------------------------------------

/**
 * A request to the pxsig server; resolves with its JSON answer.
 * @template [T=Record<string, unknown>] The answer's shape for this route (docs/server.md).
 * @param {{ serverUrl: string }} C
 * @param {string} path
 * @param {{ method?: string, body?: Record<string, unknown>, headers?: Record<string, string>, timeout?: number }} [opts]
 * @returns {Promise<T>}
 */
async function http(C, path, { method = 'GET', body, headers, timeout = 2000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${C.serverUrl}${path}`, {
      method,
      signal: ctl.signal,
      headers:
        body || headers
          ? { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }
          : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    // The pxsig server answers JSON; an error answer carries `error`.
    const json = /** @type {T & { error?: string }} */ (await res.json().catch(() => ({})));
    if (!res.ok) throw new Error(json.error ?? `${method} ${path}: HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}
/** @param {ProjectContext} C */
async function server(C) {
  try {
    /** @type {ServerStatusReply} */
    const s = await http(C, '/__pxsig/status', { timeout: 1500 });
    return { up: true, running: s.running, queued: s.queued, dashboard: s.dashboard };
  } catch {
    return { up: false, url: C.serverUrl, hint: 'start it with: pxsig serve --watch' };
  }
}

const ID_RE = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;
/**
 * A text content item: a string as is, anything else as indented JSON.
 * @param {unknown} v
 * @returns {McpContent}
 */
const text = (v) => ({
  type: 'text',
  text: typeof v === 'string' ? v : JSON.stringify(v, null, 2),
});

export {
  brief,
  componentOf,
  ctxOf,
  here,
  http,
  ID_RE,
  load,
  MAX_IMAGE_BYTES,
  PROBLEMS,
  PROJECT,
  readJson,
  server,
  stateOf,
  text,
};
