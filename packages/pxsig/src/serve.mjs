#!/usr/bin/env node
/**
 * serve.mjs — the pxsig server (`pxsig serve`): dashboard, live data, review, on-demand checks,
 * for every project in the workspace.
 *
 *   pxsig serve [--port 6070] [--no-open] [--tab stories] [--watch] [--project a,b]
 *
 * - One server per workspace. It writes `node_modules/.cache/pxsig/server.json` (url, pid,
 *   projects) so the CLI, the MCP server and the Storybook addon find it without a fixed port.
 * - Serves the prebuilt dashboard; `/__pxsig/data?project=` is one project's live report and
 *   `/__pxsig/events` (SSE) tells pages when a producer rewrote a report.
 * - Keeps one Rust engine (`pxsig serve`, stdio JSON-RPC) and a warm browser pool for every
 *   project, so approving a baseline or re-checking a story costs one render.
 * - `--watch`: edits under a project's srcRoot re-check only the affected entries.
 *
 * API. GET takes `?project=`, POST a `project` field; either may be left out when the workspace
 * has one project, or when the id / story names its project unambiguously (the Storybook addon
 * sends only ids). Same-origin, or a project's Storybook origin.
 *   GET  /__pxsig/projects · /__pxsig/status · /__pxsig/data · /__pxsig/events · /__pxsig/integrity
 *   POST /__pxsig/approve {id, batch?, via?, reason?, kind?}   latest render → baseline (`.psig`
 *        with the render as its image); the old baseline is snapshotted and the write logged
 *   POST /__pxsig/approve-story {story}   approve every entry of a story that waits for a decision, one batch
 *   POST /__pxsig/reject {id} · /__pxsig/unreview {id}   unreview of an approval restores the old baseline
 *   POST /__pxsig/a11y-accept {id} · a11y-reject · a11y-unreview   the entry's axe violations
 *   POST /__pxsig/a11y-unaccept {id, rule?}   take a rule (or all) off the entry's accepted list
 *   POST /__pxsig/check {ids?|story?|stories?|all?}   render + Rust check, merged into check.json; names
 *        not in the manifest are registered first (healthy Storybook; NEW, no signature) or `skipped`
 *   POST /__pxsig/repair {apply?, only?}   the safe repairs: plan, or apply (never prunes)
 *   GET  /p/<project>/renders/latest/<id>.png · /p/<project>/renders/base/<id>.png (from the .psig)
 *        /p/<project>/diffs/latest/<file> · /p/<project>/sig/<id> (the .psig header, JSON)
 *
 * Guard: a check first asks Storybook for its index; a broken or unreachable index is a setup
 * error (nothing rendered or recorded), and renders that hit Storybook's error page are dropped.
 * When `storybook.url` does not answer and `storybook.staticDir` holds a build, the server serves
 * that build itself on a free port and renders against it (lib/static.mjs).
 *
 * One writer per store (lib/lock.mjs): the server holds each served project's
 * `<store>/reports/.lock` for as long as it runs, and every write for that project (approve,
 * reject, re-check, repair) happens here, in its queue. A CLI `check --full` against a served
 * project hands its selection to this queue. While another process holds a project's lock, the
 * server waits for it and answers that project's writes with 409.
 *
 * An approve works for an entry with no baseline yet (a NEW entry): the first render becomes its
 * baseline, logged with `before: null`.
 *
 * Binds to 127.0.0.1 only.
 */
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { newBatch, paths, record, sha256, snapshot, undo, who } from './lib/approvals.mjs';
import { browserPool, renderStories, STORYBOOK_ERROR } from './lib/capture.mjs';
import { fetchStoryIndex, filterLedger, loadStoryIndex, oneLine, reconcile, resolveContext, writeLedger } from './lib/integrity.mjs';
import { readHeader, readImage } from './lib/psig.mjs';
import { parseArgs, strFlag } from './lib/args.mjs';
import { acquireLock, describeLock, LockError } from './lib/lock.mjs';
import { applyRepairs, defaultHooks, planRepairs, registerNamed } from './lib/repair.mjs';
import { buildRow, dropStaleRows, storybookBroken, summarize } from './lib/rows.mjs';
import { ensureStorybook } from './lib/static.mjs';
import { findWorkspace, flagLayer, loadProject, PXSIG_VERSION, rustBinary, serverFile, writeRunManifest } from './lib/workspace.mjs';
import { buildData, dashboardDir, prebuiltDashboardDir, useDashboard } from './report.mjs';
import { chooseDashboard } from './lib/dashboard-dir.mjs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const { flags } = parseArgs(process.argv.slice(2));
const str = (k) => strFlag(flags, k);
let ws;
try {
  ws = findWorkspace({ workspace: str('workspace') });
} catch (e) {
  console.error(`[serve] ${e.message}`);
  process.exit(2);
}
const wantPort = Number(flags.port) || ws.server?.port || 6070;
const only = str('project')?.split(',');

// The dashboard: PXSIG_DASHBOARD_DIR, else a project's own build for its UI adapter (dashboard.ui)
// when it is current, else the prebuilt one. Serve never builds: it says which command does.
{
  const builtinDir = (name) => {
    for (const d of [join(here, '..', 'dashboard'), join(here, '..', '..', 'dashboard')]) if (existsSync(join(d, 'src', 'ui', 'adapters', name))) return join(d, 'src', 'ui', 'adapters', name);
    return null;
  };
  const dash = chooseDashboard({ projects: ws.projects.filter((p) => !only || only.includes(p.name)), prebuilt: prebuiltDashboardDir, version: PXSIG_VERSION, root: ws.root, builtinDir });
  useDashboard(dash.dir);
  if (dash.note) console.log(`[serve] ${dash.note}`);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.log': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const httpError = (status, message) => Object.assign(new Error(message), { status });

// --- the Rust engine, kept running --------------------------------------------------
const rustBin = rustBinary();
let engine = null;
function rust(method, params) {
  if (!engine) {
    const proc = spawn(rustBin, ['serve'], { cwd: ws.root, stdio: ['pipe', 'pipe', 'inherit'] });
    const pending = new Map();
    let seq = 0;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p) msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
    });
    proc.on('exit', (code) => {
      for (const p of pending.values()) p.reject(new Error(`pxsig serve exited (${code})`));
      engine = null;
    });
    engine = {
      call(m, prm) {
        const id = ++seq;
        return new Promise((ok, fail) => {
          pending.set(id, { resolve: ok, reject: fail });
          proc.stdin.write(`${JSON.stringify({ id, method: m, params: prm })}\n`);
        });
      },
      kill: () => proc.kill(),
    };
  }
  return engine.call(method, params);
}

