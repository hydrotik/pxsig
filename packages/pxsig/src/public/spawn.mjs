/**
 * `pxsig/spawn`: pxsig's guarded program start (../lib/spawn.mjs), for the Storybook addon, which
 * starts `pxsig snapshot` through it instead of importing Node's process module itself. The same
 * list of programs as pxsig's own starts ("Programs pxsig starts" in `pxsig help platforms`), never
 * a shell: anything else throws before it starts.
 *
 * Only `spawnSync` is public; the rest of ../lib/spawn.mjs may change in any release.
 */
export { spawnSync } from '../lib/spawn.mjs';
