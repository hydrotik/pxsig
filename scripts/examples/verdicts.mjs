/**
 * verdicts.mjs — what examples-test.mjs reads from check.json rows. Kept apart from shared.mjs
 * (which needs the Rust binary) so scripts/examples-verdicts.test.mjs can load it anywhere.
 */

/** @import { CheckRow } from '../../packages/pxsig/src/types.js' */

/**
 * The rows of a first check that are not NEW, one line each with the reason. A render error is
 * not NEW: it writes no PNG, so taking its baseline fails later with "PNG not found" and the
 * render's own error would be lost.
 * @param {CheckRow[]} rows
 * @returns {string[]}
 */
export const notNew = (rows) =>
  rows
    .filter((r) => r.new !== true)
    .map((r) => `${r.id}: ${r.error ?? (r.pass ? 'passed' : 'changed')}`);
