/**
 * lock.mjs — one writer per store.
 *
 *   <store>/reports/.lock   { pid, startedAt, host, holder, command, url?, nonce, generation, heartbeatAt }
 *
 * Every command that writes a store's baselines, manifest or report takes the lock first: a full
 * check (`check --full`, `--update`), `approve undo` / `verify --adopt`, `migrate --apply`,
 * `doctor --repair --apply`, and the server for every project it serves (it holds the lock for as
 * long as it runs; its writes are queued inside it). The file is created atomically (`wx`), so two
 * processes cannot both take it.
 *
 * A lock is stale, and taken over, when its process is gone (signal 0 fails with ESRCH) or when the
 * pid was reused by a process that started after the lock was written. A lock written on another
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
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from './files.mjs';
import { relPath } from './paths.mjs';
import { ask, humanAtTerminal, whyNotPerson } from './term.mjs';

export const lockPath = (P) => join(P.store.reports, '.lock');

export const HEARTBEAT_MS = 5000;
/** A live holder this long without a heartbeat may be taken over by a person (`takeLock`). */
export const QUIET_MS = 10 * 60 * 1000;

export class LockError extends Error {
  constructor(message, held) {
    super(message);
    this.lock = held;
    this.setup = true;
  }
}

/** When `pid` started (ms), where the platform can say; null when unknown. */
function processStart(pid) {
  if (process.platform === 'win32') return null;
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  const t = Date.parse(r.stdout?.trim() ?? '');
  return Number.isFinite(t) ? t : null;
}

/** Is this pid a live process (any owner)? */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** The current lock, with `stale` and `why` when it is not live. Null when there is none. */
export function readLock(P) {
  const p = lockPath(P);
  if (!existsSync(p)) return null;
  let l;
  try {
    l = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { stale: true, why: 'unreadable lock file' };
  }
  const beat = Date.parse(l.heartbeatAt ?? '');
  if (Number.isFinite(beat)) l.heartbeatAgeMs = Math.max(0, Date.now() - beat);
  if (l.host && l.host !== hostname()) return { ...l, stale: false, foreign: true };
  if (!alive(l.pid)) return { ...l, stale: true, why: `process ${l.pid} is gone` };
  const started = processStart(l.pid);
  // `lstart` has one-second resolution: allow a little slack before calling the pid reused.
  if (started != null && l.startedAt && started > Date.parse(l.startedAt) + 2000)
    return { ...l, stale: true, why: `pid ${l.pid} now belongs to a newer process` };
  return { ...l, stale: false, quiet: l.heartbeatAgeMs != null && l.heartbeatAgeMs > QUIET_MS };
}

const ago = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** A sentence naming who holds a lock. */
export function describeLock(P, l) {
  const what =
    l.holder === 'serve'
      ? `the pxsig server${l.url ? ` at ${l.url}` : ''}`
      : `\`${l.command ?? `pxsig ${l.holder}`}\``;
  const beat = l.heartbeatAgeMs != null ? `, last heartbeat ${ago(l.heartbeatAgeMs)} ago` : '';
  return `${what} (pid ${l.pid}${l.foreign ? ` on ${l.host}` : ''}, since ${l.startedAt}${beat}) holds the store ${relPath(P.workspaceRoot, P.store.root) || '.'}`;
}

/**
 * Take the store lock. Returns `{ release, update, check }`. Throws LockError when a live process
 * holds it. A stale lock is replaced; `takeOver` (the nonce `takeLock` showed a person) replaces a
 * quiet one. The lock is released by `release` and on process exit; a process killed outright
 * leaves its lock behind, which the next taker finds stale (its pid is gone).
 */
export function acquireLock(
  P,
  { holder, command = process.argv.slice(1).join(' '), url = null, takeOver = null } = {}
) {
  const p = lockPath(P);
  mkdirSync(P.store.reports, { recursive: true });
  const now = () => new Date().toISOString();
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
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(p, 'wx');
      writeSync(fd, `${JSON.stringify(body)}\n`);
      closeSync(fd);
      const ours = () => {
        try {
          return JSON.parse(readFileSync(p, 'utf8')).nonce === body.nonce;
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
        if (ours()) rmSync(p, { force: true });
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
          const held = readLock(P);
          throw new LockError(
            `lock taken over by ${held ? describeLock(P, held) : 'nobody (the lock file is gone)'}: nothing more was written`,
            held
          );
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readLock(P);
      if (held && !held.stale) {
        if (held.pid === process.pid && held.host === hostname())
          return { release: () => {}, update: () => {}, check: () => {}, reentrant: true };
        if (!(takeOver && held.quiet && held.nonce === takeOver)) {
          const quiet = held.quiet
            ? `; its heartbeat stopped ${ago(held.heartbeatAgeMs)} ago, so a person at a terminal can take it over`
            : '';
          throw new LockError(
            `${describeLock(P, held)}: wait for it to finish${held.holder === 'serve' ? ', or stop the server' : ''}${quiet}`,
            held
          );
        }
        body.generation = (held.generation ?? 1) + 1;
      }
      rmSync(p, { force: true }); // stale (or taken over by a person): replace it
    }
  }
  throw new LockError(`could not take the store lock at ${relPath(P.workspaceRoot, p)}`, null);
}

/**
 * `acquireLock` for a command a person runs. When a live holder has been quiet for 10 minutes, a
 * person at a terminal may take the lock over by typing a phrase; anyone else gets the LockError,
 * with `exit` 3 (it needs a person) or 1 (not confirmed).
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

/** Run `fn` holding the lock; always releases it. */
export async function withLock(P, opts, fn) {
  const l = acquireLock(P, opts);
  try {
    return await fn(l);
  } finally {
    l.release();
  }
}
