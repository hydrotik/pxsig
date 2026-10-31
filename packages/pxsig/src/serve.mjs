#!/usr/bin/env node
/**
 * serve.mjs — the pxsig server (`pxsig serve`): dashboard, live data, review, on-demand checks,
 * for every project in the workspace.
 *
 *   pxsig serve [--port 6070] [--no-open] [--tab stories] [--watch] [--project a,b] [--debug]
 *
 * - One server per workspace. It writes `node_modules/.cache/pxsig/server.json` (url, pid,
 *   projects) so the CLI, the MCP server and the Storybook addon find it without a fixed port.
 * - Serves the prebuilt dashboard; `/__pxsig/data?project=` is one project's live report and
 *   `/__pxsig/events` (SSE) tells pages when a producer rewrote a report.
 * - Keeps one Rust engine (`pxsig serve`, stdio JSON-RPC) and a warm browser pool for every
 *   project, so approving a baseline or re-checking a story costs one render.
 * - `--watch`: edits under a project's srcRoot re-check only the affected entries.
 * - `--debug`: every program the server starts is printed on stderr (lib/spawn.mjs).
 * - Opening the dashboard: macOS reuses or opens a tab, Linux runs xdg-open, Windows starts
 *   nothing (the link is printed; the terminal makes it clickable).
 *
 * API. GET takes `?project=`, POST a `project` field; either may be left out when the workspace
 * has one project, or when the id / story names its project unambiguously (the Storybook addon
 * sends only ids). Writes are same-origin, or (checks and repairs only) a project's Storybook.
 * Decisions (approve, approve-story, reject, unreview, a11y-*) also need the dashboard link's
 * cookie (a page opened with the link this server prints) or the CLI's token (`x-pxsig-token`,
 * `pxsig approve apply`): an agent or a script posting to the server, or reading the page, is
 * refused with 403 (lib/guard.mjs). A decision's `via` in the log is what it carried (`dashboard`
 * or `cli`); a `via` in the body is ignored.
 *   POST /__pxsig/session {ticket}   the dashboard page trades the link's ticket for the cookie
 *   POST /__pxsig/ticket             `pxsig serve --link` (the CLI's token): a new dashboard link
 *   GET  /__pxsig/projects · /__pxsig/status · /__pxsig/data · /__pxsig/events · /__pxsig/integrity
 *   POST /__pxsig/approve {id, batch?, reason?, kind?}   latest render → baseline (`.psig`
 *        with the render as its image); the old baseline is snapshotted and the write logged
 *   POST /__pxsig/approve-story {story}   approve every entry of a story that waits for a decision, one batch
 *   POST /__pxsig/reject {id} · /__pxsig/unreview {id}   unreview of an approval restores the old baseline
 *   POST /__pxsig/a11y-accept {id} · a11y-reject · a11y-unreview   the entry's axe violations
 *   POST /__pxsig/a11y-unaccept {id, rule?}   take a rule (or all) off the entry's accepted list
 *   POST /__pxsig/check {ids?|story?|stories?|all?}   render + Rust check, merged into check.json; names
 *        not in the manifest are registered first (healthy Storybook; NEW, no signature) or `skipped`
 *   POST /__pxsig/repair {apply?, only?}   the safe repairs: plan, or apply (never prunes)
 *   POST /__pxsig/a11y-prune {plan, batch, reason?}   remove the plan's prunable accepted axe rules
 *                                       (`pxsig a11y --prune`; the CLI's token only, never the MCP's;
 *                                       refused when a11y.json changed since the plan was made)
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
import { execFile, spawn } from './lib/spawn.mjs';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import {
  newBatch,
  PERSON_VIA,
  paths,
  record,
  sha256,
  snapshot,
  stamp,
  undo,
  who,
} from './lib/approvals.mjs';
import { BY_STORY_OFF, byStory, storySkip } from './lib/approvals/story.mjs';
import { browserPool, renderStories, STORYBOOK_ERROR } from './lib/capture.mjs';
import {
  fetchStoryIndex,
  filterLedger,
  loadStoryIndex,
  oneLine,
  reconcile,
  resolveContext,
  writeLedger,
} from './lib/integrity.mjs';
import { readHeader, readImage } from './lib/psig.mjs';
import { parseArgs, strFlag } from './lib/args.mjs';
import { acquireLock, alive, describeLock, LockError } from './lib/lock.mjs';
import { applyRepairs, defaultHooks, planRepairs, registerNamed } from './lib/repair.mjs';
import { buildRow, dropStaleRows, storybookBroken, summarize } from './lib/rows.mjs';
import { annotateRow, byId, envConfig, envSummary } from './lib/env.mjs';
import { ensureStorybook } from './lib/static.mjs';
import {
  findWorkspace,
  flagLayer,
  loadProject,
  PXSIG_VERSION,
  rustBinary,
  serverFile,
  writeRunManifest,
} from './lib/workspace.mjs';
import {
  buildData,
  dashboardDir,
  prebuiltDashboardDir,
  uiContractVersion,
  useDashboard,
} from './report.mjs';
import { chooseDashboard } from './lib/dashboard-dir.mjs';
import {
  authorize,
  Links,
  linkSetCookie,
  loopbackHost,
  mayMintTicket,
  NEEDS_PERSON,
  newToken,
  pageHeaders,
  removeToken,
  sameOriginPage,
  writeToken,
} from './lib/guard.mjs';
import { approving, LINK_ELSEWHERE, LINK_EXPIRED, LINK_TIMING } from './lib/dashboard-link.mjs';
import { humanAtTerminal } from './lib/term.mjs';
import { fileURLToPath } from 'node:url';
import { relPath } from './lib/paths.mjs';
import { appendLine, readJson, writeJson } from './lib/files.mjs';
import { applyPrune } from './lib/prune.mjs';
/** The server listens on a TCP port, so `server.address()` is an AddressInfo wherever it is read. */
/** @import { AddressInfo } from 'node:net' */
/** @import { IntegrityContext } from './lib/integrity.mjs' */
/**
 * @import { CheckRow, EnvRecord, LockHandle, ManifestEntry, Project, ProjectRef, RunManifest,
 *   Workspace } from './types.js'
 */
/** @import { IncomingMessage, ServerResponse } from 'node:http' */
/** @import { Readable, Writable } from 'node:stream' */
/**
 * @import { A11yBaseline, A11yReviewFile, A11yRow, CheckReport, CheckTiming, DecisionMeta, Engine,
 *   EngineMethod, EngineMethods, EnginePending, EngineReply, Enqueued, HttpError, ProjectQuery,
 *   RequestBody, ReviewEntry, ReviewFile, ServerRecord, SetupError, StoryIntegrity, StoryStatus
 * } from './types/t5.js'
 */
/** The integrity ledger (lib/integrity.mjs `reconcile`). */
/** @typedef {Awaited<ReturnType<typeof reconcile>>} IntegrityLedger */
/**
 * Everything the server keeps for one project (`openState`).
 * @typedef {object} ProjectState
 * @property {Project} P
 * @property {string} name
 * @property {string} reviewPath
 * @property {string} a11yReviewPath
 * @property {string} checkPath
 * @property {IntegrityContext} ctx
 * @property {string | null} runPath the run manifest, or null when none could be written
 * @property {Pick<RunManifest, 'stories'> & Partial<RunManifest>} manifest the run manifest (only `stories` when it failed)
 * @property {IntegrityLedger | null} integrity
 * @property {NodeJS.Timeout | null} integrityTimer
 * @property {boolean} integrityRunning
 * @property {Promise<unknown>} [integrityDone]
 * @property {Set<string>} queued
 * @property {Set<string> | null} [checking]
 * @property {Promise<void> | null} running
 * @property {ReturnType<typeof applyRepairs> | null} repairing
 * @property {number} runs check runs started
 * @property {{ seq: number, error: string, setup: boolean, ids: number, at: string } | null} lastFailure
 * @property {number} quietUntil
 * @property {LockHandle | null} lock
 * @property {string | null} lockWait why the store lock is not held yet
 * @property {string} [error] why the run manifest could not be written
 * @property {() => void} reload
 * @property {(file: string) => Promise<string[]>} affected
 */

const here = dirname(fileURLToPath(import.meta.url));