// --- live updates -------------------------------------------------------------------------
const clients = new Set();
const broadcast = (event, data = {}) => {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// --- one browser pool for every project ----------------------------------------------------
let pool = null;

// --- projects --------------------------------------------------------------------------------
/** Everything the server keeps for one project. */
function openState(ref) {
  const P = loadProject(ws, ref, { flags: flagLayer(flags) });
  const S = {
    P,
    name: P.name,
    reviewPath: join(P.store.reports, 'review.json'),
    a11yReviewPath: join(P.store.reports, 'a11y-review.json'),
    checkPath: join(P.store.reports, 'check.json'),
    ctx: resolveContext(P),
    runPath: null,
    manifest: { stories: [] },
    integrity: null,
    integrityTimer: null,
    integrityRunning: false,
    queued: new Set(),
    running: null,
    repairing: null,
    /** Check runs started, and the last one that failed (a repair waits on the queue and asks). */
    runs: 0,
    lastFailure: null,
    quietUntil: 0,
    lock: null,
    lockWait: null,
  };
  S.reload = () => {
    try {
      const r = writeRunManifest(P);
      S.runPath = r.path;
      S.manifest = r.manifest;
    } catch (e) {
      S.manifest = { stories: [] };
      S.runPath = null;
      S.error = e.message;
    }
  };
  S.reload();
  S.integrity = readJson(join(P.store.reports, 'integrity.json'), null);
  S.affected = (file) => (S.runPath ? rust('affected', { manifest: S.runPath, root: P.workspaceRoot, files: [file] }).then((r) => r.ids) : Promise.resolve([]));
  mkdirSync(P.store.reports, { recursive: true });
  return S;
}

const states = new Map();
for (const ref of ws.projects) {
  if (only && !only.includes(ref.name)) continue;
  try {
    states.set(ref.name, openState(ref));
  } catch (e) {
    console.error(`[serve] project ${ref.name}: ${e.message}`);
  }
}
if (!states.size) {
  console.error('[serve] no project could be opened');
  process.exit(2);
}
const allowedOrigins = new Set();
for (const S of states.values()) {
  const o = new URL(S.P.storybook.url).origin;
  allowedOrigins.add(o);
  allowedOrigins.add(o.replace('localhost', '127.0.0.1'));
}

/** The project a request means: named, or the only one, or the one owning the id / story. */
function stateFor({ project, id, story } = {}) {
  if (project) {
    const S = states.get(project);
    if (!S) throw httpError(404, `no project "${project}" (projects: ${[...states.keys()].join(', ')})`);
    return S;
  }
  if (states.size === 1) return [...states.values()][0];
  const owners = [...states.values()].filter((S) => S.manifest.stories.some((e) => (id && e.id === id) || (story && (e.story ?? e.id) === story)));
  if (owners.length === 1) return owners[0];
  throw httpError(400, `name a project (projects: ${[...states.keys()].join(', ')})`);
}

// --- review --------------------------------------------------------------------------------
function updateCheckRows(S, mut, fresh = new Map(), timing = null) {
  const check = readJson(S.checkPath, null) ?? { generatedAt: new Date().toISOString(), project: S.name, summary: {}, rows: [] };
  const seen = new Set(check.rows.map((r) => r.id));
  check.rows = check.rows.map((r) => mut(r) ?? r);
  // Entries added after the last full check have no row yet: append them, or their verdicts are
  // computed and silently dropped.
  const add = [...fresh.values()].filter((r) => !seen.has(r.id));
  if (add.length) {
    const order = new Map(S.manifest.stories.map((e, i) => [e.id, i]));
    check.rows = [...check.rows, ...add].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  }
  const dropped = S.runPath ? dropStaleRows(check, S.manifest) : [];
  if (dropped.length) console.log(`[serve] ${S.name}: dropped ${dropped.length} rows no longer in the manifest`);
  // Timings describe one run: a full re-check replaces them; a partial one leaves the last full
  // run's (the Duration card and Diagnostics read them against `checked`).
  check.summary = { ...check.summary, ...summarize(check.rows), ...(timing ?? {}) };
  S.quietUntil = Date.now() + 800;
  writeFileSync(S.checkPath, `${JSON.stringify(check)}\n`);
}

/**
 * Drops check rows for entries no longer in the manifest (a story removed on another branch), on
 * start and whenever the manifest is reloaded. Only with the store lock and a manifest that loaded.
 */
function pruneStaleRows(S) {
  if (!S.lock || !S.runPath) return;
  const check = readJson(S.checkPath, null);
  if (!check) return;
  const dropped = dropStaleRows(check, S.manifest);
  if (!dropped.length) return;
  S.quietUntil = Date.now() + 800;
  writeFileSync(S.checkPath, `${JSON.stringify(check)}\n`);
  console.log(`[serve] ${S.name}: dropped ${dropped.length} rows no longer in the manifest (${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? ', …' : ''})`);
  broadcast('data', { project: S.name });
}

/** Writes for a project need its store lock (held for the server's life once taken). */
function needLock(S) {
  if (S.lock) return;
  throw httpError(409, `${S.lockWait ?? 'the store lock is not held'}: this project is read-only until it is free`);
}

/** Take a project's store lock now, or keep trying every 2 s while another process holds it. */
function takeLock(S) {
  try {
    S.lock = acquireLock(S.P, { holder: 'serve', command: 'pxsig serve' });
    S.lockWait = null;
    if (url) S.lock.update({ url });
    return true;
  } catch (e) {
    if (!(e instanceof LockError)) throw e;
    const msg = e.lock ? describeLock(S.P, e.lock) : e.message;
    if (S.lockWait !== msg) console.error(`[serve] ${S.name}: ${msg}; waiting for it (writes are refused until then)`);
    S.lockWait = msg;
    setTimeout(() => takeLock(S), 2000).unref();
    return false;
  }
}

async function approve(S, id, meta = {}) {
  needLock(S);
  const { P, manifest } = S;
  const e = manifest.stories.find((s) => s.id === id);
  if (!e) throw httpError(404, `unknown entry ${id}`);
  const latest = join(P.store.latest, `${id}.png`);
  if (!existsSync(latest)) throw httpError(409, `no latest render for ${id}; run a check`);
  // Mid-check, latest/ holds renders not yet trimmed or verified: approving one bakes in that.
  if (S.checking?.has(id) || S.queued.has(id)) throw httpError(409, `${id} is being re-checked; approve it once the check finishes`);
  // A render that failed (an error page, a timeout) left the previous image behind, not this story.
  const current = readJson(S.checkPath, { rows: [] }).rows.find((r) => r.id === id);
  if (current?.error) throw httpError(409, `${id} did not render (${current.error}); fix it and re-check before approving`);
  const batch = meta.batch ?? newBatch(meta.via ?? 'dashboard');
  // No baseline yet (a NEW entry): nothing to snapshot, `before` is null and undo removes the file.
  const { before } = snapshot(P, e, batch);
  // A .psig output carries the render itself as the baseline image.
  const res = await rust('capture', {
    png: latest,
    out: resolve(P.workspaceRoot, e.sig),
    grid: e.grid ?? manifest.grid ?? 64,
    minCellPx: e.grid ? undefined : manifest.minCellPx,
    detail: e.detail !== false && manifest.detail !== false,
    entry: { id: e.id, story: e.story ?? null, mode: e.mode ?? null, state: e.state ?? null },
  });
  // The a11y baseline follows the approved render; the old list is kept so an undo can put it back.
  const row = readJson(S.checkPath, { rows: [] }).rows.find((r) => r.id === id);
  let a11yBefore;
  if (row?.a11y?.violations) {
    const base = readJson(P.store.a11y, {});
    a11yBefore = base[id] ?? null;
    base[id] = row.a11y.violations.map((v) => v.id).sort();
    writeFileSync(P.store.a11y, `${JSON.stringify(base, null, 2)}\n`);
  }
  const logged = record(P, e, { batch, via: meta.via ?? 'dashboard', reason: meta.reason ?? null, kind: meta.kind ?? null, before });
  return { ...res, batch, after: logged.after, ...(a11yBefore !== undefined ? { a11yBefore } : {}) };
}

/**
 * Undo one approval made through the server: restore that entry's previous baseline from the
 * batch snapshot (a first baseline goes to trash/), put its a11y baseline back, and log it like
 * `pxsig approve undo`. Refuses, changing nothing, when the baseline was rewritten since.
 */
function unapprove(S, id, entry) {
  const { P, manifest } = S;
  const e = manifest.stories.find((s) => s.id === id);
  if (!e) throw httpError(404, `unknown entry ${id}`);
  const before = sha256(paths(P, e).sig);
  const res = undo(P, manifest, entry.batch, { git: false, ids: [id] });
  if (res.refused.length) throw httpError(409, `cannot undo ${id}: ${res.refused[0].why}`);
  if (!res.restored.length && !res.removed.length) throw httpError(409, `cannot undo ${id}: nothing in batch ${entry.batch} to restore`);
  record(P, e, { batch: `${entry.batch}-undo`, via: 'undo', reason: `undo ${entry.batch} (dashboard)`, before });
  if ('a11yBefore' in entry) {
    const base = readJson(P.store.a11y, {});
    if (entry.a11yBefore == null) delete base[id];
    else base[id] = entry.a11yBefore;
    writeFileSync(P.store.a11y, `${JSON.stringify(base, null, 2)}\n`);
  }
}

async function review(S, action, id, meta = {}) {
  needLock(S);
  const rv = readJson(S.reviewPath, {});
  if (action === 'approve') {
    rv[id] = { state: 'approved', at: new Date().toISOString(), ...(await approve(S, id, meta)) };
    // The report says so too, so its counts (failed, changed) agree with the review.
    updateCheckRows(S, (r) => (r.id === id ? { ...r, approved: { at: rv[id].at, batch: rv[id].batch } } : null));
  } else if (action === 'reject') rv[id] = { state: 'rejected', at: new Date().toISOString() };
  else if (action === 'unreview') {
    if (rv[id]?.state === 'approved' && rv[id].batch) unapprove(S, id, rv[id]);
    delete rv[id];
    updateCheckRows(S, (r) => (r.id === id && r.approved ? (({ approved, ...rest }) => rest)(r) : null));
  }
  else throw httpError(404, 'unknown action');
  S.quietUntil = Date.now() + 800;
  writeFileSync(S.reviewPath, `${JSON.stringify(rv, null, 2)}\n`);
  console.log(`[serve] ${S.name}: ${action} ${id}`);
  broadcast('review', { project: S.name, id, entry: rv[id] ?? null });
  return rv[id] ?? null;
}

/**
 * Approve every entry of one story that waits for a decision (each mode and state), in one batch:
 * a person's single click in the dashboard. Entries that passed, did not render, were rejected or
 * are already approved are left out, with why. Each approval is logged and undone like any other.
 */
async function approveStory(S, story, meta = {}) {
  needLock(S);
  if (!S.running) S.reload();
  const entries = S.manifest.stories.filter((e) => (e.story ?? e.id) === story);
  if (!entries.length) throw httpError(404, `unknown story ${story}`);
  const rows = new Map(readJson(S.checkPath, { rows: [] }).rows.map((r) => [r.id, r]));
  const rv = readJson(S.reviewPath, {});
  const batch = meta.batch ?? newBatch(meta.via ?? 'dashboard');
  const approved = [];
  const skipped = [];
  for (const e of entries) {
    const r = rows.get(e.id);
    const why = rv[e.id]?.state === 'approved' ? 'already approved' : rv[e.id]?.state === 'rejected' ? 'rejected: decide on it alone' : !r || r.skipped ? 'not checked yet' : r.error ? `did not render (${String(r.error).split('\n')[0]})` : r.pass && !r.new ? 'passes: nothing to approve' : null;
    if (why) {
      skipped.push({ id: e.id, why });
      continue;
    }
    try {
      await review(S, 'approve', e.id, { ...meta, batch });
      approved.push(e.id);
    } catch (err) {
      skipped.push({ id: e.id, why: err.message });
    }
  }
  console.log(`[serve] ${S.name}: approve story ${story}: ${approved.length} approved, ${skipped.length} left (batch ${batch})`);
  return { story, batch, approved, skipped };
}

// --- on-demand checks (dashboard, addon, watch) ----------------------------------------------
async function runChecks(S) {
  if (S.running || !S.queued.size) return S.running;
  const ids = [...S.queued];
  S.queued = new Set();
  S.checking = new Set(ids);
  const { P } = S;
  const seq = ++S.runs;
  S.running = (async () => {
    const t0 = performance.now();
    broadcast('check', { project: S.name, state: 'running', ids });
    try {
      S.reload();
      const manifest = S.manifest;
      const entries = manifest.stories.filter((e) => ids.includes(e.id));
      // Guard: a broken Storybook index makes every render its error page. Refuse, record nothing.
      const idx = await fetchStoryIndex(manifest.baseUrl);
      if (!idx.healthy) throw Object.assign(new Error(`setup error: ${idx.reachable ? "Storybook's story index is broken" : 'Storybook is not reachable'} — ${idx.error}. Nothing was rendered.`), { setup: true });
      pool ??= browserPool(P);
      const concurrency = Math.min(8, entries.length);
      const { results, wallMs, reloads = 0 } = await renderStories(pool, entries, P.store.latest, { ...manifest, concurrency, project: P, a11y: true });
      const sbErrors = results.filter((r) => r.error?.startsWith(STORYBOOK_ERROR));
      if (storybookBroken(sbErrors.length, results.length))
        throw Object.assign(new Error(`setup error: ${sbErrors.length} of ${results.length} renders hit Storybook's error page (${sbErrors[0].error.slice(STORYBOOK_ERROR.length).trim()}). Nothing was recorded.`), { setup: true });
      if (manifest.trim) await rust('trim', { dir: P.store.latest, only: ids, pad: manifest.trim.pad ?? 16, tolerance: manifest.trim.tolerance ?? 8 });
      const res = await rust('check', {
        manifest: S.runPath,
        pngDir: P.store.latest,
        root: P.workspaceRoot,
        only: ids,
        outDir: P.store.diffLatest,
        cache: join(P.store.cache, 'check'),
        // Re-checks are runs too: the History tab and pxsig_history read this.
        history: join(P.store.reports, 'history.ndjson'),
      });
      for (const g of res.summary.identicalRenders ?? [])
        console.error(`[serve] ${S.name}: ${g.count} failing entries rendered the same image (${g.ids.slice(0, 3).join(', ')}…): marked as errors, nothing to approve`);
      const byId = new Map(res.results.map((r) => [r.id, r]));
      const renders = new Map(results.map((r) => [r.id, r]));
      const a11yBase = readJson(P.store.a11y, null);
      const rv = readJson(S.reviewPath, {});
      for (const id of ids) delete rv[id]; // a fresh verdict replaces a decision on the old one
      writeFileSync(S.reviewPath, `${JSON.stringify(rv, null, 2)}\n`);
      const av = readJson(S.a11yReviewPath, {});
      for (const id of ids) delete av[id];
      writeFileSync(S.a11yReviewPath, `${JSON.stringify(av, null, 2)}\n`);
      const fresh = new Map(entries.map((e) => [e.id, buildRow(e, byId.get(e.id), renders.get(e.id), a11yBase, manifest)]));
      const full = entries.length === manifest.stories.length;
      const timing = full ? { concurrency, renderWallMs: wallMs, pageLoads: reloads, rustEngineMs: res.summary.elapsedMs, totalMs: performance.now() - t0 } : null;
      updateCheckRows(S, (r) => fresh.get(r.id), fresh, timing);
      const failed = [...fresh.values()].filter((r) => !r.pass).length;
      console.log(`[serve] ${S.name}: re-checked ${ids.length} entries · ${failed} changed · ${((performance.now() - t0) / 1000).toFixed(1)} s (Rust ${res.summary.elapsedMs.toFixed(0)} ms)`);
      broadcast('check', { project: S.name, state: 'done', ids, failed, ms: performance.now() - t0 });
      broadcast('data', { project: S.name });
    } catch (e) {
      console.error(`[serve] ${S.name}: check failed: ${e.message}`);
      S.lastFailure = { seq, error: e.message, setup: !!e.setup, ids: ids.length, at: new Date().toISOString() };
      broadcast('check', { project: S.name, state: 'error', ids, error: e.message, setup: !!e.setup });
    } finally {
      S.running = null;
      S.checking = null;
      if (S.queued.size) runChecks(S);
      else scheduleIntegrity(S, 'check', 0);
    }
  })();
  return S.running;
}

// --- accessibility decisions -------------------------------------------------------------------
// Separate from the visual verdict: accepting puts an entry's current axe violations on its
// accepted list (<store>/a11y.json); rejecting marks them for a fix. Both last until the next
// check of the entry, like review.json. Every accept and undo is logged beside a11y.json.

const a11yLog = (P, line) => appendFileSync(join(dirname(P.store.a11y), 'a11y-decisions.ndjson'), `${JSON.stringify(line)}\n`);
const writeA11y = (P, base) => writeFileSync(P.store.a11y, `${JSON.stringify(base, null, 2)}\n`);

function a11yReview(S, action, id, meta = {}) {
  needLock(S);
  const { P, manifest } = S;
  if (!manifest.stories.some((e) => e.id === id)) throw httpError(404, `unknown entry ${id}`);
  const av = readJson(S.a11yReviewPath, {});
  const base = readJson(P.store.a11y, {});
  const at = new Date().toISOString();
  const by = who(P.workspaceRoot);
  const via = meta.via ?? 'dashboard';
  if (action === 'a11y-accept') {
    const row = readJson(S.checkPath, { rows: [] }).rows.find((r) => r.id === id);
    if (!row?.a11y?.violations) throw httpError(409, `no accessibility results for ${id}; run a check`);
    const before = base[id] ?? null;
    const after = row.a11y.violations.map((v) => v.id).sort();
    base[id] = after;
    writeA11y(P, base);
    a11yLog(P, { at, by, via, action: 'accept', id, before, after, reason: meta.reason ?? null });
    av[id] = { state: 'accepted', at, before };
  } else if (action === 'a11y-reject') av[id] = { state: 'rejected', at };
  else if (action === 'a11y-unaccept') {
    // Take a rule (or every rule) off the accepted list: the report shows it as new at once.
    const current = base[id] ?? [];
    const after = current.filter((r) => meta.rule && r !== meta.rule);
    if (after.length === current.length) throw httpError(409, `${meta.rule ?? 'nothing'} is not on the accepted list of ${id}`);
    base[id] = after;
    writeA11y(P, base);
    a11yLog(P, { at, by, via, action: 'unaccept', id, before: current, after, rule: meta.rule ?? null });
    delete av[id];
    updateCheckRows(S, (r) => (r.id === id && r.a11y?.violations ? { ...r, a11y: { ...r.a11y, baseline: after, new: r.a11y.violations.filter((v) => !after.includes(v.id)).length } } : null));
  }
  else if (action === 'a11y-unreview') {
    const prev = av[id];
    if (prev?.state === 'accepted') {
      const current = base[id] ?? null;
      if (prev.before == null) delete base[id];
      else base[id] = prev.before;
      writeA11y(P, base);
      a11yLog(P, { at, by, via, action: 'undo', id, before: current, after: prev.before });
    }
    delete av[id];
  } else throw httpError(404, 'unknown action');
  S.quietUntil = Date.now() + 800;
  writeFileSync(S.a11yReviewPath, `${JSON.stringify(av, null, 2)}\n`);
  console.log(`[serve] ${S.name}: ${action} ${id}`);
  broadcast('review', { project: S.name, id, a11y: av[id] ?? null });
  return av[id] ?? null;
}

/**
 * Queue a check. Names (ids or stories) the manifest does not have are registered first when
 * Storybook is healthy (NEW entries, no signature), so checking a new story is one request;
 * anything that cannot be registered comes back in `skipped`, with why.
 */
async function enqueue(S, body) {
  needLock(S);
  // Select against the manifest on disk: entries added since the server started (or since the
  // last check) would otherwise be dropped as unknown. A running check keeps the one it started with.
  if (!S.running) S.reload();
  const asked = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const ids = new Set(asked(body.ids));
  const stories = new Set([...asked(body.stories), ...(typeof body.story === 'string' ? [body.story] : [])]);
  const known = (name) => S.manifest.stories.some((e) => e.id === name || (e.story ?? e.id) === name);
  const unknown = [...new Set([...ids, ...stories])].filter((n) => !known(n));
  let registered = { added: [], stories: [], skipped: [] };
  if (unknown.length && !body.all) {
    const index = await loadStoryIndex(S.ctx);
    registered = await registerNamed(S.ctx, unknown, { index, harvest: defaultHooks(S.ctx).harvest, via: typeof body.via === 'string' ? body.via.replace(/[^\w-]/g, '').slice(0, 20) || 'server' : 'server' });
    if (registered.added.length) {
      S.reload();
      console.log(`[serve] ${S.name}: registered ${registered.stories.join(', ')} (${registered.added.length} NEW entries) to check them`);
    }
    for (const story of registered.stories) stories.add(story);
  }
  for (const e of S.manifest.stories) if (body.all || stories.has(e.story ?? e.id)) ids.add(e.id);
  const queued = [...ids].filter((id) => S.manifest.stories.some((e) => e.id === id));
  queued.forEach((id) => S.queued.add(id));
  runChecks(S);
  if (registered.added.length) scheduleIntegrity(S, 'registered', 0);
  return { queued, registered: registered.added, skipped: registered.skipped };
}

/** Per-story status for the addon's sidebar, across every project (story ids are per Storybook). */
function statuses() {
  const out = {};
  const rank = { error: 5, changed: 4, rejected: 4, flaky: 3, drift: 2, approved: 1, pass: 0, skipped: 0 };
  for (const S of states.values()) {
    const check = readJson(S.checkPath, { rows: [] });
    const rv = readJson(S.reviewPath, {});
    for (const r of check.rows) {
      const s = (out[r.story] ??= { status: 'pass', project: S.name, entries: [] });
      const st = rv[r.id]?.state ?? (r.skipped ? 'skipped' : r.error ? 'error' : r.flaky ? 'flaky' : r.pass ? (r.metrics && r.metrics.ssim < 1 ? 'drift' : 'pass') : 'changed');
      s.entries.push({ id: r.id, mode: r.mode, state: st, ssim: r.metrics?.ssim ?? null, reasons: r.reasons ?? [] });
      if ((rank[st] ?? 0) > (rank[s.status] ?? 0)) s.status = st;
    }
  }
  return out;
}

/** Per-story integrity for the addon: the worst status of the story's entries, with their codes. */
function storyIntegrity() {
  const out = {};
  const sev = { error: 0, warn: 1, info: 2 };
  for (const S of states.values()) {
    if (!S.integrity) continue;
    for (const x of S.integrity.entries) {
      const s = (out[x.story] ??= { status: 'ok', severity: 'info', project: S.name, component: x.component, codes: {} });
      for (const i of x.issues) s.codes[i.code] = (s.codes[i.code] ?? 0) + 1;
      if (sev[x.severity] < sev[s.severity] || (x.severity === s.severity && s.status === 'ok')) Object.assign(s, { status: x.status, severity: x.severity });
    }
  }
  return out;
}

// --- integrity: always on ------------------------------------------------------------------------
async function runIntegrity(S, why) {
  if (S.integrityRunning || S.running) return scheduleIntegrity(S, why, 1500);
  S.integrityRunning = true;
  try {
    S.reload();
    pruneStaleRows(S);
    const idx = await loadStoryIndex(S.ctx);
    const ledger = await reconcile(S.ctx, { index: idx, affected: S.affected });
    const before = S.integrity?.summary?.headline;
    S.integrity = ledger;
    S.quietUntil = Date.now() + 800;
    writeLedger(S.ctx, ledger);
    if (before !== ledger.summary.headline) console.log(`[serve] ${S.name}: ${oneLine(ledger)} (${why}, ${ledger.elapsedMs} ms)`);
    broadcast('integrity', { project: S.name, summary: ledger.summary, setup: ledger.setup });
  } catch (e) {
    console.error(`[serve] ${S.name}: integrity failed: ${e.message}`);
  } finally {
    S.integrityRunning = false;
  }
}
function scheduleIntegrity(S, why, ms = 1500) {
  clearTimeout(S.integrityTimer);
  S.integrityTimer = setTimeout(() => runIntegrity(S, why), ms);
}
const watchFor = (dir, onChange, filter = () => true) => {
  if (!existsSync(dir)) return;
  try {
    watch(dir, { recursive: true }, (_, file) => {
      if (!file || /(^|\/)(\.|node_modules\/)/.test(file) || !filter(file)) return;
      onChange(file);
    });
  } catch (e) {
    console.error(`[serve] cannot watch ${relative(ws.root, dir)}: ${e.message}`);
  }
};
for (const S of states.values()) {
  const { P } = S;
  const later = (why) => () => scheduleIntegrity(S, why);
  watchFor(P.srcRoot, later('source changed'), (f) => /\.(tsx?|jsx?|mjs|css|json|mdx)$/.test(f));
  watchFor(P.store.baselines, later('baselines changed'));
  watchFor(join(P.store.root, 'renders'), later('renders changed'), (f) => f.startsWith('latest'));
  watchFor(P.store.root, later('manifest changed'), (f) => /^manifest(\..+)?\.json$/.test(f));
  let dataTimer = null;
  watchFor(P.store.reports, (file) => {
    if (Date.now() < S.quietUntil || file.startsWith('.run')) return;
    clearTimeout(dataTimer);
    dataTimer = setTimeout(() => broadcast('data', { project: S.name }), 300);
  }, (f) => /\.(nd)?json$/.test(f));
}

/** Safe repairs, as the dashboard's button asks: plan, or apply (never prune, never approve). */
async function repair(S, { apply = false, only: onlySteps, stale = false } = {}) {
  const ledger = await reconcile(S.ctx, { affected: S.affected });
  const plan = planRepairs(ledger, { only: Array.isArray(onlySteps) ? onlySteps.filter((a) => a !== 'prune') : undefined, prune: false, server: { up: true }, stale });
  if (!apply) return { plan };
  needLock(S);
  if (S.repairing) throw httpError(409, 'a repair is already running');
  const hooks = {
    ...defaultHooks(S.ctx, { serverUrl: url }),
    // Re-checks go through this server's own queue (warm browsers), then wait for it to drain.
    async recheck(ids) {
      const from = S.runs;
      await enqueue(S, { ids });
      while (S.running || S.queued.size) await (S.running ?? new Promise((r) => setTimeout(r, 200)));
      // A run that failed (Storybook down, a broken index) recorded nothing: say so.
      if (S.lastFailure && S.lastFailure.seq > from) throw new Error(S.lastFailure.error);
      return { via: 'server' };
    },
  };
  S.repairing = applyRepairs(S.ctx, plan, { hooks, via: 'dashboard', reconcileOpts: { affected: S.affected } });
  try {
    const res = await S.repairing;
    S.integrity = res.ledger;
    writeLedger(S.ctx, res.ledger);
    broadcast('integrity', { project: S.name, summary: res.ledger.summary, setup: res.ledger.setup });
    broadcast('data', { project: S.name });
    console.log(`[serve] ${S.name}: repair: ${res.steps.map((s) => `${s.action} → ${s.result}`).join(' · ') || 'nothing to do'}`);
    return { plan, applied: res.steps, summary: res.ledger.summary };
  } finally {
    S.repairing = null;
  }
}

// --- watch mode: edits re-check only what they can affect --------------------------------------
if (flags.watch) {
  for (const S of states.values()) {
    const src = S.P.srcRoot;
    const changed = new Set();
    let t = null;
    watchFor(src, (file) => {
      changed.add(relative(ws.root, join(src, file)));
      clearTimeout(t);
      // Give Storybook's dev server a moment to rebuild before we render.
      t = setTimeout(async () => {
        const files = [...changed];
        changed.clear();
        try {
          if (!S.runPath) return;
          const a = await rust('affected', { manifest: S.runPath, root: ws.root, files });
          console.log(`[serve] ${S.name}: watch: ${files.join(', ')} → ${a.ids.length} entries (${a.reason})`);
          broadcast('watch', { project: S.name, files, ids: a.ids.length });
          if (a.ids.length) await enqueue(S, { ids: a.ids });
        } catch (e) {
          console.error(`[serve] ${S.name}: watch: ${e.message}`);
        }
      }, 900);
    }, (f) => !/(^|\/)(__pxsig__|node_modules)\//.test(f) && /\.(tsx?|css\.ts|mjs|jsx?)$/.test(f));
    console.log(`[serve] ${S.name}: watching ${relative(ws.root, src)} — edits re-check affected entries`);
  }
}

// --- http ----------------------------------------------------------------------------------------
const cors = (req, res) => {
  const o = req.headers.origin;
  if (o && allowedOrigins.has(o)) {
    res.setHeader('access-control-allow-origin', o);
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('vary', 'origin');
  }
};
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch (e) {
        fail(Object.assign(e, { status: 400 }));
      }
    });
  });

