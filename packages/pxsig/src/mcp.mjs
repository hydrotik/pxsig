#!/usr/bin/env node
/**
 * mcp.mjs — pxsig as an MCP server: the visual-regression status, one story's
 * diff images, and the check / review actions, for an agent.
 *
 *   pxsig mcp                       # stdio; register it with your MCP client, from the repo root
 *   claude mcp add pxsig -- npx pxsig mcp
 *
 * Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0), written
 * without dependencies so it ships inside the pxsig package as-is.
 *
 * Projects: the server works on the workspace it starts in (or PXSIG_WORKSPACE). Every tool takes
 * an optional `project`; with several projects it is required (`pxsig_projects` lists them).
 *
 * Sources of truth, in order:
 * - the project's <store>/reports/check.json + review.json + history.ndjson: every
 *   producer (check, the server) writes them, so reads never need a server.
 * - the pxsig server when it is up (its address from node_modules/.cache/pxsig/server.json):
 *   whether a check is running, and the actions that need its warm browser pool
 *   and Rust engine (re-check, reject). Approving is never the MCP's: the server refuses it.
 * - Without the server, `pxsig_check` runs check.mjs itself (slower: a cold
 *   browser) and review actions are refused.
 *
 * Approving writes a baseline, which is the owner's decision: `pxsig_review`
 * refuses unless `confirm: true`, and its description tells the model to pass
 * that only when the user asked for these exact entries.
 */
import { spawn, spawnSync } from './lib/spawn.mjs';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CODES, filterLedger, ledgerPath, reconcile, resolveContext, writeLedger } from './lib/integrity.mjs';
import { AGENT_DECISIONS, NEEDS_PERSON, readToken, TOKEN_HEADER, tokenFile } from './lib/guard.mjs';
import { readSettings } from './lib/machine.mjs';
import { detectAgent } from './lib/agents.mjs';
import { helpData, helpNames, lookup, nearestNames } from './help.mjs';
import { readImage } from './lib/psig.mjs';
import { applyRepairs, defaultHooks, planRepairs, serverStatus } from './lib/repair.mjs';
import { acquireLock, describeLock, readLock } from './lib/lock.mjs';
import { findWorkspace, openProject, writeRunManifest } from './lib/workspace.mjs';
import { relPath } from './lib/paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * One project's paths, for a tool call. Throws (with the project names) when the workspace has
 * several projects and none was named.
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
const PROJECT = { type: 'string', description: 'Project name (pxsig_projects lists them). Optional when the workspace has one project.' };
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// MCP results larger than this lose the image and keep its path.
const MAX_IMAGE_BYTES = 1_500_000;

const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const log = (...a) => process.stderr.write(`[pxsig-mcp] ${a.join(' ')}\n`);

// --- state ------------------------------------------------------------------------------------

/** One entry's state, as the dashboard and the Storybook addon compute it: a review decision wins. */
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

function load(C) {
  const check = readJson(C.checkPath, null);
  if (!check) throw new Error(`no report at ${relPath(C.root, C.checkPath)}: run pxsig_check first`);
  const review = readJson(C.reviewPath, {});
  const a11yReview = readJson(join(dirname(C.reviewPath), 'a11y-review.json'), {});
  const updated = statSync(C.checkPath).mtime;
  return { check, review, a11yReview, updated };
}

/** Component name of an entry id: the story title's last segment (`components-hovercard--x` → `hovercard`). */
const componentOf = (id) => id.split('--')[0].split('-').slice(-1)[0];