const { flags } = parseArgs(process.argv.slice(2));
// Children inherit it, so the engine and checks the server starts are printed too.
if (flags.debug)
  process.env.PXSIG_DEBUG = [process.env.PXSIG_DEBUG, 'spawn'].filter(Boolean).join(',');
/** @param {string} k */
const str = (k) => strFlag(flags, k);
/** @type {Workspace} */
let ws;
try {
  ws = findWorkspace({ workspace: str('workspace') });
} catch (e) {
  // findWorkspace throws Errors (a missing or malformed workspace file).
  console.error(`[serve] ${/** @type {Error} */ (e).message}`);
  process.exit(2);
}
const wantPort = Number(flags.port) || ws.server?.port || 6070;
const only = str('project')?.split(',');

// The dashboard: PXSIG_DASHBOARD_DIR, else a project's own build for its UI adapter (dashboard.ui)
// when it is current, else the prebuilt one. Serve never builds: it says which command does.
{
  /** @param {string} name */
  const builtinDir = (name) => {
    for (const d of [join(here, '..', 'dashboard'), join(here, '..', '..', 'dashboard')])
      if (existsSync(join(d, 'src', 'ui', 'adapters', name)))
        return join(d, 'src', 'ui', 'adapters', name);
    return null;
  };
  // This pxsig's UI contract version, from the lock shipped with the dashboard source.
  const contract = uiContractVersion();
  const dash = chooseDashboard({
    projects: ws.projects.filter((p) => !only || only.includes(p.name)),
    prebuilt: prebuiltDashboardDir,
    version: PXSIG_VERSION,
    contract,
    root: ws.root,
    builtinDir,
  });
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it selects the dashboard folder to serve.
  useDashboard(dash.dir);
  if (dash.note) console.log(`[serve] ${dash.note}`);
}

/** @type {Record<string, string>} */
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
/**
 * @param {number} status
 * @param {string} message
 * @returns {HttpError}
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });
/**
 * Decisions need one of these (lib/guard.mjs): the dashboard page's, the CLI's, or the MCP's
 * (files only the owner reads; the MCP's only rejects and clears rejections).
 */
const TOKENS = { cli: newToken(), mcp: newToken() };
// The dashboard link's tickets and cookies (lib/guard.mjs): in memory, so a restart ends them.
const links = new Links();
/**
 * The dashboard link: the dashboard (on `tab`) with a fresh one-time ticket in its fragment.
 * @param {string} base
 * @param {string | boolean | null} [tab]
 */
const dashboardLink = (base, tab = null) =>
  `${base}#${tab ? `tab=${encodeURIComponent(tab)}&` : ''}ticket=${links.mint()}`;
/**
 * An agent clears its own kind of decision only: never a person's approval or accept.
 * @param {DecisionMeta} meta
 * @param {string | undefined} state
 */
const agentMayClear = (meta, state) => {
  if (meta.via === 'mcp' && (state === 'approved' || state === 'accepted'))
    throw httpError(
      403,
      `clearing an ${state === 'approved' ? 'approval' : 'accept'} ${NEEDS_PERSON.slice('approving '.length)}`
    );
};

// --- the Rust engine, kept running --------------------------------------------------
const rustBin = rustBinary();
/** @type {Engine | null} */
let engine = null;
/**
 * One call to the engine: its answer's `result`, or a rejection with its `error`.
 * @template {EngineMethod} M
 * @param {M} method
 * @param {EngineMethods[M]['params']} params
 * @returns {Promise<EngineMethods[M]['result']>}
 */
function rust(method, params) {
  if (!engine) {
    const proc = spawn(rustBin, ['serve'], { cwd: ws.root, stdio: ['pipe', 'pipe', 'inherit'] });
    /** @type {Map<number | null, EnginePending>} */
    const pending = new Map();
    let seq = 0;
    // stdin and stdout are pipes (`stdio` above), so neither is null.
    createInterface({ input: /** @type {Readable} */ (proc.stdout) }).on('line', (line) => {
      // The engine writes one JSON object per line (crates/pxsig-cli/src/serve.rs); any other line
      // (not JSON, or JSON that is not an object) answers nothing and is skipped.
      /** @type {unknown} */
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const msg = /** @type {EngineReply} */ (parsed);
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p) {
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      }
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
          // A pipe (`stdio` above), so not null.
          /** @type {Writable} */ (proc.stdin).write(
            `${JSON.stringify({ id, method: m, params: prm })}\n`
          );
        });
      },
      kill: () => proc.kill(),
    };
  }
  return engine.call(method, params);
}

// --- live updates -------------------------------------------------------------------------
/** @type {Set<ServerResponse>} */
const clients = new Set();
/**
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 */
const broadcast = (event, data = {}) => {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// --- one browser pool for every project ----------------------------------------------------
/** @type {ReturnType<typeof browserPool> | null} */
let pool = null;

// --- projects --------------------------------------------------------------------------------
/**
 * Everything the server keeps for one project.
 * @param {ProjectRef} ref
 */
function openState(ref) {
  const P = loadProject(ws, ref, { flags: flagLayer(flags) });
  /** @type {Omit<ProjectState, 'reload' | 'affected'> & Partial<Pick<ProjectState, 'reload' | 'affected'>>} */
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
      // Without the store lock (another process holds it) the run manifest goes to a temp folder.
      const r = writeRunManifest(
        P,
        undefined,
        S.lock ? {} : { dir: join(tmpdir(), `pxsig-serve-${process.pid}`, S.name) }
      );
      S.runPath = r.path;
      S.manifest = r.manifest;
      // Loaded: an earlier failure no longer applies.
      delete S.error;
    } catch (e) {
      S.manifest = { stories: [] };
      S.runPath = null;
      // writeRunManifest throws Errors (an unreadable manifest, a bad config).
      S.error = /** @type {Error} */ (e).message;
    }
  };
  S.reload();
  // integrity.json is the ledger writeLedger wrote.
  S.integrity = /** @type {IntegrityLedger | null} */ (
    readJson(join(P.store.reports, 'integrity.json'), null)
  );
  // Staleness traces edits (never the gates' fail-safe: docs/ci.md).
  S.affected = (file) =>
    S.runPath
      ? rust('affected', { manifest: S.runPath, root: P.workspaceRoot, files: [file] }).then(
          (r) => r.traced ?? r.ids
        )
      : Promise.resolve([]);
  mkdirSync(P.store.reports, { recursive: true });
  // `reload` and `affected` are both set above.
  return /** @type {ProjectState} */ (S);
}

/** @type {Map<string, ProjectState>} */
const states = new Map();
for (const ref of ws.projects) {
  if (only && !only.includes(ref.name)) continue;
  try {
    states.set(ref.name, openState(ref));
  } catch (e) {
    // loadProject throws Errors (a missing or invalid config).
    console.error(`[serve] project ${ref.name}: ${/** @type {Error} */ (e).message}`);
  }
}
if (!states.size) {
  console.error('[serve] no project could be opened');
  process.exit(2);
}
/** @type {Set<string>} */
const allowedOrigins = new Set();
for (const S of states.values()) {
  const o = new URL(S.P.storybook.url).origin;
  allowedOrigins.add(o);
  allowedOrigins.add(o.replace('localhost', '127.0.0.1'));
}

/**
 * The project a request means: named, or the only one, or the one owning the id / story.
 * @param {ProjectQuery} [query] from the request: any JSON value, compared as it is
 * @returns {ProjectState}
 */
function stateFor({ project, id, story } = {}) {
  if (project) {
    // Every name in `states` is a string: any other value misses, as an unknown name does.
    const S = states.get(/** @type {string} */ (project));
    if (!S)
      throw httpError(
        404,
        // A template prints any value as String() does; only a string can name a project.
        `no project "${/** @type {string} */ (project)}" (projects: ${[...states.keys()].join(', ')})`
      );
    return S;
  }
  // One project: the map's only value.
  if (states.size === 1) return [...states.values()][0];
  const owners = [...states.values()].filter((S) =>
    S.manifest.stories.some((e) => (id && e.id === id) || (story && (e.story ?? e.id) === story))
  );
  if (owners.length === 1) return owners[0];
  throw httpError(400, `name a project (projects: ${[...states.keys()].join(', ')})`);
}

