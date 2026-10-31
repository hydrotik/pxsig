/** paths.mjs — the one way pxsig prints and stores a path: `/`-separated on every OS. */
import { basename, isAbsolute, relative, sep } from 'node:path';

/** @param {string} p */
export const toPosix = (p) => p.split(sep).join('/');
/**
 * `relative(from, to)` as pxsig prints it.
 * @param {string} from
 * @param {string} to
 */
export const relPath = (from, to) => toPosix(relative(from, to));
/**
 * A folder as the server's HTTP answers show it: relative to `from` ('.' for `from` itself), never
 * absolute, since an absolute path names the user. On another drive (Windows), its name alone.
 * @param {string} from
 * @param {string} to
 */
export const shownPath = (from, to) => {
  const rel = relPath(from, to) || '.';
  return isAbsolute(rel) ? basename(to) : rel;
};
