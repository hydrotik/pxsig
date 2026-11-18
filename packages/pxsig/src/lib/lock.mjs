/**
 * lock.mjs — one writer per store.
 *
 *   <store>/reports/.lock           { pid, startedAt, host, holder, command, url?, nonce, generation, heartbeatAt, token }
 *   <store>/reports/.lock-<token>   held open by the holder: the proof that it still holds the lock (lock/token.mjs)
 *
 * Every command that writes a store's baselines, manifest or report takes the lock first: a full
 * check (`check --full`, `--update`), `approve undo` / `verify --adopt`, `migrate --apply`,
 * `doctor --repair --apply`, and the server for every project it serves (it holds the lock for as
 * long as it runs; its writes are queued inside it). The file is created whole and only when it does
 * not exist, and a stale one is replaced through a claim only one taker can make (lock/replace.mjs),
 * so two processes cannot both take it.
 *
 * A lock is stale, and taken over, when its process is gone (signal 0 fails with ESRCH) or when its
 * holder no longer holds the file named by the lock's random `token` open (a pid the system gave to
 * another process, which Windows does within seconds). The taker says so on stderr, naming the pid.
 * A lock with no token (written by an older pxsig), or whose token the platform cannot check, is
 * judged by its pid and, where `ps` can say, the process's start time. A lock written on another
 * host is never judged stale here: remove it by hand once that machine is done.
 *
 * Heartbeat and fencing: the holder re-stamps `heartbeatAt` every 5 s, and before each batch of store
 * writes `check()` re-reads the lock and stops if its `nonce` is no longer there ("lock taken over by
 * …: nothing more was written"). A quiet heartbeat alone never frees a lock whose process is alive
 * (a laptop that slept, a long render): after 10 minutes without one, `takeLock` lets a person at a
 * terminal take it over by typing a phrase; the old holder then stops at its next `check()`. Locks
 * written before the heartbeat existed (no `nonce`) are read and judged as before.
 */
import { spawnSync } from './spawn.mjs';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from './files.mjs';
import { createExclusive, readRaw, replaceStale } from './lock/replace.mjs';
import { holdToken, tokenHeld, tokenPath } from './lock/token.mjs';
import { relPath } from './paths.mjs';
import { ask, humanAtTerminal, whyNotPerson } from './term.mjs';
/** @import { LockBody, LockHandle, LockOptions, LockState } from '../types.js' */

/** The store paths `lockPath` and `acquireLock` read: a Project, or its store and workspace. */
/** @typedef {{ workspaceRoot: string, store: { root: string, reports: string } }} LockProject */

/** @param {LockProject} P */
export const lockPath = (P) => join(P.store.reports, '.lock');

export const HEARTBEAT_MS = 5000;
/** A live holder this long without a heartbeat may be taken over by a person (`takeLock`). */
export const QUIET_MS = 10 * 60 * 1000;

export class LockError extends Error {
  /**
   * @param {string} message
   * @param {LockState | null} held
   */
  constructor(message, held) {
    super(message);
    this.lock = held;
    this.setup = true;
  }
}

/**
 * When `pid` started (ms), where the platform can say; null when unknown.
 * @param {number} pid
 * @returns {number | null}
 */
function processStart(pid) {
  if (process.platform === 'win32') return null;
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  const t = Date.parse(r.stdout?.trim() ?? '');
  return Number.isFinite(t) ? t : null;
}

/**
 * Is this pid a live process (any owner)?
 * @param {number | undefined} pid
 */