// --- review --------------------------------------------------------------------------------
/**
 * Rewrite check.json's rows with `mut` (null keeps a row), add `fresh` rows it lacks, recount.
 * @param {ProjectState} S
 * @param {(row: CheckRow) => CheckRow | null | undefined} mut
 * @param {Map<string, CheckRow>} [fresh]
 * @param {CheckTiming | null} [timing]
 * @param {Record<string, EnvRecord> | null} [envs]
 */
function updateCheckRows(S, mut, fresh = new Map(), timing = null, envs = null) {
  // check.json is this server's (or a CLI check's) own file.
  const check = /** @type {CheckReport | null} */ (readJson(S.checkPath, null)) ?? {
    generatedAt: new Date().toISOString(),
    project: S.name,
    summary: {},
    rows: [],
  };
  // Every environment a row names (lib/env.mjs), by id: the fresh rows' and their baselines'.
  if (envs) check.envs = { ...check.envs, ...envs };
  const seen = new Set(check.rows.map((r) => r.id));
  check.rows = check.rows.map((r) => mut(r) ?? r);
  // Entries added after the last full check have no row yet: append them, or their verdicts are
  // computed and silently dropped.
  const add = [...fresh.values()].filter((r) => !seen.has(r.id));
  if (add.length) {
    const order = new Map(S.manifest.stories.map((e, i) => [e.id, i]));
    check.rows = [...check.rows, ...add].sort(
      (a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)
    );
  }
  const dropped = S.runPath ? dropStaleRows(check, S.manifest) : [];
  if (dropped.length)
    console.log(`[serve] ${S.name}: dropped ${dropped.length} rows no longer in the manifest`);
  // Timings describe one run: a full re-check replaces them; a partial one leaves the last full
  // run's (the Duration card and Diagnostics read them against `checked`).
  check.summary = {
    ...check.summary,
    ...summarize(check.rows),
    ...envSummary(check.rows, check.envs ?? {}),
    ...timing,
  };
  if (!check.summary.envMismatch) delete check.summary.envFields;
  // New verdicts move the report's time ("Last check"); `fullCheckAt` keeps when every entry was
  // last checked together, which is what integrity's "absent from the last full check" means.
  if (fresh.size) {
    const now = new Date().toISOString();
    check.fullCheckAt = timing ? now : (check.fullCheckAt ?? check.generatedAt);
    check.generatedAt = now;
  }
  S.quietUntil = Date.now() + 800;
  writeJson(S.checkPath, check);
}

/**
 * Drops check rows for entries no longer in the manifest (a story removed on another branch), on
 * start and whenever the manifest is reloaded. Only with the store lock and a manifest that loaded.
 * @param {ProjectState} S
 */
function pruneStaleRows(S) {
  if (!S.lock || !S.runPath) return;
  const check = /** @type {CheckReport | null} */ (readJson(S.checkPath, null));
  if (!check) return;
  const dropped = dropStaleRows(check, S.manifest);
  if (!dropped.length) return;
  S.quietUntil = Date.now() + 800;
  writeJson(S.checkPath, check);
  console.log(
    `[serve] ${S.name}: dropped ${dropped.length} rows no longer in the manifest (${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? ', …' : ''})`
  );
  broadcast('data', { project: S.name });
}

/**
 * Writes for a project need its store lock (held for the server's life once taken).
 * @param {ProjectState} S
 */
function needLock(S) {
  if (S.lock) {
    try {
      return S.lock.check();
    } catch (e) {
      // Taken over (a person did, after this server went quiet): stop writing, wait to get it back.
      if (!(e instanceof LockError)) throw e;
      console.error(`[serve] ${S.name}: ${e.message}`);
      S.lock = null;
      S.lockWait = e.message;
      setTimeout(() => takeLock(S), 2000).unref();
    }
  }
  throw httpError(
    409,
    `${S.lockWait ?? 'the store lock is not held'}: this project is read-only until it is free`
  );
}

/**
 * Take a project's store lock now, or keep trying every 2 s while another process holds it.
 * @param {ProjectState} S
 */
function takeLock(S) {
  try {
    S.lock = acquireLock(S.P, { holder: 'serve', command: 'pxsig serve' });
    const waited = !!S.lockWait;
    S.lockWait = null;
    if (url) S.lock.update({ url });
    // Waited for the lock: the run manifest moves into the store, and the ledger is written.
    if (waited) {
      S.reload();
      scheduleIntegrity(S, 'store lock taken', 0);
    }
    return true;
  } catch (e) {
    if (!(e instanceof LockError)) throw e;
    const msg = e.lock ? describeLock(S.P, e.lock) : e.message;
    if (S.lockWait !== msg)
      console.error(`[serve] ${S.name}: ${msg}; waiting for it (writes are refused until then)`);
    S.lockWait = msg;
    setTimeout(() => takeLock(S), 2000).unref();
    return false;
  }
}

/**
 * @param {ProjectState} S
 * @param {string} id
 * @param {DecisionMeta} [meta]
 */
async function approve(S, id, meta = {}) {
  needLock(S);
  const { P, manifest } = S;
  const e = manifest.stories.find((s) => s.id === id);
  if (!e) throw httpError(404, `unknown entry ${id}`);
  const latest = join(P.store.latest, `${id}.png`);
  if (!existsSync(latest)) throw httpError(409, `no latest render for ${id}; run a check`);
  // Mid-check, latest/ holds renders not yet trimmed or verified: approving one bakes in that.
  if (S.checking?.has(id) || S.queued.has(id))
    throw httpError(409, `${id} is being re-checked; approve it once the check finishes`);
  // A render that failed (an error page, a timeout) left the previous image behind, not this story.
  // check.json is pxsig's own file (the fallback has its `rows`).
  const current = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.find(
    (r) => r.id === id
  );
  if (current?.error)
    throw httpError(
      409,
      `${id} did not render (${current.error}); fix it and re-check before approving`
    );
  const batch = meta.batch ?? newBatch(meta.via ?? 'dashboard');
  // No baseline yet (a NEW entry): nothing to snapshot, `before` is null and undo removes the file.
  const { before } = snapshot(P, e, batch);
  // A .psig output carries the render itself as the baseline image, and the environment of that
  // render (the row's, from the check that made it), never this server's or the approver's.
  const report = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] }));
  const renderEnv = current?.env ? (report.envs?.[current.env] ?? null) : null;
  const res = await rust('capture', {
    png: latest,
    out: resolve(P.workspaceRoot, e.sig),
    grid: e.grid ?? manifest.grid ?? 64,
    minCellPx: e.grid ? undefined : manifest.minCellPx,
    detail: e.detail !== false && manifest.detail !== false,
    entry: { id: e.id, story: e.story ?? null, mode: e.mode ?? null, state: e.state ?? null },
    ...(renderEnv ? { env: renderEnv } : {}),
  });
  // The a11y baseline follows the approved render; the old list is kept so an undo can put it back.
  const row = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.find(
    (r) => r.id === id
  );
  /** @type {string[] | null | undefined} */
  let a11yBefore;
  if (row?.a11y?.violations) {
    // a11y.json is pxsig's own file: entry id → accepted rule ids.
    const base = /** @type {A11yBaseline} */ (readJson(P.store.a11y, {}));
    a11yBefore = base[id] ?? null;
    base[id] = row.a11y.violations.map((v) => v.id).sort();
    writeJson(P.store.a11y, base, { pretty: true });
  }
  const logged = record(P, e, {
    batch,
    via: meta.via ?? 'dashboard',
    reason: meta.reason ?? null,
    kind: meta.kind ?? null,
    before,
  });
  return {
    ...res,
    batch,
    after: logged.after,
    ...(a11yBefore !== undefined ? { a11yBefore } : {}),
  };
}

/**
 * Undo one approval made through the server: restore that entry's previous baseline from the
 * batch snapshot (a first baseline goes to trash/), put its a11y baseline back, and log it like
 * `pxsig approve undo`. Refuses, changing nothing, when the baseline was rewritten since.
 * @param {ProjectState} S
 * @param {string} id
 * @param {ReviewEntry & { batch: string }} entry the approval's review.json entry
 * @param {string} [via]
 */
