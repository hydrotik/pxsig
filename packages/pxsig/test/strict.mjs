/**
 * strict.mjs — when a test may skip. Locally, a test whose engine, browser or git is missing skips
 * with a reason. CI sets `PXSIG_TEST_STRICT=1` (ci.yml, the `node` job), and there a missing one
 * fails the run instead: a broken artifact download or browser install must not pass as skips. The
 * only skips left under it are the ones correct on an OS, listed in `OS_SKIPS` with their reasons.
 */

export const strict = process.env.PXSIG_TEST_STRICT === '1';

/**
 * A node:test `skip` value: `false` when `ok`, else `why`. Under `PXSIG_TEST_STRICT`, a missing
 * requirement throws instead, which fails the test file with `why` in the message.
 * @param {unknown} ok the requirement holds (the engine is built, Chromium launches, git runs)
 * @param {string} why what is missing
 * @returns {string | false}
 */
export function skipUnless(ok, why) {
  if (ok) return false;
  if (strict) throw new Error(`PXSIG_TEST_STRICT is set, and a test would skip: ${why}`);
  return why;
}

/** The skips that are correct on an OS, by reason. Nothing else skips under `PXSIG_TEST_STRICT`. */
const OS_SKIPS = {
  // The engine-protocol tests stand in a `#!/usr/bin/env node` script for the engine. Windows
  // starts no script by its shebang, and pxsig never starts a shell to run one.
  'the stand-in engine is a script': 'win32',
};

/**
 * A node:test `skip` value for a skip that is correct on an OS: `why` on that OS, else `false`.
 * `why` must be listed in `OS_SKIPS`.
 * @param {keyof typeof OS_SKIPS} why
 * @returns {string | false}
 */
export function skipOn(why) {
  if (!Object.hasOwn(OS_SKIPS, why)) throw new Error(`not an allowed OS skip: ${why}`);
  return process.platform === OS_SKIPS[why] && why;
}