function brief(row, review) {
  return {
    id: row.id,
    state: stateOf(row, review),
    mode: row.mode,
    ...(row.state ? { interaction: row.state } : {}),
    ...(row.metrics ? { ssim: row.metrics.ssim, changedCellsPct: row.metrics.changedCellsPct } : {}),
    ...(row.pixels ? { changedPx: row.pixels.changed, regions: row.pixels.regionCount } : {}),
    ...(row.reasons?.length ? { reasons: row.reasons } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    ...(row.a11y?.new ? { a11yNew: row.a11y.new } : {}),
  };
}

// --- the server (serve.mjs), when it is up ------------------------------------------------------

async function http(C, path, { method = 'GET', body, headers, timeout = 2000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${C.serverUrl}${path}`, {
      method,
      signal: ctl.signal,
      headers: body || headers ? { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `${method} ${path}: HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}
async function server(C) {
  try {
    const s = await http(C, '/__pxsig/status', { timeout: 1500 });
    return { up: true, running: s.running, queued: s.queued, dashboard: s.dashboard };
  } catch {
    return { up: false, url: C.serverUrl, hint: 'start it with: pxsig serve --watch' };
  }
}

// --- the Rust engine: which entries can a set of files affect? ----------------------------------

function affected(C, { files, since }) {
  if (!existsSync(C.rustBin)) throw new Error(`the pxsig binary is missing: ${C.rustBin}`);
  const how = files?.length ? ['--files', files.join(',')] : ['--since', since];
  const run = writeRunManifest(C.P).path;
  const r = spawnSync(C.rustBin, ['affected', '--manifest', run, '--root', C.root, ...how, '--json'], {
    cwd: C.root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pxsig affected failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout);
}

/** Sources whose edits can change a render: the project's srcRoot plus its `affects` folders. */
function sourceRoots(C) {
  const roots = [C.P.srcRoot, ...C.P.affects.filter((a) => !/\.[a-z]+$/i.test(a)).map((a) => resolve(C.root, a))];
  return [...new Set(roots)].filter((r) => existsSync(r) && statSync(r).isDirectory());
}

/** Source files edited after `when` (tests excluded), with their edit times. */
function editedSince(C, when, { withTimes = false } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name.startsWith('.') || name.name === 'node_modules' || name.name === '__pxsig__') continue;
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|jsx?|json)$/.test(name.name) && !/\.test\./.test(name.name)) {
        const mtime = statSync(p).mtime;
        if (mtime > when) out.push(withTimes ? { file: relPath(C.root, p), mtime } : relPath(C.root, p));
      }
    }
  };
  for (const root of sourceRoots(C)) walk(root);
  return withTimes ? out.sort((a, b) => (a.file < b.file ? -1 : 1)) : out.sort();
}

/** When an entry's latest render was written, or null. */
function renderedAt(C, id) {
  const p = imagePath(C, 'current', id);
  return existsSync(p) ? statSync(p).mtime : null;
}

/** Width × height from a PNG's IHDR, without decoding it. */
function pngSize(p) {
  try {
    const b = readFileSync(p).subarray(16, 24);
    return [b.readUInt32BE(0), b.readUInt32BE(4)];
  } catch {
    return null;
  }
}

/**
 * When each row's verdict was made: its own `checkedAt` (rows written since that
 * field exists), else the latest history run that included it, else the report's
 * full-check time. Render file times are not used: a run can rewrite the PNGs
 * without updating the report.
 */
function verdictTimes(C, check) {
  const fromHistory = new Map();
  if (existsSync(C.historyPath))
    for (const line of readFileSync(C.historyPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const h = JSON.parse(line);
        for (const id of Object.keys(h.rows ?? {})) fromHistory.set(id, new Date(h.at));
      } catch {
        /* a torn line from a concurrent writer */
      }
    }
  const full = new Date(check.generatedAt);
  return new Map(
    check.rows.map((r) => {
      if (r.checkedAt) return [r.id, { at: new Date(r.checkedAt), source: 'row' }];
      const h = fromHistory.get(r.id);
      if (h && h > full) return [r.id, { at: h, source: 'history' }];
      return [r.id, { at: full, source: 'full check' }];
    })
  );
}

// --- images --------------------------------------------------------------------------------------

/** Where an image lives: the latest render and the diff are files; the baseline is in the .psig. */
function imagePath(C, kind, id) {
  if (kind === 'current') return join(C.P.store.latest, `${id}.png`);
  if (kind === 'diff') return join(C.P.store.diffLatest, `${id}.diff.png`);
  const e = (readJson(C.P.manifestPath(), { stories: [] }).stories ?? []).find((x) => x.id === id);
  return e ? resolve(C.root, e.sig) : null;
}