function unapprove(S, id, entry, via = 'dashboard') {
  const { P, manifest } = S;
  const e = manifest.stories.find((s) => s.id === id);
  if (!e) throw httpError(404, `unknown entry ${id}`);
  const before = sha256(paths(P, e).sig);
  const res = undo(P, manifest, entry.batch, {
    git: false,
    ids: [id],
  });
  if (res.refused.length) throw httpError(409, `cannot undo ${id}: ${res.refused[0].why}`);
  if (!res.restored.length && !res.removed.length)
    throw httpError(409, `cannot undo ${id}: nothing in batch ${entry.batch} to restore`);
  record(P, e, {
    batch: `${entry.batch}-undo`,
    via: 'undo',
    reason: `undo ${entry.batch} (dashboard)`,
    before,
    person: PERSON_VIA.has(via),
  });
  if ('a11yBefore' in entry) {
    const base = /** @type {A11yBaseline} */ (readJson(P.store.a11y, {}));
    if (entry.a11yBefore == null) delete base[id];
    else base[id] = entry.a11yBefore;
    writeJson(P.store.a11y, base, { pretty: true });
  }
}

/**
 * @param {ProjectState} S
 * @param {string} action `approve`, `reject` or `unreview`
 * @param {string} id
 * @param {DecisionMeta} [meta]
 */
async function review(S, action, id, meta = {}) {
  needLock(S);
  // review.json is this server's own file.
  const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
  if (action === 'approve') {
    rv[id] = { state: 'approved', at: new Date().toISOString(), ...(await approve(S, id, meta)) };
    // The report says so too, so its counts (failed, changed) agree with the review.
    updateCheckRows(S, (r) =>
      r.id === id
        ? // `approve` just above set the batch.
          { ...r, approved: { at: rv[id].at, batch: /** @type {string} */ (rv[id].batch) } }
        : null
    );
  } else if (action === 'reject')
    rv[id] = { state: 'rejected', at: new Date().toISOString(), via: meta.via ?? 'dashboard' };
  else if (action === 'unreview') {
    agentMayClear(meta, rv[id]?.state);
    if (rv[id]?.state === 'approved' && rv[id].batch)
      // An approval with its batch: checked just above.
      unapprove(
        S,
        id,
        /** @type {ReviewEntry & { batch: string }} */ (rv[id]),
        meta.via ?? 'dashboard'
      );
    delete rv[id];
    updateCheckRows(S, (r) =>
      r.id === id && r.approved ? (({ approved: _approved, ...rest }) => rest)(r) : null
    );
  } else throw httpError(404, 'unknown action');
  S.quietUntil = Date.now() + 800;
  writeJson(S.reviewPath, rv, { pretty: true });
  console.log(`[serve] ${S.name}: ${action} ${id} (via ${meta.via ?? 'dashboard'})`);
  broadcast('review', { project: S.name, id, entry: rv[id] ?? null });
  return rv[id] ?? null;
}

/**
 * Approve every entry of one story that waits for a decision (each mode and state), in one batch:
 * a person's single click in the dashboard, with `approvals.byStory` on. Entries that passed, did not render, were rejected or
 * are already approved are left out, with why. Each approval is logged and undone like any other.
 * @param {ProjectState} S
 * @param {string} story
 * @param {DecisionMeta} [meta]
 */
async function approveStory(S, story, meta = {}) {
  if (!byStory(S.P.config)) throw httpError(403, BY_STORY_OFF);
  needLock(S);
  if (!S.running) S.reload();
  const entries = S.manifest.stories.filter((e) => (e.story ?? e.id) === story);
  if (!entries.length) throw httpError(404, `unknown story ${story}`);
  const rows = new Map(
    /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.map((r) => [r.id, r])
  );
  const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
  const batch = meta.batch ?? newBatch(meta.via ?? 'dashboard');
  /** @type {string[]} */
  const approved = [];
  /** @type {{ id: string, why: string }[]} */
  const skipped = [];
  for (const e of entries) {
    const why = storySkip(rv[e.id]?.state, rows.get(e.id));
    if (why) {
      skipped.push({ id: e.id, why });
      continue;
    }
    try {
      await review(S, 'approve', e.id, { ...meta, batch });
      approved.push(e.id);
    } catch (err) {
      // review throws Errors (httpError, or the engine's).
      skipped.push({ id: e.id, why: /** @type {Error} */ (err).message });
    }
  }
  console.log(
    `[serve] ${S.name}: approve story ${story}: ${approved.length} approved, ${skipped.length} left (batch ${batch})`
  );
  return { story, batch, approved, skipped };
}

// --- on-demand checks (dashboard, addon, watch) ----------------------------------------------
/** @param {ProjectState} S */
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
      // The manifest stopped loading since these ids were queued: say why, render nothing.
      // Rejected rather than thrown: it lands after `S.running` is set, so `finally` clears it.
      if (!S.runPath)
        await Promise.reject(
          Object.assign(
            new Error(`setup error: the manifest did not load — ${S.error}. Nothing was rendered.`),
            { setup: true }
          )
        );
      const manifest = S.manifest;
      const entries = manifest.stories.filter((e) => ids.includes(e.id));
      // Guard: a broken Storybook index makes every render its error page. Refuse, record nothing.
      const idx = await fetchStoryIndex(manifest.baseUrl);
      if (!idx.healthy)
        throw Object.assign(
          new Error(
            `setup error: ${idx.reachable ? "Storybook's story index is broken" : 'Storybook is not reachable'} — ${idx.error}. Nothing was rendered.`
          ),
          { setup: true }
        );
      pool ??= browserPool(P);
      const concurrency = Math.min(8, entries.length);
      const envCfg = envConfig(P.config);
      const engineVersion = await rust('ping', {})
        .then((p) => p.version ?? null)
        .catch(() => null);
      const current = await pool.envs(
        entries.map((e) => e.browser ?? 'chromium'),
        { fontProbe: envCfg.fontProbe, pxsig: PXSIG_VERSION, engine: engineVersion }
      );
      const { results, wallMs, reloads } = await renderStories(pool, entries, P.store.latest, {
        ...manifest,
        concurrency,
        project: P,
        a11y: true,
      });
      const sbErrors = results.filter((r) => r.error?.startsWith(STORYBOOK_ERROR));
      if (storybookBroken(sbErrors.length, results.length))
        throw Object.assign(
          new Error(
            `setup error: ${sbErrors.length} of ${results.length} renders hit Storybook's error page (${/** @type {string} */ (sbErrors[0].error).slice(STORYBOOK_ERROR.length).trim()}). Nothing was recorded.`
          ),
          { setup: true }
        );
      if (manifest.trim)
        await rust('trim', {
          dir: P.store.latest,
          only: ids,
          pad: manifest.trim.pad ?? 16,
          tolerance: manifest.trim.tolerance ?? 8,
        });
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
        console.error(
          `[serve] ${S.name}: ${g.count} failing entries rendered the same image (${g.ids.slice(0, 3).join(', ')}…): marked as errors, nothing to approve`
        );
      const rustRows = new Map(res.results.map((r) => [r.id, r]));
      const renders = new Map(results.map((r) => [r.id, r]));
      const a11yBase = /** @type {A11yBaseline | null} */ (readJson(P.store.a11y, null));
      const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
      for (const id of ids) delete rv[id]; // a fresh verdict replaces a decision on the old one
      writeJson(S.reviewPath, rv, { pretty: true });
      const av = /** @type {A11yReviewFile} */ (readJson(S.a11yReviewPath, {}));
      for (const id of ids) delete av[id];
      writeJson(S.a11yReviewPath, av, { pretty: true });
      const envs = { ...res.baselineEnvs, ...byId(current) };
      const fresh = new Map(
        entries.map((e) => [
          e.id,
          annotateRow(buildRow(e, rustRows.get(e.id), renders.get(e.id), a11yBase, manifest), {
            current,
            envs,
            ignore: envCfg.ignore,
          }),
        ])
      );
      const full = entries.length === manifest.stories.length;
      const timing = full
        ? {
            concurrency,
            renderWallMs: wallMs,
            pageLoads: reloads,
            rustEngineMs: res.summary.elapsedMs,
            totalMs: performance.now() - t0,
          }
        : null;
      updateCheckRows(S, (r) => fresh.get(r.id), fresh, timing, envs);
      const failed = [...fresh.values()].filter((r) => !r.pass).length;
      console.log(
        `[serve] ${S.name}: re-checked ${ids.length} entries · ${failed} changed · ${((performance.now() - t0) / 1000).toFixed(1)} s (Rust ${res.summary.elapsedMs.toFixed(0)} ms)`
      );
      broadcast('check', {
        project: S.name,
        state: 'done',
        ids,
        failed,
        ms: performance.now() - t0,
      });
      broadcast('data', { project: S.name });
    } catch (e) {
      // What a check throws is an Error: a setup error carries `setup`.
      console.error(`[serve] ${S.name}: check failed: ${/** @type {SetupError} */ (e).message}`);
      S.lastFailure = {
        seq,
        error: /** @type {SetupError} */ (e).message,
        setup: !!(/** @type {SetupError} */ (e).setup),
        ids: ids.length,
        at: new Date().toISOString(),
      };
      broadcast('check', {
        project: S.name,
        state: 'error',
        ids,
        error: /** @type {SetupError} */ (e).message,
        setup: !!(/** @type {SetupError} */ (e).setup),
      });
    } finally {
      S.running = null;
      S.checking = null;
      if (S.queued.size) void runChecks(S);
      else scheduleIntegrity(S, 'check', 0);
    }
  })();
  return S.running;
}

