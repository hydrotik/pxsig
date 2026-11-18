/**
 * stamp-adapter.mjs — the UI adapter as a `pxsig dashboard build` stamp (pxsig-build.json) records
 * it, and back: a built-in adapter by its name (`plain`), any other by its file relative to the
 * project root, `/`-separated and starting with `.` (`./pxsig-ui/index.tsx`). Never an absolute
 * path: the stamp names no user's folder.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const BUILTIN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * What the stamp records for `ui`, built in the project folder `cwd`.
 * @param {{ name: string, file: string }} ui  the resolved adapter (build-config.mjs)
 * @param {string} cwd       the project root
 * @param {string} builtins  the built-in adapters' folder (dashboard/src/ui/adapters)
 */
export function stampAdapter(ui, cwd, builtins) {
  const inside = relative(builtins, ui.file);
  if (!inside.startsWith('..') && !isAbsolute(inside)) return ui.name;
  const rel = relative(cwd, ui.file).split(sep).join('/');
  // On another drive (Windows) there is no relative path: the name is all that is safe to record.
  if (isAbsolute(rel) || /^[a-z]:/i.test(rel)) return ui.name;
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * The adapter spec (`--ui`) a stamp's `adapter` names for `pxsig dashboard check` in `cwd`: a
 * built-in name, or a path that exists from `cwd`, else undefined. A stamp from pxsig 0.7.7 or
 * earlier holds an absolute path, which still resolves.
 * @param {unknown} recorded  the stamp's `adapter`
 * @param {string} cwd
 * @returns {string | undefined}
 */
export function stampedAdapter(recorded, cwd) {
  if (typeof recorded !== 'string' || !recorded) return undefined;
  if (BUILTIN.test(recorded) || existsSync(resolve(cwd, recorded))) return recorded;
  return undefined;
}