/** An image's bytes and where they came from, or null. */
export function imageOf(C, kind, id) {
  const p = imagePath(C, kind, id);
  if (!p || !existsSync(p)) return { bytes: null, where: p ? relPath(C.root, p) : 'no manifest entry' };
  const bytes = kind === 'baseline' ? readImage(p) : readFileSync(p);
  return { bytes, where: kind === 'baseline' ? `${relPath(C.root, p)} (image section)` : relPath(C.root, p) };
}

// --- tools ---------------------------------------------------------------------------------------

const ID_RE = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;
const text = (v) => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) });

const tools = [
  {
    name: 'pxsig_projects',
    description: 'The projects (packages under test) in this workspace: name, folder, Storybook URL, entry count and integrity headline. Every other tool takes one of these names as `project`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const ws = findWorkspace({});
      return {
        workspace: ws.root,
        projects: ws.projects.map((ref) => {
          try {
            const C = ctxOf(ref.name);
            const m = readJson(C.P.manifestPath(), { stories: [] });
            const led = readJson(join(C.P.store.reports, 'integrity.json'), null);
            return { name: ref.name, root: relPath(ws.root, ref.dir) || '.', storybook: C.P.storybook.url, entries: m.stories?.length ?? 0, integrity: led?.summary?.headline ?? null };
          } catch (e) {
            return { name: ref.name, error: e.message };
          }
        }),
      };
    },
  },
  {
    name: 'pxsig_status',
    description:
      'Overview of the visual-regression state: when the report was last written, counts per state (pass, drift, changed, error, flaky, approved, rejected), accessibility totals, the components with the most changed entries, whether the pxsig server is up or busy, and design-system files edited since the report (entries the report does not cover yet). Start here.',
    inputSchema: { type: 'object', properties: { project: PROJECT }, additionalProperties: false },
    async run({ project } = {}) {
      const C = ctxOf(project);
      const { check, review, updated } = load(C);
      const counts = {};
      const byComponent = {};
      let a11yViolations = 0;
      let a11yNew = 0;
      for (const r of check.rows) {
        const st = stateOf(r, review);
        counts[st] = (counts[st] ?? 0) + 1;
        if (PROBLEMS.has(st)) byComponent[componentOf(r.id)] = (byComponent[componentOf(r.id)] ?? 0) + 1;
        a11yViolations += r.a11y?.violations?.length ?? 0;
        a11yNew += r.a11y?.new ?? 0;
      }
      const edited = editedSince(C, updated);
      let stale = null;
      if (edited.length) {
        try {
          const a = affected(C, { files: edited });
          stale = { editedFiles: edited.slice(0, 40), moreFiles: Math.max(0, edited.length - 40), affectedEntries: a.ids.length, hint: 'pxsig_check { changed_files } re-checks just these' };
        } catch (e) {
          stale = { editedFiles: edited.slice(0, 40), error: e.message };
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
        mostChanged: Object.entries(byComponent).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([component, n]) => ({ component, n })),
        server: await server(C),
        stale,
        approvals: { level: C.P.config?.approvals?.level ?? 'standard' },
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
        state: { type: 'string', enum: ['problems', 'changed', 'new', 'error', 'flaky', 'rejected', 'approved', 'drift', 'pass', 'skipped', 'a11y', 'all'], default: 'problems' },
        component: { type: 'string', description: 'Substring of the entry id, e.g. "toast" or "components-datagrid".' },
        mode: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
      additionalProperties: false,
    },
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
      return { total: rows.length, shown: Math.min(rows.length, limit), entries: rows.slice(0, limit).map((r) => brief(r, review)) };
    },
  },
  {
    name: 'pxsig_entry',
    description:
      "One entry in full: the gate's metrics and reasons, the changed pixel regions, accessibility violations, the review decision — and the images, inline: the baseline render, the latest render and the diff heat map. Use it to see what actually changed.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        id: { type: 'string', description: 'Entry id, e.g. "components-toast--default__shown@light".' },
        images: { type: 'array', items: { type: 'string', enum: ['baseline', 'current', 'diff'] }, default: ['baseline', 'current', 'diff'] },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async run({ project, id, images = ['baseline', 'current', 'diff'] }) {
      if (!ID_RE.test(id)) throw new Error(`bad id: ${id}`);
      const C = ctxOf(project);
      const { check, review } = load(C);
      const row = check.rows.find((r) => r.id === id);
      if (!row) {
        const near = check.rows.filter((r) => r.id.startsWith(id.split('--')[0])).slice(0, 10).map((r) => r.id);
        throw new Error(`no entry ${id}${near.length ? `; entries of that component: ${near.join(', ')}` : ''}`);
      }
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
          content.push(text(`${kind}: ${(bytes.length / 1e6).toFixed(1)} MB, too large to inline — ${where}`));
          continue;
        }
        content.push(text(`${kind} (${where}):`));
        content.push({ type: 'image', mimeType: 'image/png', data: Buffer.from(bytes).toString('base64') });
      }
      return { content };
    },
  },
  {
    name: 'pxsig_a11y',
    description: "Accessibility (axe) violations per entry: all of them, or only those not in the entry's accepted list (`only_new`). Filter by component substring. Each entry carries its accessibility decision (accepted / rejected) when one was made since its last check.",
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT, only_new: { type: 'boolean', default: false }, component: { type: 'string' }, limit: { type: 'number', default: 50 } },
      additionalProperties: false,
    },
    async run({ project, only_new = false, component, limit = 50 }) {
      const { check, a11yReview } = load(ctxOf(project));
      const byRule = {};
      const rows = check.rows.filter((r) => (only_new ? r.a11y?.new : r.a11y?.violations?.length) && (!component || r.id.includes(component.toLowerCase())));
      for (const r of rows) for (const v of r.a11y.violations) byRule[v.id ?? v] = (byRule[v.id ?? v] ?? 0) + 1;
      return { entries: rows.length, byRule, list: rows.slice(0, limit).map((r) => ({ id: r.id, new: r.a11y.new, violations: r.a11y.violations, decision: a11yReview[r.id]?.state ?? null })) };
    },
  },
  {
    name: 'pxsig_affected',
    description: 'Which entries a set of edited files can change (Rust import graph), given file paths relative to the repo root, or a git ref to diff against.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT, files: { type: 'array', items: { type: 'string' } }, since: { type: 'string', description: 'git ref, e.g. "main" or a commit' } },
      additionalProperties: false,
    },
    async run({ project, files, since }) {
      if (!files?.length && !since) throw new Error('give files or since');
      const a = affected(ctxOf(project), { files, since });
      return { changedFiles: a.changed, reason: a.reason, entries: a.ids.length, ids: a.ids.slice(0, 200) };
    },
  },
  {
    name: 'pxsig_stale',
    description:
      "Results that cannot be trusted as current. (1) stale: the verdict is older than an edit to a file that can change that entry (the project's sources and the folders it depends on; Rust import graph). (2) inconsistent: the row's recorded pixel size differs from the render on disk, so the verdict was made on a different image. The report file's own timestamp hides both: re-checks rewrite it while other rows keep old results. Re-check what this returns with pxsig_check { ids } before trusting the report.",
    inputSchema: { type: 'object', properties: { project: PROJECT, limit: { type: 'number', default: 200 }, max_files: { type: 'number', default: 400 } }, additionalProperties: false },
    async run({ project, limit = 200, max_files = 400 }) {
      const C = ctxOf(project);
      const { check } = load(C);
      const times = verdictTimes(C, check);
      const sources = {};
      for (const t of times.values()) sources[t.source] = (sources[t.source] ?? 0) + 1;
      const oldest = new Date(Math.min(...[...times.values()].map((t) => t.at.getTime())));

      const inconsistent = [];
      for (const r of check.rows) {
        if (!r.pixels?.width) continue;
        const size = pngSize(imagePath(C, 'current', r.id));
        if (size && (size[0] !== r.pixels.width || size[1] !== r.pixels.height)) inconsistent.push({ id: r.id, row: `${r.pixels.width}x${r.pixels.height}`, render: `${size[0]}x${size[1]}` });
      }

      const edited = editedSince(C, oldest, { withTimes: true });
      if (edited.length > max_files)
        return { tooMany: edited.length, oldestVerdict: oldest.toISOString(), verdictTimes: sources, inconsistent: inconsistent.length, hint: 'too many edits since the oldest verdict to trace one by one: run pxsig_check { all: true }' };
      // id → the latest edit among files that affect it.
      const lastEdit = new Map();
      const culprit = new Map();
      for (const { file, mtime } of edited) {
        let ids;
        try {
          ids = affected(C, { files: [file] }).ids;
        } catch {
          continue;
        }
        for (const id of ids)
          if (!lastEdit.has(id) || mtime > lastEdit.get(id)) {
            lastEdit.set(id, mtime);
            culprit.set(id, file);
          }
      }
      const stale = check.rows.filter((r) => lastEdit.has(r.id) && times.get(r.id).at < lastEdit.get(r.id)).map((r) => ({ id: r.id, editedAfter: culprit.get(r.id) }));
      const byFile = {};
      for (const x of stale) byFile[x.editedAfter] = (byFile[x.editedAfter] ?? 0) + 1;
      const ids = [...new Set([...stale.map((x) => x.id), ...inconsistent.map((x) => x.id)])];
      return {
        stale: stale.length,
        inconsistent: inconsistent.length,
        of: check.rows.length,
        oldestVerdict: oldest.toISOString(),
        verdictTimes: sources,
        filesTraced: edited.length,
        byFile,
        inconsistentSample: inconsistent.slice(0, 10),
        ids: ids.slice(0, limit),
        hint: ids.length ? 'pxsig_check { ids } re-renders exactly these' : 'every result is newer than the edits that can change it',
      };
    },
  },
  {
    name: 'pxsig_check',
    description:
      'Re-render and re-check entries, then report their results. Select by `ids`, `stories`, `changed_files` (import graph), `since` (git ref), or `all`. A story (or entry) not in the manifest yet is registered first when Storybook is healthy: its entries arrive NEW, with no signature, for a person to approve; anything that cannot be registered is listed in `skipped` with the reason. Uses the running pxsig server (fast, warm browsers); without it, runs the check itself (needs the project Storybook). Never writes baselines.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        ids: { type: 'array', items: { type: 'string' } },
        stories: { type: 'array', items: { type: 'string' } },
        changed_files: { type: 'array', items: { type: 'string' } },
        since: { type: 'string' },
        all: { type: 'boolean' },
        timeout_s: { type: 'number', default: 900 },
      },
      additionalProperties: false,
    },
    async run({ project, ids = [], stories = [], changed_files, since, all = false, timeout_s = 900 }) {
      const C = ctxOf(project);
      const sel = new Set(ids);
      if (changed_files?.length || since) for (const id of affected(C, { files: changed_files, since }).ids) sel.add(id);
      if (!sel.size && !stories.length && !all) return { checked: 0, note: 'nothing selected (the files affect no entries?)' };
      const srv = await server(C);
      const t0 = Date.now();
      if (srv.up) {
        // Registering a new story reads its parameters in a browser first: allow for that.
        const res = await http(C, '/__pxsig/check', { method: 'POST', body: { project: C.P.name, ids: [...sel], stories, all, via: 'mcp' }, timeout: 120_000 });
        const queued = new Set(res.queued ?? []);
        const extra = { ...(res.registered?.length ? { registered: res.registered } : {}), ...(res.skipped?.length ? { skipped: res.skipped } : {}) };
        if (!queued.size) return { checked: 0, ...extra, note: res.skipped?.length ? 'nothing queued: every name was skipped (see skipped)' : 'nothing queued: no entry matches the selection' };
        // Wait for the queue to drain.
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          const s = await http(C, '/__pxsig/status', { timeout: 5000 }).catch(() => null);
          if (s && !s.running && !s.queued) break;
          if (Date.now() - t0 > timeout_s * 1000) return { timedOut: true, queued: queued.size, note: 'still running; call pxsig_status later' };
        }
        return { ...summarizeIds(C, queued, 'server', t0), ...extra };
      }
      const args = [join(here, 'check.mjs'), '--project', C.P.name, '--retries', '1'];
      // Ids and stories together (both name entries to --only; new ones are registered there).
      if (sel.size || stories.length) args.push('--only', [...sel, ...stories].join(','));
      const out = await new Promise((ok) => {
        const p = spawn(process.execPath, args, { cwd: C.root, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        p.stdout.on('data', (d) => (log += d));
        p.stderr.on('data', (d) => (log += d));
        const kill = setTimeout(() => p.kill(), timeout_s * 1000);
        p.on('exit', (code) => {
          clearTimeout(kill);
          ok({ code, log: log.split('\n').slice(-25).join('\n') });
        });
      });
      if (out.code === 2) throw new Error(`check setup error:\n${out.log}`);
      const want = new Set(load(C).check.rows.filter((r) => all || sel.has(r.id) || stories.includes(r.story) || sel.has(r.story)).map((r) => r.id));
      const skipped = [...out.log.matchAll(/^\[check\] not checked: (\S+): (.+)$/gm)].map((m) => ({ name: m[1], why: m[2] }));
      return { ...summarizeIds(C, want, 'check', t0), ...(skipped.length ? { skipped } : {}), log: out.log };
    },
  },
  {
    name: 'pxsig_review',
    description:
      "Mark entries for attention. reject: the entry's visual change is marked rejected (to be fixed); a11y-reject: its axe violations are marked for a fix; unreview / a11y-unreview: clear a rejection. Approving and accepting are not here: they need a person (the dashboard, or `pxsig approve` in a terminal), and the server refuses an agent's unreview of a person's approval or accept. A decision lasts until the entry's next check and is logged as via: mcp. Pass confirm: true ONLY when the user explicitly asked for this action on these exact entries in this conversation. Needs the pxsig server.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        action: { type: 'string', enum: [...AGENT_DECISIONS] },
        ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        confirm: { type: 'boolean', description: 'true only on an explicit user instruction for these ids.' },
      },
      required: ['action', 'ids', 'confirm'],
      additionalProperties: false,
    },
    async run({ project, action, ids, confirm }) {
      if (!AGENT_DECISIONS.has(action)) throw new Error(`refused: ${action} is not an agent's decision (${[...AGENT_DECISIONS].join(', ')}); ${NEEDS_PERSON}`);
      if (confirm !== true) throw new Error('refused: review actions need confirm: true, given only on an explicit user instruction for these ids');
      const bad = ids.filter((id) => !ID_RE.test(id));
      if (bad.length) throw new Error(`bad ids: ${bad.join(', ')}`);
      const C = ctxOf(project);
      const srv = await server(C);
      if (!srv.up) throw new Error(`the pxsig server is not running (${C.serverUrl}); ${srv.hint}`);
      // The server's MCP token (lib/guard.mjs): it lets this tool reject and clear rejections, nothing more.
      const token = readToken(C.P.workspaceRoot, C.serverUrl, 'mcp');
      if (!token) throw new Error(`no MCP token from the pxsig server at ${C.serverUrl} (it writes one when it starts): restart pxsig serve with this version`);
      const done = [];
      for (const id of ids) {
        const r = await http(C, `/__pxsig/${action}`, { method: 'POST', body: { project: C.P.name, id }, headers: { [TOKEN_HEADER]: token }, timeout: 120_000 });
        done.push({ id, entry: r.entry ?? null });
      }
      return { action, done };
    },
  },
  {
    name: 'pxsig_doctor',
    description:
      "Integrity and coverage, per component: which stories have no coverage (unregistered), entries never checked, missing baseline images or renders, render errors, stale verdicts, orphaned baselines — each with a stable status code, a severity and the reason. Writes the project's reports/integrity.json. `repair: 'plan'` lists the safe repairs; `repair: 'apply'` runs them (register new stories in the manifest without signatures, re-check, add a missing baseline image to its .psig only where the latest render passes the signature gate). Repairs never change a signature, never approve and never prune.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        component: { type: 'string', description: 'Substring of the component folder, e.g. "Toast" or "components/Data".' },
        status: { type: 'string', description: `Status code(s), comma-separated: ${Object.keys(CODES).join(', ')}.` },
        limit: { type: 'number', default: 40 },
        repair: { type: 'string', enum: ['none', 'plan', 'apply'], default: 'none' },
        only: { type: 'array', items: { type: 'string', enum: ['register', 'recheck', 'restore-baseline-image', 'convert-legacy'] }, description: 'Limit repairs to these actions.' },
        offline: { type: 'boolean', description: 'Do not fetch the Storybook index (static scan of the story files).' },
        stale: { type: 'boolean', description: 'Also re-check entries whose verdict is stale (a warning; left out of the repairs by default).' },
      },
      additionalProperties: false,
    },
    async run({ project, component, status, limit = 40, repair = 'none', only, offline = false, stale = false }) {
      if (repair !== 'apply') return doctor({ project, component, status, limit, repair, only, offline, stale, via: 'mcp' });
      // Repairs write the store: through the server that holds its lock, or under the lock here.
      const C = ctxOf(project);
      const held = readLock(C.P);
      if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
        const body = await http({ ...C, serverUrl: held.url ?? C.serverUrl }, '/__pxsig/repair', { method: 'POST', body: { project: C.P.name, apply: true, only, stale }, timeout: 30 * 60_000 });
        return { ...(await doctor({ project, component, status, limit, offline, via: 'mcp' })), plan: body.plan, applied: body.applied, via: 'server' };
      }
      let lock;
      try {
        lock = acquireLock(C.P, { holder: 'pxsig_doctor repair', command: 'pxsig mcp: pxsig_doctor repair apply' });
      } catch (e) {
        throw new Error(`${e.lock ? describeLock(C.P, e.lock) : e.message}: the repair did not run`);
      }
      try {
        return await doctor({ project, component, status, limit, repair, only, offline, stale, via: 'mcp' });
      } finally {
        lock.release();
      }
    },
  },
  {
    name: 'pxsig_help',
    description:
      'pxsig\'s own help, read-only: a command (`check`, `approve apply`), a topic (`agents`, `approvals`, `exit-codes`, `platforms`, `dashboard`, `ci`), a setting (`gate.threshold`) or `global` (options every command takes). The same text as `pxsig help <name>`. Without `name`, the list of names.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'A command, `command subcommand`, topic, setting key or `global`.' } }, additionalProperties: false },
    async run({ name } = {}) {
      if (!name) return { names: helpNames() };
      const found = lookup(String(name).trim().split(/\s+/));
      if (!found) throw new Error(`no command, topic or setting "${name}"; nearest: ${nearestNames(String(name)).join(', ')}`);
      return helpData(found);
    },
  },
  {
    name: 'pxsig_history',
    description: 'The last check runs (full and partial): when, how many entries, how many changed, and which.',
    inputSchema: { type: 'object', properties: { project: PROJECT, limit: { type: 'number', default: 10 } }, additionalProperties: false },
    async run({ project, limit = 10 }) {
      const C = ctxOf(project);
      if (!existsSync(C.historyPath)) return { runs: [] };
      const lines = readFileSync(C.historyPath, 'utf8').trim().split('\n').slice(-limit);
      return {
        runs: lines.map((l) => {
          const h = JSON.parse(l);
          const rows = Object.entries(h.rows ?? {});
          return { at: h.at, entries: h.summary?.stories ?? rows.length, failed: h.summary?.failed, failedIds: rows.filter(([, v]) => v[0] === 0).map(([id]) => id).slice(0, 20) };
        }),
      };
    },
  },
];