// --- accessibility decisions -------------------------------------------------------------------
// Separate from the visual verdict: accepting puts an entry's current axe violations on its
// accepted list (<store>/a11y.json); rejecting marks them for a fix. Both last until the next
// check of the entry, like review.json. Every accept and undo is logged beside a11y.json.

/**
 * @param {Project} P
 * @param {Record<string, unknown> & { via: string }} line
 */
const a11yLog = (P, line) =>
  appendLine(join(dirname(P.store.a11y), 'a11y-decisions.ndjson'), stamp(line));
/**
 * @param {Project} P
 * @param {A11yBaseline} base
 */
const writeA11y = (P, base) => writeJson(P.store.a11y, base, { pretty: true });

/**
 * @param {ProjectState} S
 * @param {string} action `a11y-accept`, `a11y-reject`, `a11y-unaccept` or `a11y-unreview`
 * @param {string} id
 * @param {DecisionMeta} [meta]
 */
function a11yReview(S, action, id, meta = {}) {
  needLock(S);
  const { P, manifest } = S;
  if (!manifest.stories.some((e) => e.id === id)) throw httpError(404, `unknown entry ${id}`);
  // a11y-review.json and a11y.json are pxsig's own files.
  const av = /** @type {A11yReviewFile} */ (readJson(S.a11yReviewPath, {}));
  const base = /** @type {A11yBaseline} */ (readJson(P.store.a11y, {}));
  const at = new Date().toISOString();
  const by = who(P.workspaceRoot, P.config);
  const via = meta.via ?? 'dashboard';
  if (action === 'a11y-accept') {
    const row = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.find(
      (r) => r.id === id
    );
    if (!row?.a11y?.violations)
      throw httpError(409, `no accessibility results for ${id}; run a check`);
    const before = base[id] ?? null;
    const after = row.a11y.violations.map((v) => v.id).sort();
    base[id] = after;
    writeA11y(P, base);
    a11yLog(P, { at, by, via, action: 'accept', id, before, after, reason: meta.reason ?? null });
    av[id] = { state: 'accepted', at, before };
  } else if (action === 'a11y-reject') av[id] = { state: 'rejected', at, via };
  else if (action === 'a11y-unaccept') {
    // Take a rule (or every rule) off the accepted list: the report shows it as new at once.
    const current = base[id] ?? [];
    const after = current.filter((r) => meta.rule && r !== meta.rule);
    if (after.length === current.length)
      throw httpError(409, `${meta.rule ?? 'nothing'} is not on the accepted list of ${id}`);
    base[id] = after;
    writeA11y(P, base);
    a11yLog(P, {
      at,
      by,
      via,
      action: 'unaccept',
      id,
      before: current,
      after,
      rule: meta.rule ?? null,
    });
    delete av[id];
    updateCheckRows(S, (r) =>
      r.id === id && r.a11y?.violations
        ? {
            ...r,
            a11y: {
              ...r.a11y,
              baseline: after,
              new: r.a11y.violations.filter((v) => !after.includes(v.id)).length,
            },
          }
        : null
    );
  } else if (action === 'a11y-unreview') {
    const prev = av[id];
    agentMayClear(meta, prev?.state);
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
  writeJson(S.a11yReviewPath, av, { pretty: true });
  console.log(`[serve] ${S.name}: ${action} ${id} (via ${via})`);
  broadcast('review', { project: S.name, id, a11y: av[id] ?? null });
  return av[id] ?? null;
}

/**
 * `pxsig a11y --prune` through the server that holds the store (lib/prune.mjs): the person
 * confirmed the plan at the terminal; the plan is pinned to a11y.json, so a decision made since
 * refuses it whole. The dashboard reloads its data.
 * @param {ProjectState} S
 * @param {RequestBody} body `{ plan, batch, reason? }`
 * @param {string} via how it reached the server (lib/guard.mjs `authorize`)
 */
function a11yPrune(S, body, via) {
  needLock(S);
  /**
   * @param {unknown} v
   * @param {number} max
   */
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const batch = s(body.batch, 80)?.replace(/[^\w.-]/g, '') || newBatch('prune');
  // Errors carry their status (400 a bad plan, 409 a11y.json changed since it was made).
  // `applyPrune` checks the plan (`checkPlan`).
  const r = applyPrune(S.P, /** @type {import('./types/t2.js').PlanInput} */ (body.plan), {
    batch,
    reason: s(body.reason, 500),
    via,
    lockCheck: () => needLock(S),
  });
  S.quietUntil = Date.now() + 800;
  console.log(
    `[serve] ${S.name}: pruned ${r.rules} accepted a11y rules from ${r.entries} entries (batch ${batch}, via ${via})`
  );
  broadcast('data', { project: S.name });
  return { batch, entries: r.entries, rules: r.rules };
}

/**
 * Queue a check. Names (ids or stories) the manifest does not have are registered first when
 * Storybook is healthy (NEW entries, no signature), so checking a new story is one request;
 * anything that cannot be registered comes back in `skipped`, with why.
 * @param {ProjectState} S
 * @param {RequestBody} body `{ ids?, story?, stories?, all?, via? }`
 * @returns {Promise<Enqueued>}
 */
async function enqueue(S, body) {
  needLock(S);
  // Select against the manifest on disk: entries added since the server started (or since the
  // last check) would otherwise be dropped as unknown. A running check keeps the one it started with.
  if (!S.running) S.reload();
  /** @param {unknown} v */
  const asked = (v) =>
    Array.isArray(v) ? v.filter((/** @type {unknown} */ x) => typeof x === 'string') : [];
  const ids = new Set(asked(body.ids));
  const stories = new Set([
    ...asked(body.stories),
    ...(typeof body.story === 'string' ? [body.story] : []),
  ]);
  /** @param {string} name */
  const known = (name) =>
    S.manifest.stories.some((e) => e.id === name || (e.story ?? e.id) === name);
  const unknown = [...new Set([...ids, ...stories])].filter((n) => !known(n));
  /** @type {Awaited<ReturnType<typeof registerNamed>>} */
  let registered = { added: [], stories: [], skipped: [] };
  if (unknown.length && !body.all) {
    const index = await loadStoryIndex(S.ctx);
    registered = await registerNamed(S.ctx, unknown, {
      index,
      harvest: defaultHooks(S.ctx).harvest,
      via:
        typeof body.via === 'string'
          ? body.via.replace(/[^\w-]/g, '').slice(0, 20) || 'server'
          : 'server',
    });
    if (registered.added.length) {
      S.reload();
      console.log(
        `[serve] ${S.name}: registered ${registered.stories.join(', ')} (${registered.added.length} NEW entries) to check them`
      );
    }
    for (const story of registered.stories) stories.add(story);
  }
  for (const e of S.manifest.stories) if (body.all || stories.has(e.story ?? e.id)) ids.add(e.id);
  const queued = [...ids].filter((id) => S.manifest.stories.some((e) => e.id === id));
  queued.forEach((id) => S.queued.add(id));
  void runChecks(S);
  if (registered.added.length) scheduleIntegrity(S, 'registered', 0);
  return { queued, registered: registered.added, skipped: registered.skipped };
}

/** Per-story status for the addon's sidebar, across every project (story ids are per Storybook). */
function statuses() {
  /** @type {Record<string, StoryStatus>} */
  const out = {};
  /** @type {Record<string, number>} */
  const rank = {
    error: 5,
    changed: 4,
    rejected: 4,
    flaky: 3,
    drift: 2,
    approved: 1,
    pass: 0,
    skipped: 0,
  };
  for (const S of states.values()) {
    const check = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] }));
    const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
    for (const r of check.rows) {
      // Every row buildRow writes names its story (lib/rows.mjs).
      const s = (out[/** @type {string} */ (r.story)] ??= {
        status: 'pass',
        project: S.name,
        entries: [],
      });
      const st =
        rv[r.id]?.state ??
        (r.skipped
          ? 'skipped'
          : r.error
            ? 'error'
            : r.flaky
              ? 'flaky'
              : r.pass
                ? // check.json's `metrics` (docs/spec.md section 4): the engine's numbers.
                  /** @type {{ ssim: number } | undefined} */ (r.metrics) &&
                  /** @type {{ ssim: number }} */ (r.metrics).ssim < 1
                  ? 'drift'
                  : 'pass'
                : 'changed');
      s.entries.push({
        id: r.id,
        mode: r.mode,
        state: st,
        ssim: /** @type {{ ssim?: number } | undefined} */ (r.metrics)?.ssim ?? null,
        reasons: r.reasons ?? [],
      });
      if ((rank[st] ?? 0) > (rank[s.status] ?? 0)) s.status = st;
    }
  }
  return out;
}

