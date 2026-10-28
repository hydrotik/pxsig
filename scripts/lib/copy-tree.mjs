/**
 * copy-tree.mjs — copy a file or a folder, recursively, without `fs.cpSync`.
 *
 * On Windows, Node 22's native cpSync mishandles a non-ASCII path: a recursive copy lands somewhere
 * else without an error, and a file copied over an existing one throws ", The operation completed
 * successfully." A checkout under a profile folder with an accented name hits it. This walks the
 * tree and copies each file with `copyFileSync`, which does not. pxsig's own tests have the same
 * helper (packages/pxsig/test/fixture.mjs, copyTree).
 *
 * Same contract as `cpSync(from, to, { recursive: true, filter })` for what the scripts use: a file
 * or a folder; `filter(source)` is asked for every path, the top one included, and a folder it
 * refuses is skipped with everything in it; an existing destination is merged into, a file in it
 * overwritten. A symbolic link is followed (its target's content is copied).
 *
 * Zero dependencies.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {string} from
 * @param {string} to
 * @param {{ filter?: (source: string) => boolean }} [opts]
 */
export function copyTree(from, to, { filter } = {}) {
  if (filter && !filter(from)) return;
  if (!statSync(from).isDirectory()) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    return;
  }
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) copyTree(join(from, name), join(to, name), { filter });
}