const projectsList = () =>
  [...states.values()].map((S) => ({ name: S.name, root: relative(ws.root, S.P.root) || '.', storybook: S.P.storybook.url, entries: S.manifest.stories.length, integrity: S.integrity?.summary ?? null, error: S.error ?? null, locked: S.lock ? 'held' : S.lockWait }));

async function api(req, res, action, q) {
  if (action === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('event: hello\ndata: {}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (action === 'projects') return json(res, 200, { workspace: ws.root, projects: projectsList() });
  if (action === 'status')
    return json(res, 200, {
      served: true,
      projects: projectsList(),
      running: [...states.values()].some((S) => S.running),
      queued: [...states.values()].reduce((n, S) => n + S.queued.size, 0),
      repairing: [...states.values()].some((S) => S.repairing),
      review: Object.assign({}, ...[...states.values()].map((S) => readJson(S.reviewPath, {}))),
      stories: statuses(),
      integrity: storyIntegrity(),
      integritySummary: Object.fromEntries([...states.values()].filter((S) => S.integrity).map((S) => [S.name, { ...S.integrity.summary, setup: S.integrity.setup, generatedAt: S.integrity.generatedAt }])),
      dashboard: `${url}/report/`,
    });
  if (req.method === 'GET') {
    const S = stateFor({ project: q.get('project'), story: q.get('story') });
    if (action === 'data') return json(res, 200, buildData(S.P));
    if (action === 'integrity') {
      if (!S.integrity || q.get('fresh')) await runIntegrity(S, 'request');
      if (!S.integrity) return json(res, 503, { error: 'integrity not computed yet' });
      const story = q.get('story');
      if (story) return json(res, 200, { project: S.name, story, ...(storyIntegrity()[story] ?? { status: 'unknown' }), entries: S.integrity.entries.filter((x) => x.story === story) });
      const f = q.get('component') || q.get('status') ? filterLedger(S.integrity, { component: q.get('component'), status: q.get('status') }) : null;
      return json(res, 200, f ? { ...S.integrity, ...f } : S.integrity);
    }
    return json(res, 405, { error: 'POST only' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  // Same-origin, or a project's Storybook (the addon): a page on any other site must not write baselines.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && !allowedOrigins.has(origin)) return json(res, 403, { error: 'cross-origin' });
  const body = await readBody(req);
  if (action === 'check') {
    // Without a project, a check is split across the projects that own the ids / stories.
    const targets = body.project || states.size === 1 ? [stateFor(body)] : [...states.values()];
    const results = [];
    for (const S of targets) results.push(await enqueue(S, body));
    const queued = results.flatMap((r) => r.queued);
    const skipped = results.flatMap((r) => r.skipped);
    // Split across projects, a name only one project knows is not skipped by the others.
    const named = new Set(queued.flatMap((id) => [id, id.replace(/(__[^@]+)?(@.+)?$/, '')]));
    return json(res, 202, { ok: true, queued, registered: results.flatMap((r) => r.registered), skipped: targets.length > 1 ? skipped.filter((x) => !named.has(x.name)) : skipped });
  }
  const S = stateFor(body);
  if (action === 'repair') return json(res, 200, await repair(S, { apply: body.apply === true, only: body.only, stale: body.stale === true }));
  if (action === 'approve-story') {
    const { story } = body;
    if (typeof story !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+$/.test(story)) return json(res, 400, { error: 'bad story' });
    const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    return json(res, 200, { ok: true, project: S.name, ...(await approveStory(S, story, { via: s(body.via, 20)?.replace(/[^\w-]/g, ''), reason: s(body.reason, 500) })) });
  }
  const { id } = body;
  if (typeof id !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/.test(id)) return json(res, 400, { error: 'bad id' });
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const meta = { batch: s(body.batch, 80)?.replace(/[^\w.-]/g, ''), via: s(body.via, 20)?.replace(/[^\w-]/g, ''), reason: s(body.reason, 500), kind: s(body.kind, 10), rule: s(body.rule, 80)?.replace(/[^\w-]/g, '') };
  if (action.startsWith('a11y-')) return json(res, 200, { ok: true, project: S.name, id, entry: a11yReview(S, action, id, meta) });
  json(res, 200, { ok: true, project: S.name, id, entry: await review(S, action, id, meta) });
}

const sendFile = (req, res, file) => {
  const st = statSync(file);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache', 'last-modified': st.mtime.toUTCString() });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
};
const inside = (root, file) => file === root || file.startsWith(root + sep);

/** /p/<project>/… : a project's renders, diffs, baseline images (out of the .psig) and headers. */
function projectFile(req, res, name, rest) {
  const S = states.get(name);
  if (!S) return json(res, 404, { error: `no project "${name}"` });
  const { P } = S;
  const entryOf = (id) => S.manifest.stories.find((e) => e.id === id);
  let m = rest.match(/^renders\/base\/(.+)\.png$/);
  if (m) {
    const e = entryOf(m[1]);
    const img = e && readImage(resolve(P.workspaceRoot, e.sig));
    if (!img) return json(res, 404, { error: 'no baseline image' });
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': img.length, 'cache-control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : img);
  }
  m = rest.match(/^sig\/(.+)$/);
  if (m) {
    const e = entryOf(m[1]);
    const h = e && readHeader(resolve(P.workspaceRoot, e.sig));
    return h ? json(res, 200, h) : json(res, 404, { error: 'no baseline' });
  }
  const roots = { 'renders/': join(P.store.root, 'renders'), 'diffs/': P.store.diffs };
  for (const [prefix, root] of Object.entries(roots)) {
    if (!rest.startsWith(prefix)) continue;
    const file = resolve(root, rest.slice(prefix.length));
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory()) return json(res, 404, { error: 'not found' });
    return sendFile(req, res, file);
  }
  return json(res, 404, { error: 'not found' });
}

const server = createServer(async (req, res) => {
  try {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const u = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(u.pathname);
    if (path === '/') return res.writeHead(302, { location: '/report/' }).end();
    if (path.startsWith('/__pxsig/')) return await api(req, res, path.slice(9), u.searchParams);
    if (path === '/api/integrity') return await api(req, res, 'integrity', u.searchParams);
    const pm = path.match(/^\/p\/([^/]+)\/(.+)$/);
    if (pm) return projectFile(req, res, pm[1], pm[2]);
    if (path === '/report' || path.startsWith('/report/')) {
      let file = resolve(dashboardDir, `.${path.slice('/report'.length) || '/'}`);
      if (!inside(dashboardDir, file)) return json(res, 403, { error: 'outside root' });
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file)) return json(res, 404, { error: existsSync(dashboardDir) ? 'not found' : `the dashboard is not built (${dashboardDir})` });
      if (file === join(dashboardDir, 'index.html')) {
        // Served pages fetch live data: drop whatever a static build inlined.
        const html = readFileSync(file, 'utf8').replace(/<script id="pxsig-data">[\s\S]*?<\/script>/, '');
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
        return res.end(html);
      }
      return sendFile(req, res, file);
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.message });
  }
});