/** Per-story integrity for the addon: the worst status of the story's entries, with their codes. */
function storyIntegrity() {
  /** @type {Record<string, StoryIntegrity | undefined>} */
  const out = {};
  /** @type {Record<string, number>} */
  const sev = { error: 0, warn: 1, info: 2 };
  for (const S of states.values()) {
    if (!S.integrity) continue;
    for (const x of S.integrity.entries) {
      const s = (out[x.story] ??= /** @type {StoryIntegrity} */ ({
        status: 'ok',
        severity: 'info',
        project: S.name,
        component: x.component,
        codes: {},
      }));
      for (const i of x.issues) s.codes[i.code] = (s.codes[i.code] ?? 0) + 1;
      if (sev[x.severity] < sev[s.severity] || (x.severity === s.severity && s.status === 'ok'))
        Object.assign(s, { status: x.status, severity: x.severity });
    }
  }
  return out;
}

// --- integrity: always on ------------------------------------------------------------------------
/**
 * @param {ProjectState} S
 * @param {string} why
 */
async function runIntegrity(S, why) {
  if (S.integrityRunning || S.running) return scheduleIntegrity(S, why, 1500);
  S.integrityRunning = true;
  /** @type {((value?: unknown) => void) | undefined} */
  let done;
  S.integrityDone = new Promise((r) => (done = r));
  try {
    S.reload();
    pruneStaleRows(S);
    const idx = await loadStoryIndex(S.ctx);
    const ledger = await reconcile(S.ctx, { index: idx, affected: S.affected });
    const before = S.integrity?.summary?.headline;
    S.integrity = ledger;
    // The ledger is the store's file: only the lock holder writes it (a second, read-only server
    // beside another process's keeps its ledger in memory).
    if (S.lock) {
      S.quietUntil = Date.now() + 800;
      writeLedger(S.ctx, ledger);
    }
    if (before !== ledger.summary.headline)
      console.log(`[serve] ${S.name}: ${oneLine(ledger)} (${why}, ${ledger.elapsedMs} ms)`);
    broadcast('integrity', { project: S.name, summary: ledger.summary, setup: ledger.setup });
  } catch (e) {
    // reconcile throws Errors (no readable manifest, an engine error).
    console.error(`[serve] ${S.name}: integrity failed: ${/** @type {Error} */ (e).message}`);
  } finally {
    S.integrityRunning = false;
    // Set by the promise's executor, which runs at once.
    /** @type {(value?: unknown) => void} */ (done)();
  }
}
/**
 * @param {ProjectState} S
 * @param {string} why
 * @param {number} [ms]
 */
function scheduleIntegrity(S, why, ms = 1500) {
  // clearTimeout(null) does nothing, as clearTimeout(undefined) does.
  clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (S.integrityTimer));
  S.integrityTimer = setTimeout(() => runIntegrity(S, why), ms);
}
/**
 * @param {string} dir
 * @param {(file: string) => void} onChange
 * @param {(file: string) => boolean} [filter]
 */
const watchFor = (dir, onChange, filter = () => true) => {
  if (!existsSync(dir)) return;
  try {
    watch(dir, { recursive: true }, (_, file) => {
      if (!file || /(^|\/)(\.|node_modules\/)/.test(file) || !filter(file)) return;
      onChange(file);
    });
  } catch (e) {
    // fs.watch throws Errors (no recursive watch on this platform, too many watchers).
    console.error(
      `[serve] cannot watch ${relPath(ws.root, dir)}: ${/** @type {Error} */ (e).message}`
    );
  }
};
for (const S of states.values()) {
  const { P } = S;
  /** @param {string} why */
  const later = (why) => () => scheduleIntegrity(S, why);
  watchFor(P.srcRoot, later('source changed'), (f) => /\.(tsx?|jsx?|mjs|css|json|mdx)$/.test(f));
  watchFor(P.store.baselines, later('baselines changed'));
  watchFor(join(P.store.root, 'renders'), later('renders changed'), (f) => f.startsWith('latest'));
  watchFor(P.store.root, later('manifest changed'), (f) => /^manifest(\..+)?\.json$/.test(f));
  /** @type {NodeJS.Timeout | null} */
  let dataTimer = null;
  watchFor(
    P.store.reports,
    (file) => {
      if (Date.now() < S.quietUntil || file.startsWith('.run')) return;
      // clearTimeout(null) does nothing, as clearTimeout(undefined) does.
      clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (dataTimer));
      dataTimer = setTimeout(() => broadcast('data', { project: S.name }), 300);
    },
    (f) => /\.(nd)?json$/.test(f)
  );
}

/**
 * Safe repairs, as the dashboard's button asks: plan, or apply (never prune, never approve).
 * @param {ProjectState} S
 * @param {{ apply?: boolean, only?: unknown, stale?: boolean }} [opts] `only`: the request's, any JSON value
 */
async function repair(S, { apply = false, only: onlySteps, stale = false } = {}) {
  const ledger = await reconcile(S.ctx, { affected: S.affected });
  const plan = planRepairs(ledger, {
    only: Array.isArray(onlySteps)
      ? onlySteps.filter((/** @type {unknown} */ a) => a !== 'prune')
      : undefined,
    prune: false,
    server: { up: true },
    stale,
  });
  if (!apply) return { plan };
  needLock(S);
  if (S.repairing) throw httpError(409, 'a repair is already running');
  const hooks = {
    ...defaultHooks(S.ctx, { serverUrl: url }),
    // Re-checks go through this server's own queue (warm browsers), then wait for it to drain.
    /** @param {string[]} ids */
    async recheck(ids) {
      const from = S.runs;
      await enqueue(S, { ids });
      while (S.running || S.queued.size)
        await (S.running ?? new Promise((r) => setTimeout(r, 200)));
      // A run that failed (Storybook down, a broken index) recorded nothing: say so.
      if (S.lastFailure && S.lastFailure.seq > from) throw new Error(S.lastFailure.error);
      return { via: 'server' };
    },
  };
  S.repairing = applyRepairs(S.ctx, plan, {
    hooks,
    via: 'dashboard',
    reconcileOpts: { affected: S.affected },
  });
  try {
    const res = await S.repairing;
    S.integrity = res.ledger;
    writeLedger(S.ctx, res.ledger);
    broadcast('integrity', {
      project: S.name,
      summary: res.ledger.summary,
      setup: res.ledger.setup,
    });
    broadcast('data', { project: S.name });
    console.log(
      `[serve] ${S.name}: repair: ${res.steps.map((s) => `${s.action} → ${s.result}`).join(' · ') || 'nothing to do'}`
    );
    return { plan, applied: res.steps, summary: res.ledger.summary };
  } finally {
    S.repairing = null;
  }
}

