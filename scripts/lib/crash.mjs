/**
 * lib/crash.mjs — a crash of the screens harness is an error, never a verdict.
 *
 * Node exits 1 on an uncaught error or an unhandled rejection, and 1 is what the screens scripts
 * (scripts/screens-container.mjs, scripts/screens-check.mjs) and the screens workflow read as
 * "screens to review". `asMain` makes a crash exit CRASH (2, an error, as setup is) with a message
 * that says so, and `checkExit` holds the container's answer to the report it must leave: a 0 or 1
 * with no check.json written by that run is a crash too.
 *
 * Zero dependencies.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The exit code of a crash: an error, as setup is (2), never 1 (screens to review). */
export const CRASH = 2;

/**
 * The line a crash prints: the error's stack, or its message, or what was thrown.
 * @param {string} tag the script's tag (`screens`)
 * @param {unknown} e
 */
export function crashMessage(tag, e) {
  const what = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return `[${tag}] the harness failed: an error, not a screen to review\n${what}`;
}

/**
 * Whether the module at `url` is the script node runs; if it is, a crash from here on exits CRASH.
 * @param {string} url the module's import.meta.url
 * @param {string} tag
 */
export function asMain(url, tag) {
  // node runs a script by its real path (import.meta.url), argv[1] as typed: a link (macOS's /var)
  // or a relative path names the same file.
  const real = (/** @type {string} */ p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  if (!process.argv[1] || real(process.argv[1]) !== real(fileURLToPath(url))) return false;
  const crash = (/** @type {unknown} */ e) => {
    console.error(crashMessage(tag, e));
    process.exit(CRASH);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  return true;
}

/**
 * A report's stamp: check.json's `generatedAt`, or null when there is none to read.
 * @param {string} file
 * @returns {string | null}
 */
export function reportStamp(file) {
  try {
    const { generatedAt } = /** @type {{ generatedAt?: unknown }} */ (
      JSON.parse(readFileSync(file, 'utf8'))
    );
    return typeof generatedAt === 'string' ? generatedAt : null;
  } catch {
    return null;
  }
}

/**
 * The container's exit for screens-check's `status`, given check.json's stamp before and after the
 * run. 125–127, a signal (null) or a kill (128 + n): Docker or the process failed, not the check
 * (2). 0 or 1 is a verdict only when the run wrote its report; else it crashed (2).
 * @param {number | null} status
 * @param {string | null} before
 * @param {string | null} after
 * @returns {{ code: number, why: string | null }}
 */
export function checkExit(status, before, after) {
  if (status === null || status >= 125) return { code: CRASH, why: `exit ${status}` };
  if (status > 1) return { code: status, why: null };
  if (after === null || after === before)
    return { code: CRASH, why: `exit ${status} with no check.json written by this run` };
  return { code: status, why: null };
}
