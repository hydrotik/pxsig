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
/**
 * `to` relative to `from` when it is inside `from` ('.' for `from` itself), else null: a path
 * outside the workspace is shown by a label instead (the folders above it name the user).
 * @param {string} from
 * @param {string} to
 * @returns {string | null}
 */
export const insidePath = (from, to) => {
  const rel = relative(from, to);
  if (rel === '') return '.';
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : toPosix(rel);
};
/**
 * A path as human output shows it: relative to `from` inside it, else the folder's or file's own
 * name. Never absolute, never `../` (either can name the user).
 * @param {string} from
 * @param {string} to
 */
export const shortPath = (from, to) => insidePath(from, to) ?? basename(to);