// --- watch mode: edits re-check only what they can affect --------------------------------------
if (flags.watch) {
  for (const S of states.values()) {
    const src = S.P.srcRoot;
    /** @type {Set<string>} */
    const changed = new Set();
    /** @type {NodeJS.Timeout | null} */
    let t = null;
    watchFor(
      src,
      (file) => {
        changed.add(relPath(ws.root, join(src, file)));
        // clearTimeout(null) does nothing, as clearTimeout(undefined) does.
        clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (t));
        // Give Storybook's dev server a moment to rebuild before we render.
        t = setTimeout(async () => {
          const files = [...changed];
          changed.clear();
          try {
            if (!S.runPath) return;
            const a = await rust('affected', { manifest: S.runPath, root: ws.root, files });
            // Watch is not a gate: it re-checks what the edits trace to, and names what it cannot trace
            // (the gates would check everything for those; docs/ci.md).
            const ids = a.traced ?? a.ids;
            console.log(
              `[serve] ${S.name}: watch: ${files.join(', ')} → ${ids.length} entries (${a.failSafe?.length ? 'traced only' : a.reason})`
            );
            for (const f of a.failSafe ?? [])
              console.log(
                `[serve] ${S.name}: watch: not traced: ${f.why} (a gate would check every entry)`
              );
            broadcast('watch', { project: S.name, files, ids: ids.length });
            if (ids.length) await enqueue(S, { ids });
          } catch (e) {
            // The engine's and enqueue's errors are Errors.
            console.error(`[serve] ${S.name}: watch: ${/** @type {Error} */ (e).message}`);
          }
        }, 900);
      },
      (f) => !/(^|\/)(__pxsig__|node_modules)\//.test(f)
    );
    console.log(
      `[serve] ${S.name}: watching ${relPath(ws.root, src)} — edits re-check affected entries`
    );
  }
}

// --- http ----------------------------------------------------------------------------------------
/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
const cors = (req, res) => {
  const o = req.headers.origin;
  if (o && allowedOrigins.has(o)) {
    res.setHeader('access-control-allow-origin', o);
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    // Never x-pxsig-token: another origin cannot send a decision.
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('vary', 'origin');
  }
};
/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': TYPES['.json'],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
};
/**
 * The request's JSON body (`{}` when empty); a body that does not parse rejects with status 400.
 * @param {IncomingMessage} req
 * @returns {Promise<RequestBody>}
 */
const readBody = (req) =>
  new Promise((ok, fail) => {
    let s = '';
    req.on('data', (/** @type {Buffer} */ c) => {
      s += c;
      if (s.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        // Whatever the client sent: every key is checked where it is read.
        ok(s ? /** @type {RequestBody} */ (JSON.parse(s)) : {});
      } catch (e) {
        // JSON.parse throws a SyntaxError.
        fail(Object.assign(/** @type {SyntaxError} */ (e), { status: 400 }));
      }
    });
  });

const projectsList = () =>
  [...states.values()].map((S) => ({
    name: S.name,
    label: S.P.label ?? null,
    root: relPath(ws.root, S.P.root) || '.',
    storybook: S.P.storybook.url,
    entries: S.manifest.stories.length,
    integrity: S.integrity?.summary ?? null,
    error: S.error ?? null,
    locked: S.lock ? 'held' : S.lockWait,
  }));

/**
 * `/__pxsig/<action>`.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} action
 * @param {URLSearchParams} q
 */
