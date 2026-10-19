/**
 * lock.mjs — one writer per store.
 *
 *   <store>/reports/.lock   { pid, startedAt, host, holder, command, url? }
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
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, relative } from 'node:path';

export const lockPath = (P) => join(P.store.reports, '.lock');

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
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
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
  if (l.host && l.host !== hostname()) return { ...l, stale: false, foreign: true };
  if (!alive(l.pid)) return { ...l, stale: true, why: `process ${l.pid} is gone` };
  const started = processStart(l.pid);
  // `lstart` has one-second resolution: allow a little slack before calling the pid reused.
  if (started != null && l.startedAt && started > Date.parse(l.startedAt) + 2000) return { ...l, stale: true, why: `pid ${l.pid} now belongs to a newer process` };
  return { ...l, stale: false };
}

/** A sentence naming who holds a lock. */
export function describeLock(P, l) {
  const what = l.holder === 'serve' ? `the pxsig server${l.url ? ` at ${l.url}` : ''}` : `\`${l.command ?? `pxsig ${l.holder}`}\``;
  return `${what} (pid ${l.pid}${l.foreign ? ` on ${l.host}` : ''}, since ${l.startedAt}) holds the store ${relative(P.workspaceRoot, P.store.root) || '.'}`;
}

/**
 * Take the store lock. Returns `{ release, update }`. Throws LockError when a live process holds
 * it. A stale lock is replaced. The lock is released by `release` and on process exit; a process
 * killed outright leaves its lock behind, which the next taker finds stale (its pid is gone).
 */
export function acquireLock(P, { holder, command = process.argv.slice(1).join(' '), url = null } = {}) {
  const p = lockPath(P);
  mkdirSync(P.store.reports, { recursive: true });
  const body = { pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), holder, command, ...(url ? { url } : {}) };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(p, 'wx');
      writeSync(fd, `${JSON.stringify(body)}\n`);
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          const now = JSON.parse(readFileSync(p, 'utf8'));
          if (now.pid === process.pid) rmSync(p, { force: true });
        } catch {
          // already gone
        }
      };
      process.once('exit', release);
      return {
        release,
        /** Rewrite the lock's body (the server adds its URL once it listens). */
        update(extra) {
          Object.assign(body, extra);
          const tmp = `${p}.${process.pid}.tmp`;
          writeFileSync(tmp, `${JSON.stringify(body)}\n`);
          renameSync(tmp, p); // atomic: the file stays ours throughout
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readLock(P);
      if (held && !held.stale) {
        if (held.pid === process.pid && held.host === hostname()) return { release: () => {}, update: () => {}, reentrant: true };
        throw new LockError(`${describeLock(P, held)}: wait for it to finish${held.holder === 'serve' ? ', or stop the server' : ''}`, held);
      }
      rmSync(p, { force: true }); // stale: take it over
    }
  }
  throw new LockError(`could not take the store lock at ${relative(P.workspaceRoot, p)}`, null);
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
