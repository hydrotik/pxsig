/** paths.mjs — the one way pxsig prints and stores a path: `/`-separated on every OS. */
import { relative, sep } from 'node:path';

/** @param {string} p */
export const toPosix = (p) => p.split(sep).join('/');
/**
 * `relative(from, to)` as pxsig prints it.
 * @param {string} from
 * @param {string} to
 */
export const relPath = (from, to) => toPosix(relative(from, to));