async function api(req, res, action, q) {
  if (action === 'events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('event: hello\ndata: {}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (action === 'projects')
    return json(res, 200, { workspace: ws.root, projects: projectsList() });
  if (action === 'status')
    return json(res, 200, {
      served: true,
      projects: projectsList(),
      // Truthiness only: is a check (a promise) running. The parameter's type says so.
      running: [...states.values()].some((/** @type {{ running: unknown }} */ S) => S.running),
      queued: [...states.values()].reduce((n, S) => n + S.queued.size, 0),
      repairing: [...states.values()].some(
        (/** @type {{ repairing: unknown }} */ S) => S.repairing
      ),
      // Every project's review.json (this server's own files), merged.
      review: /** @type {ReviewFile} */ (
        Object.assign(
          {},
          ...[...states.values()].map((S) => /** @type {ReviewFile} */ (readJson(S.reviewPath, {})))
        )
      ),
      stories: statuses(),
      integrity: storyIntegrity(),
      integritySummary: Object.fromEntries(
        [...states.values()]
          .filter((S) => S.integrity)
          // Filtered just above to the projects with a ledger.
          .map((S) => [
            S.name,
            {
              .../** @type {IntegrityLedger} */ (S.integrity).summary,
              setup: /** @type {IntegrityLedger} */ (S.integrity).setup,
              generatedAt: /** @type {IntegrityLedger} */ (S.integrity).generatedAt,
            },
          ])
      ),
      dashboard: `${url}/report/`,
      // Listening, so `url` is set.
      approving: approving(req.headers, links, /** @type {string} */ (url), ws.root),
    });
  if (req.method === 'GET') {
    const S = stateFor({ project: q.get('project'), story: q.get('story') });
    if (action === 'data') return json(res, 200, buildData(S.P));
    if (action === 'integrity') {
      if (!S.integrity || q.get('fresh')) {
        // A run already going (startup, a file change) answers this request too: wait for it.
        if (S.integrityRunning) await S.integrityDone;
        else await runIntegrity(S, 'request');
      }
      if (!S.integrity) return json(res, 503, { error: 'integrity not computed yet' });
      const story = q.get('story');
      if (story)
        return json(res, 200, {
          story,
          // The story's status across projects. Its `project` (the first project with an entry of
          // that story) is overridden: the answer is about the project asked about.
          .../** @type {Partial<StoryIntegrity>} */ (
            storyIntegrity()[story] ?? { status: 'unknown' }
          ),
          project: S.name,
          entries: S.integrity.entries.filter((x) => x.story === story),
        });
      const f =
        q.get('component') || q.get('status')
          ? filterLedger(S.integrity, { component: q.get('component'), status: q.get('status') })
          : null;
      return json(res, 200, f ? { ...S.integrity, ...f } : S.integrity);
    }
    return json(res, 405, { error: 'POST only' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  // The dashboard link: the page trades its ticket once for the cookie decisions carry.
  if (action === 'session') {
    if (!sameOriginPage(req.headers, `http://${req.headers.host}`))
      return json(res, 403, { error: 'the dashboard link is opened by the dashboard page only' });
    const session = links.redeem((await readBody(req)).ticket);
    if (!session)
      return json(res, 403, {
        error: LINK_EXPIRED,
      });
    res.setHeader(
      'set-cookie',
      linkSetCookie(/** @type {AddressInfo} */ (server.address()).port, session)
    );
    return json(res, 200, { ok: true });
  }
  // `pxsig serve --link` (a person at a terminal, with the CLI's token) asks for a fresh link.
  if (action === 'ticket') {
    if (!mayMintTicket(req.headers, TOKENS)) return json(res, 403, { error: NEEDS_PERSON });
    return json(res, 200, { link: dashboardLink(`${url}/report/`) });
  }
  // Same-origin, or a project's Storybook (the addon, checks only): a page on any other site must
  // not write. Decisions also need the token: a person in the dashboard, or `pxsig approve apply`.
  const auth = authorize({
    action,
    headers: req.headers,
    tokens: TOKENS,
    links,
    port: /** @type {AddressInfo} */ (server.address()).port,
    ownOrigin: `http://${req.headers.host}`,
    allowedOrigins,
  });
  if (!auth.ok) {
    console.error(`[serve] refused POST /__pxsig/${action}: ${auth.error}`);
    return json(res, auth.status, { error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }
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
    return json(res, 202, {
      ok: true,
      queued,
      registered: results.flatMap((r) => r.registered),
      skipped: targets.length > 1 ? skipped.filter((x) => !named.has(x.name)) : skipped,
    });
  }
  const S = stateFor(body);
  if (action === 'repair')
    return json(
      res,
      200,
      await repair(S, { apply: body.apply === true, only: body.only, stale: body.stale === true })
    );
  if (action === 'a11y-prune')
    // A decision (lib/guard.mjs DECISIONS): `authorize` let it through only with its `via` set.
    return json(res, 200, {
      ok: true,
      project: S.name,
      ...a11yPrune(S, body, /** @type {string} */ (auth.via)),
    });
  if (action === 'approve-story') {
    const { story } = body;
    if (typeof story !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+$/.test(story))
      return json(res, 400, { error: 'bad story' });
    /**
     * @param {unknown} v
     * @param {number} max
     */
    const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    // `via` is how the decision reached the server (the token it carried), never the body's word.
    return json(res, 200, {
      ok: true,
      project: S.name,
      ...(await approveStory(S, story, { via: auth.via, reason: s(body.reason, 500) })),
    });
  }
  const { id } = body;
  if (typeof id !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/.test(id))
    return json(res, 400, { error: 'bad id' });
  /**
   * @param {unknown} v
   * @param {number} max
   */
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const meta = {
    batch: s(body.batch, 80)?.replace(/[^\w.-]/g, ''),
    via: auth.via,
    reason: s(body.reason, 500),
    kind: s(body.kind, 16),
    rule: s(body.rule, 80)?.replace(/[^\w-]/g, ''),
  };
  if (action.startsWith('a11y-'))
    return json(res, 200, {
      ok: true,
      project: S.name,
      id,
      entry: a11yReview(S, action, id, meta),
    });
  json(res, 200, { ok: true, project: S.name, id, entry: await review(S, action, id, meta) });
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} file
 */
const sendFile = (req, res, file) => {
  const st = statSync(file);
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': 'no-cache',
    'last-modified': st.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
};
/**
 * @param {string} root
 * @param {string} file
 */
const inside = (root, file) => file === root || file.startsWith(root + sep);

/**
 * /p/<project>/… : a project's renders, diffs, baseline images (out of the .psig) and headers.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} name
 * @param {string} rest
 */
function projectFile(req, res, name, rest) {
  const S = states.get(name);
  if (!S) return json(res, 404, { error: `no project "${name}"` });
  const { P } = S;
  /** @param {string} id */
  const entryOf = (id) => S.manifest.stories.find((e) => e.id === id);
  let m = rest.match(/^renders\/base\/(.+)\.png$/);
  if (m) {
    const e = entryOf(m[1]);
    const img = e && readImage(resolve(P.workspaceRoot, e.sig));
    if (!img) return json(res, 404, { error: 'no baseline image' });
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': img.length,
      'cache-control': 'no-cache',
    });
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
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory())
      return json(res, 404, { error: 'not found' });
    return sendFile(req, res, file);
  }
  return json(res, 404, { error: 'not found' });
}

const server = createServer(async (req, res) => {
  try {
    // A Host that is not loopback is a DNS-rebinding page posing as same-origin.
    if (!loopbackHost(req.headers.host, /** @type {AddressInfo} */ (server.address()).port))
      return json(res, 403, { error: 'unknown host' });
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    // A request the server received always has its URL (only a client's request lacks one).
    const u = new URL(/** @type {string} */ (req.url), 'http://localhost');
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
      if (!existsSync(file))
        return json(res, 404, {
          error: existsSync(dashboardDir)
            ? 'not found'
            : `the dashboard is not built (${dashboardDir})`,
        });
      if (file === join(dashboardDir, 'index.html')) {
        // Served pages fetch live data: drop whatever a static build inlined.
        const html = readFileSync(file, 'utf8').replace(
          /<script id="pxsig-data">[\s\S]*?<\/script>/,
          ''
        );
        // No token is ever in the page: decisions carry the dashboard link's cookie instead.
        res.writeHead(200, {
          'content-type': TYPES['.html'],
          'cache-control': 'no-store',
          ...pageHeaders(allowedOrigins),
        });
        return res.end(html);
      }
      return sendFile(req, res, file);
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    // What the handlers throw is an Error, an httpError carrying its status.
    if (!res.headersSent)
      json(res, /** @type {HttpError} */ (e).status || 500, {
        error: /** @type {HttpError} */ (e).message,
      });
  }
});

// --- open (or reuse) a browser tab ---------------------------------------------------------------
/** @param {string} target */
function openBrowser(target) {
  // Windows: no program is started to open a link (it would take a shell); the link is printed.
  if (process.platform === 'win32') return console.log('[serve] open the link above in a browser');
  if (process.platform !== 'darwin') return execFile('xdg-open', [target], () => {});
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
    // No `encoding` option: Node's default, utf8, makes `out` a string.
    if (!err && /** @type {string} */ (out).trim() === 'reused')
      return console.log('[serve] reloaded the open dashboard tab');
    execFile('open', [target], () => {});
  });
}

/** @type {string | null} */
let url = null;
const info = serverFile(ws.root);
/**
 * @param {number} port
 * @param {number} [tries]
 */
function listen(port, tries = 10) {
  /** @param {NodeJS.ErrnoException} e */
  const onError = (e) => {
    server.off('listening', onListening);
    if (e.code === 'EADDRINUSE' && tries > 0) return listen(port + 1, tries - 1);
    console.error(`[serve] ${e.message}`);
    process.exit(2);
  };
  const onListening = () => {
    server.off('error', onError);
    url = `http://127.0.0.1:${/** @type {AddressInfo} */ (server.address()).port}`;
    // The CLI, the MCP and the addon find the server through this file: a second server (on
    // another port, read-only beside the one holding the stores) leaves a live server's record.
    // server.json is what a pxsig server wrote.
    const recorded = /** @type {ServerRecord | null} */ (readJson(info, null));
    if (recorded?.pid && recorded.pid !== process.pid && alive(recorded.pid))
      console.log(
        `[serve] ${relPath(ws.root, info)} names the running server at ${recorded.url} (pid ${recorded.pid}): left as it is`
      );
    else {
      mkdirSync(dirname(info), { recursive: true });
      writeJson(
        info,
        {
          url,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          projects: [...states.keys()],
        },
        { pretty: true }
      );
    }
    for (const S of states.values()) S.lock?.update({ url });
    mkdirSync(dirname(info), { recursive: true });
    writeToken(ws.root, url, TOKENS.cli);
    writeToken(ws.root, url, TOKENS.mcp, 'mcp');
    const page = `${url}/report/${flags.tab ? `#${flags.tab}` : ''}`;
    console.log(
      `[serve] pxsig dashboard → ${page}  (${[...states.keys()].join(', ')}; Ctrl+C to stop)`
    );
    // The dashboard link goes only to a person at this terminal: an agent or a background start
    // reads this output, and with the link it could approve from a browser it drives.
    const person = humanAtTerminal();
    const link = person ? dashboardLink(`${url}/report/`, flags.tab ?? null) : null;
    console.log(`[serve] ${link ? `dashboard link: ${link}\n${LINK_TIMING}` : LINK_ELSEWHERE}`);
    if (!flags['no-open']) openBrowser(link ?? page);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
}

const shutdown = async () => {
  for (const S of states.values()) S.lock?.release();
  engine?.kill();
  await pool?.close();
  rmSync(join(tmpdir(), `pxsig-serve-${process.pid}`), { recursive: true, force: true });
  if (url) {
    removeToken(ws.root, url, TOKENS.cli);
    removeToken(ws.root, url, TOKENS.mcp, 'mcp');
  }
  try {
    if (/** @type {Partial<ServerRecord>} */ (readJson(info, {})).pid === process.pid) rmSync(info);
  } catch {
    // already gone
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Ctrl+Break in a Windows console (Ctrl+C arrives as SIGINT there too).
process.on('SIGBREAK', shutdown);

await rust('ping', {}).then((p) =>
  console.log(`[serve] Rust engine up (pxsig ${p.version}, ${p.threads} threads)`)
);
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
for (const S of states.values()) void runIntegrity(S, 'startup');
