/**
 * serve/projects.mjs — the server's projects: what it keeps for each (`ProjectState`), opening
 * one, picking the one a request means, the list it answers, and each project's store lock.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from '../lib/files.mjs';
import { resolveContext } from '../lib/integrity.mjs';
import { acquireLock, describeLock, LockError } from '../lib/lock.mjs';
import { shownPath } from '../lib/paths.mjs';
import { flagLayer, loadProject, writeRunManifest } from '../lib/workspace.mjs';
import { httpError } from './http.mjs';
import { scheduleIntegrity } from './integrity.mjs';
/** @import { IntegrityContext, reconcile } from '../lib/integrity.mjs' */
/** @import { applyRepairs } from '../lib/repair.mjs' */
/** @import { LockHandle, Project, ProjectRef, RunManifest } from '../types.js' */
/** @import { ProjectQuery } from '../types/t5.js' */
/** @import { ServeContext } from '../types/serve.js' */
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

/**
 * Everything the server keeps for one project.
 * @param {ServeContext} srv
 * @param {ProjectRef} ref
 */
export function openState(srv, ref) {
  const P = loadProject(srv.ws, ref, { flags: flagLayer(srv.flags) });
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
      ? srv
          .rust('affected', { manifest: S.runPath, root: P.workspaceRoot, files: [file] })
          .then((r) => r.traced ?? r.ids)
      : Promise.resolve([]);
  mkdirSync(P.store.reports, { recursive: true });
  // `reload` and `affected` are both set above.
  return /** @type {ProjectState} */ (S);
}

/**
 * The project a request means: named, or the only one, or the one owning the id / story.
 * @param {ServeContext} srv
 * @param {ProjectQuery} [query] from the request: any JSON value, compared as it is
 * @returns {ProjectState}
 */
export function stateFor(srv, { project, id, story } = {}) {
  if (project) {
    // Every name in `states` is a string: any other value misses, as an unknown name does.
    const S = srv.states.get(/** @type {string} */ (project));
    if (!S)
      throw httpError(
        404,
        // A template prints any value as String() does; only a string can name a project.
        `no project "${/** @type {string} */ (project)}" (projects: ${[...srv.states.keys()].join(', ')})`
      );
    return S;
  }
  // One project: the map's only value.
  if (srv.states.size === 1) return [...srv.states.values()][0];
  const owners = [...srv.states.values()].filter((S) =>
    S.manifest.stories.some((e) => (id && e.id === id) || (story && (e.story ?? e.id) === story))
  );
  if (owners.length === 1) return owners[0];
  throw httpError(400, `name a project (projects: ${[...srv.states.keys()].join(', ')})`);
}

/** @param {ServeContext} srv */
export const projectsList = (srv) =>
  [...srv.states.values()].map((S) => ({
    name: S.name,
    label: S.P.label ?? null,
    root: shownPath(srv.ws.root, S.P.root),
    storybook: S.P.storybook.url,
    entries: S.manifest.stories.length,
    integrity: S.integrity?.summary ?? null,
    error: S.error ?? null,
    locked: S.lock ? 'held' : S.lockWait,
  }));

/**
 * Writes for a project need its store lock (held for the server's life once taken).
 * @param {ServeContext} srv
 * @param {ProjectState} S
 */
export function needLock(srv, S) {
  if (S.lock) {
    try {
      return S.lock.check();
    } catch (e) {
      // Taken over (a person did, after this server went quiet): stop writing, wait to get it back.
      if (!(e instanceof LockError)) throw e;
      console.error(`[serve] ${S.name}: ${e.message}`);
      S.lock = null;
      S.lockWait = e.message;
      setTimeout(() => takeLock(srv, S), 2000).unref();
    }
  }
  throw httpError(
    409,
    `${S.lockWait ?? 'the store lock is not held'}: this project is read-only until it is free`
  );
}

/**
 * Take a project's store lock now, or keep trying every 2 s while another process holds it.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 */
export function takeLock(srv, S) {
  try {
    S.lock = acquireLock(S.P, { holder: 'serve', command: 'pxsig serve' });
    const waited = !!S.lockWait;
    S.lockWait = null;
    if (srv.url) S.lock.update({ url: srv.url });
    // Waited for the lock: the run manifest moves into the store, and the ledger is written.
    if (waited) {
      S.reload();
      scheduleIntegrity(srv, S, 'store lock taken', 0);
    }
    return true;
  } catch (e) {
    if (!(e instanceof LockError)) throw e;
    const msg = e.lock ? describeLock(S.P, e.lock) : e.message;
    if (S.lockWait !== msg)
      console.error(`[serve] ${S.name}: ${msg}; waiting for it (writes are refused until then)`);
    S.lockWait = msg;
    setTimeout(() => takeLock(srv, S), 2000).unref();
    return false;
  }
}