/**
 * The doctor: reconcile, write the ledger, and (optionally) plan or apply the safe repairs.
 * Shared by `pxsig_doctor` and `pxsig doctor`; the CLI adds the TTY-only prune itself.
 */
async function doctor({ project, component, status, limit = 40, repair = 'none', only, offline = false, via = 'mcp', confirmPrune = null, confirmTorn = null, prune = false, stale = false } = {}) {
  const C = ctxOf(project);
  const ctx = resolveContext(C.P);
  const serverUrl = C.serverUrl;
  let ledger = await reconcile(ctx, { offline });
  writeLedger(ctx, ledger);
  const settings = readSettings();
  const out = { project: C.P.name, ledgerPath: relPath(C.root, ledgerPath(ctx)), machine: { settings: settings.path, setUp: settings.exists, tokens: dirname(tokenFile(C.P.workspaceRoot, serverUrl ?? 'http://127.0.0.1:6070')) }, agent: detectAgent() };
  if (repair !== 'none') {
    const server = await serverStatus(serverUrl);
    const plan = planRepairs(ledger, { only, prune: prune && !!confirmPrune, server, stale });
    out.plan = plan;
    if (repair === 'apply') {
      const hooks = { ...defaultHooks(ctx, { serverUrl }), confirmPrune, confirmTorn };
      const res = await applyRepairs(ctx, plan, { hooks, via, reconcileOpts: { offline } });
      ledger = res.ledger;
      writeLedger(ctx, ledger);
      out.applied = res.steps;
    }
  }
  const view = filterLedger(ledger, { component, status });
  const sev = { error: 0, warn: 1, info: 2 };
  const focus = component || status;
  const comps = view.components.filter((c) => focus || c.severity !== 'info').sort((a, b) => sev[a.severity] - sev[b.severity] || (a.component < b.component ? -1 : 1));
  const ents = view.entries.filter((x) => focus || x.severity !== 'info').sort((a, b) => sev[a.severity] - sev[b.severity] || CODES[a.status].rank - CODES[b.status].rank);
  return {
    schemaVersion: ledger.schemaVersion,
    generatedAt: ledger.generatedAt,
    summary: ledger.summary,
    setup: ledger.setup,
    sources: ledger.sources,
    components: { total: comps.length, shown: Math.min(comps.length, limit), list: comps.slice(0, limit) },
    entries: {
      total: ents.length,
      shown: Math.min(ents.length, limit),
      list: ents.slice(0, limit).map((x) => ({ id: x.id, component: x.component, status: x.status, severity: x.severity, issues: x.issues.map(({ code, severity, reason }) => ({ code, severity, reason })) })),
    },
    ...out,
  };
}