// --- open (or reuse) a browser tab ---------------------------------------------------------------
function openBrowser(target) {
  if (process.platform !== 'darwin') {
    const cmd = process.platform === 'win32' ? 'start' : 'xdg-open';
    return execFile(cmd, [target], { shell: process.platform === 'win32' }, () => {});
  }
  const origin = new URL(target).origin;
  const script = `
    if application "Google Chrome" is running then
      tell application "Google Chrome"
        repeat with w in windows
          set i to 0
          repeat with t in tabs of w
            set i to i + 1
            if URL of t starts with "${origin}" then
              set URL of t to "${target}"
              set active tab index of w to i
              set index of w to 1
              activate
              return "reused"
            end if
          end repeat
        end repeat
      end tell
    end if
    return "none"`;
  execFile('osascript', ['-e', script], (err, out) => {
    if (!err && out.trim() === 'reused') return console.log('[serve] reloaded the open dashboard tab');
    execFile('open', [target], () => {});
  });
}

let url = null;
const info = serverFile(ws.root);
function listen(port, tries = 10) {
  const onError = (e) => {
    server.off('listening', onListening);
    if (e.code === 'EADDRINUSE' && tries > 0) return listen(port + 1, tries - 1);
    console.error(`[serve] ${e.message}`);
    process.exit(2);
  };
  const onListening = () => {
    server.off('error', onError);
    url = `http://127.0.0.1:${server.address().port}`;
    mkdirSync(dirname(info), { recursive: true });
    writeFileSync(info, `${JSON.stringify({ url, pid: process.pid, startedAt: new Date().toISOString(), projects: [...states.keys()] }, null, 2)}\n`);
    for (const S of states.values()) S.lock?.update({ url });
    const page = `${url}/report/${flags.tab ? `#${flags.tab}` : ''}`;
    console.log(`[serve] pxsig dashboard → ${page}  (${[...states.keys()].join(', ')}; Ctrl+C to stop)`);
    if (!flags['no-open']) openBrowser(page);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
}

const shutdown = async () => {
  for (const S of states.values()) S.lock?.release();
  engine?.kill();
  await pool?.close();
  try {
    if (readJson(info, {}).pid === process.pid) rmSync(info);
  } catch {
    // already gone
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await rust('ping', {}).then((p) => console.log(`[serve] Rust engine up (pxsig ${p.version}, ${p.threads} threads)`));
for (const S of states.values()) {
  takeLock(S);
  // No Storybook at storybook.url but a build in storybook.staticDir: serve it ourselves.
  const sb = await ensureStorybook(S.P, { log: (m) => console.log(`[serve] ${S.name}: ${m}`) });
  if (sb.served) {
    S.reload();
    S.ctx = resolveContext(S.P);
    const o = new URL(sb.url).origin;
    allowedOrigins.add(o);
  }
}
listen(wantPort);
for (const S of states.values()) runIntegrity(S, 'startup');
