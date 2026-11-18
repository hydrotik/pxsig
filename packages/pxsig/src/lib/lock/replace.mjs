/**
 * lock/replace.mjs — create a lock file, or replace one judged stale, without ever letting two
 * takers both win.
 *
 * Creating: the body goes to a temporary file that is then hard-linked to the lock's name; a link
 * fails when the name exists, so the lock appears whole or not at all (a reader never sees an empty
 * file and calls it unreadable). Where hard links are not supported, an exclusive create (`wx`)
 * then a write.
 *
 * Replacing a stale lock: deleting it and creating a new one would let a second taker, who judged
 * the same stale lock a moment later, delete the first taker's fresh lock. Instead a taker first
 * claims the stale lock: it creates `<lock>.claim-<hash of the stale bytes>` exclusively. Only one
 * taker can claim a given stale lock; it checks that the lock still has those bytes, renames its
 * own body over it, and removes the claim. A claim left by a taker that crashed in between is itself
 * stale (its token is no longer held) and is replaced the same way.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, linkSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { writeAtomic } from '../files.mjs';

/** @param {unknown} e */
const code = (e) => /** @type {NodeJS.ErrnoException} */ (e).code;

/**
 * Create `path` holding `data`, only if it does not exist. False when it exists.
 * @param {string} path
 * @param {string} data
 */
export function createExclusive(path, data) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.new`;
  const fd = openSync(tmp, 'wx');
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, path);
    return true;
  } catch (e) {
    if (code(e) === 'EEXIST') return false;
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code(e) ?? '')) throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
  // No hard links on this file system: an exclusive create, then the write.
  let fd2;
  try {
    fd2 = openSync(path, 'wx');
  } catch (e) {
    if (code(e) === 'EEXIST') return false;
    throw e;
  }
  try {
    writeSync(fd2, data);
  } finally {
    closeSync(fd2);
  }
  return true;
}

/** @param {string} path @returns {string | null} */
export function readRaw(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (code(e) === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Replace `path`, whose content `stale` was judged stale, with `data`. False when another taker is
 * replacing it, or it changed since it was judged (the caller reads and judges it again).
 * @param {string} path
 * @param {string} stale the bytes that were judged stale
 * @param {string} data the new body
 * @param {string} claimBody what a claim says about its taker (its pid and token, as JSON)
 * @param {(raw: string, file: string) => boolean} isStale judges a claim (its bytes and file) left
 *   behind by another taker
 * @param {number} [depth]
 * @returns {boolean}
 */
export function replaceStale(path, stale, data, claimBody, isStale, depth = 0) {
  const claim = `${path}.claim-${createHash('sha256').update(stale).digest('hex').slice(0, 16)}`;
  if (!createExclusive(claim, claimBody)) {
    // Another taker claimed this stale lock: wait for it, unless its claim is stale too.
    const raw = readRaw(claim);
    if (raw == null || depth >= 2 || !isStale(raw, claim)) return false;
    if (!replaceStale(claim, raw, claimBody, claimBody, isStale, depth + 1)) return false;
  }
  // The claim is ours: nobody else may replace these bytes now.
  try {
    if (readRaw(path) !== stale) return false;
    writeAtomic(path, data);
    return true;
  } finally {
    if (readRaw(claim) === claimBody) rmSync(claim, { force: true });
  }
}