function summarizeIds(C, ids, via, t0) {
  const { check, review } = load(C);
  const rows = check.rows.filter((r) => ids.has(r.id));
  const counts = {};
  for (const r of rows) counts[stateOf(r, review)] = (counts[stateOf(r, review)] ?? 0) + 1;
  return {
    via,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    checked: rows.length,
    counts,
    problems: rows.filter((r) => PROBLEMS.has(stateOf(r, review))).map((r) => brief(r, review)).slice(0, 60),
  };
}

// --- MCP over stdio ---------------------------------------------------------------------------------

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications: initialized, cancelled
  try {
    if (method === 'initialize') {
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'pxsig', version: VERSION },
          instructions:
            'pxsig is the visual-regression harness for this repo. Start with pxsig_projects (when there are several) and pxsig_status; pxsig_list then pxsig_entry show what changed, with images. Approving and accepting are the person\'s: never approve, never accept, and never call `/__pxsig/approve`; ask the person to review in the dashboard.',
        },
      });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: tools.map(({ run, ...t }) => t) } });
    if (method === 'tools/call') {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
      try {
        const out = await tool.run(params.arguments ?? {});
        const content = out?.content ?? [text(out)];
        return send({ id, result: { content } });
      } catch (e) {
        return send({ id, result: { content: [text(`Error: ${e.message}`)], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: e.message } });
  }
}

// Imported (the pxsig CLI reuses the tools): no stdio loop. Run directly: serve MCP.
export { tools, ctxOf, PROBLEMS, doctor };
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'parse error' } });
    }
    handle(msg);
  });
  try {
    const ws = findWorkspace({});
    log(`ready · workspace ${ws.root} · projects ${ws.projects.map((p) => p.name).join(', ')}`);
  } catch (e) {
    log(`ready · no workspace here yet (${e.message})`);
  }
}