export function alive(pid) {
  // Past `Number.isInteger`, `pid` is a number.
  if (!Number.isInteger(pid) || /** @type {number} */ (pid) <= 0) return false;
  try {
    process.kill(/** @type {number} */ (pid), 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/** `why` of a lock file that cannot be parsed. */
const UNREADABLE = 'unreadable lock file';

/**
 * The current lock, with `stale` and `why` when it is not live. Null when there is none.
 * @param {LockProject} P
 * @returns {LockState | null}
 */
export function readLock(P) {
  const raw = readRaw(lockPath(P));
  return raw == null ? null : judge(P, raw);
}

/** A token acquireLock wrote (32 hex digits); anything else is never used as a file name. */
const TOKEN = /^[0-9a-f]{32}$/;

/**
 * Judge a lock file's bytes.
 * @param {LockProject} P
 * @param {string} raw
 * @returns {LockState}
 */
function judge(P, raw) {
  /** @type {Partial<LockBody> & { heartbeatAgeMs?: number }} */
  let l;
  try {
    // The lock file a pxsig process wrote (acquireLock); an older one may lack keys.
    l = /** @type {Partial<LockBody>} */ (JSON.parse(raw));
  } catch {
    return { stale: true, why: UNREADABLE };
  }
  if (!l || typeof l !== 'object') return { stale: true, why: UNREADABLE };
  const beat = Date.parse(l.heartbeatAt ?? '');
  if (Number.isFinite(beat)) l.heartbeatAgeMs = Math.max(0, Date.now() - beat);
  if (l.host && l.host !== hostname()) return { ...l, stale: false, foreign: true };
  if (!alive(l.pid)) return { ...l, stale: true, why: `process ${l.pid} is gone` };
  const live = () => ({
    ...l,
    stale: false,
    quiet: l.heartbeatAgeMs != null && l.heartbeatAgeMs > QUIET_MS,
  });
  // `alive` holds only for a positive integer pid.
  const pid = /** @type {number} */ (l.pid);
  const token = TOKEN.test(l.token ?? '') ? /** @type {string} */ (l.token) : null;
  const proof = token ? tokenHeld(P.store.reports, token, pid) : null;
  if (proof === true) return live();
  if (proof === false)
    return { ...l, stale: true, why: `pid ${pid} no longer holds the lock's token` };
  const started = processStart(pid);
  // `lstart` has one-second resolution: allow a little slack before calling the pid reused.
  if (started != null && l.startedAt && started > Date.parse(l.startedAt) + 2000)
    return { ...l, stale: true, why: `pid ${l.pid} now belongs to a newer process` };
  return live();
}

/**
 * Is a claim another taker left (lock/replace.mjs) stale? Its taker is gone or no longer holds its
 * token; an unreadable claim counts once it is 10 s old (one still being written is younger).
 * @param {LockProject} P
 * @param {string} raw
 * @param {string} file
 */
function claimStale(P, raw, file) {
  /** @type {{ pid?: number, host?: string, token?: string } | null} */
  let c = null;
  try {
    c = /** @type {{ pid?: number, host?: string, token?: string } | null} */ (JSON.parse(raw));
  } catch {
    // judged by its age below
  }
  if (!c || typeof c !== 'object') {
    try {
      return Date.now() - statSync(file).mtimeMs > 10_000;
    } catch {
      return false;
    }
  }
  if (c.host !== hostname()) return false;
  if (!alive(c.pid)) return true;
  const token = TOKEN.test(c.token ?? '') ? /** @type {string} */ (c.token) : null;
  return token ? tokenHeld(P.store.reports, token, /** @type {number} */ (c.pid)) === false : false;
}

/** Block this thread for `ms` between take-over attempts (acquireLock is synchronous). */
const pause = (/** @type {number} */ ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {number} ms */
const ago = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/**
 * A sentence naming who holds a lock.
 * @param {LockProject} P
 * @param {LockState} l
 */
export function describeLock(P, l) {
  // readLock could not parse the file: it names no holder.
  if (l.why === UNREADABLE)
    return `an unreadable lock file (${relPath(P.workspaceRoot, lockPath(P))})`;
  const what =
    l.holder === 'serve'
      ? `the pxsig server${l.url ? ` at ${l.url}` : ''}`
      : `\`${l.command ?? `pxsig ${l.holder}`}\``;
  const beat = l.heartbeatAgeMs != null ? `, last heartbeat ${ago(l.heartbeatAgeMs)} ago` : '';
  return `${what} (pid ${l.pid}${l.foreign ? ` on ${l.host}` : ''}, since ${l.startedAt}${beat}) holds the store ${relPath(P.workspaceRoot, P.store.root) || '.'}`;
}

/**
 * Take the store lock. Returns `{ release, update, check }`. Throws LockError when a live process
 * holds it. A stale lock is replaced, with a line on stderr saying so; `takeOver` (the nonce
 * `takeLock` showed a person) replaces a quiet one. The lock is released by `release` and on process
 * exit; a process killed outright leaves its lock behind, which the next taker finds stale (its pid
 * is gone, or no longer holds the lock's token).
 * @param {LockProject} P
 * @param {LockOptions} [opts]
 * @returns {LockHandle}
 */
export function acquireLock(
  P,
  { holder, command = process.argv.slice(1).join(' '), url = null, takeOver = null } = {}
) {
  const p = lockPath(P);
  mkdirSync(P.store.reports, { recursive: true });
  const now = () => new Date().toISOString();
  const token = randomBytes(16).toString('hex');
  // Held before the lock exists, so a reader never sees this lock without its proof.
  const proof = holdToken(P.store.reports, token);
  /** @type {LockBody} */
  const body = {
    pid: process.pid,
    startedAt: now(),
    host: hostname(),
    holder,
    command,
    ...(url ? { url } : {}),
    nonce: randomBytes(8).toString('hex'),
    generation: 1,
    heartbeatAt: now(),
    token,
  };
  const claim = JSON.stringify({ pid: process.pid, host: hostname(), token });
  try {
    // A few hundred ms at most: another taker replacing the same stale lock finishes in far less.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (createExclusive(p, `${JSON.stringify(body)}\n`)) return held(P, p, body, proof);
      const raw = readRaw(p);
      if (raw == null) continue; // released meanwhile
      const found = judge(P, raw);
      if (!found.stale) {
        if (found.pid === process.pid && found.host === hostname()) {
          proof.release();
          return { release: () => {}, update: () => {}, check: () => {}, reentrant: true };
        }
        if (!(takeOver && found.quiet && found.nonce === takeOver)) {
          // A quiet lock has a heartbeat age (readLock sets `quiet` from it).
          const quiet = found.quiet
            ? `; its heartbeat stopped ${ago(/** @type {number} */ (found.heartbeatAgeMs))} ago, so a person at a terminal can take it over`
            : '';
          throw new LockError(
            `${describeLock(P, found)}: wait for it to finish${found.holder === 'serve' ? ', or stop the server' : ''}${quiet}`,
            found
          );
        }
        body.generation = (found.generation ?? 1) + 1;
      }
      // Stale (or taken over by a person): replace exactly these bytes, or judge again.
      if (replaceStale(p, raw, `${JSON.stringify(body)}\n`, claim, (c, f) => claimStale(P, c, f))) {
        if (found.stale) {
          process.stderr.write(`pxsig: the store lock was stale (${found.why}): taken over\n`);
          if (TOKEN.test(found.token ?? '') && found.token !== token)
            try {
              rmSync(tokenPath(P.store.reports, /** @type {string} */ (found.token)), {
                force: true,
              });
            } catch {
              // still open somewhere: left in place
            }
        }
        return held(P, p, body, proof);
      }
      pause(25);
    }
  } catch (e) {
    proof.release();
    throw e;
  }
  proof.release();
  throw new LockError(`could not take the store lock at ${relPath(P.workspaceRoot, p)}`, null);
}

/**
 * The handle on a lock this process now holds.
 * @param {LockProject} P
 * @param {string} p
 * @param {LockBody} body
 * @param {{ release: () => void }} proof
 * @returns {LockHandle}
 */
function held(P, p, body, proof) {
  const now = () => new Date().toISOString();
  const ours = () => {
    try {
      // The lock file a pxsig process wrote.
      return (
        /** @type {Partial<LockBody>} */ (JSON.parse(readFileSync(p, 'utf8'))).nonce === body.nonce
      );
    } catch {
      return false;
    }
  };
  let released = false;
  const beat = setInterval(() => {
    // Never write over a lock that is no longer ours: the next check() stops the writer.
    if (released || !ours()) return clearInterval(beat);
    body.heartbeatAt = now();
    try {
      writeAtomic(p, `${JSON.stringify(body)}\n`);
    } catch {
      // a missed beat; the next one tries again
    }
  }, HEARTBEAT_MS);
  beat.unref();
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    // The lock goes first, then its proof: a reader never finds this lock without it.
    if (ours()) rmSync(p, { force: true });
    proof.release();
  };
  process.once('exit', release);
  return {
    release,
    /** Rewrite the lock's body (the server adds its URL once it listens). */
    update(extra) {
      if (!ours()) return;
      Object.assign(body, extra);
      writeAtomic(p, `${JSON.stringify(body)}\n`); // atomic: the file stays ours throughout
    },
    /** Before a batch of store writes: throws when another process has taken the lock over. */
    check() {
      if (ours()) return;
      const found = readLock(P);
      throw new LockError(
        `lock taken over by ${found ? describeLock(P, found) : 'nobody (the lock file is gone)'}: nothing more was written`,
        found
      );
    },
  };
}

/**
 * `acquireLock` for a command a person runs. When a live holder has been quiet for 10 minutes, a
 * person at a terminal may take the lock over by typing a phrase; anyone else gets the LockError,
 * with `exit` 3 (it needs a person) or 1 (not confirmed).
 * @param {LockProject} P
 * @param {LockOptions} [opts]
 * @returns {Promise<LockHandle>}
 */
export async function takeLock(P, opts) {
  try {
    return acquireLock(P, opts);
  } catch (e) {
    if (!(e instanceof LockError) || !e.lock?.quiet || !e.lock.nonce) throw e;
    if (!humanAtTerminal())
      throw Object.assign(e, { exit: 3, message: `${e.message} (${whyNotPerson()})` });
    const phrase = 'TAKE OVER';
    if (
      (await ask(
        `${e.message}. Type "${phrase}" to take the lock (the old holder stops before its next write): `
      )) !== phrase
    )
      throw Object.assign(new LockError('not confirmed: the lock was left as it is', e.lock), {
        exit: 1,
      });
    return acquireLock(P, { ...opts, takeOver: e.lock.nonce });
  }
}

/**
 * Run `fn` holding the lock; always releases it.
 * @template T
 * @param {LockProject} P
 * @param {LockOptions} opts
 * @param {(lock: LockHandle) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLock(P, opts, fn) {
  const l = acquireLock(P, opts);
  try {
    return await fn(l);
  } finally {
    l.release();
  }
}
