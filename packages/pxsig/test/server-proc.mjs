/**
 * server-proc.mjs — start `pxsig serve` for a test (server-start.mjs: a free port, ready, stop).
 * Every test that runs a real server starts it here.
 *
 * A server a test left running (a failed start, a test that timed out) is killed when the file's
 * tests end: its open pipes would keep the test process, and the CI job, alive.
 */
import { after } from 'node:test';
import { startServer as start } from './server-start.mjs';

/** @import { ChildProcess } from 'node:child_process' */

export { freePort } from './server-start.mjs';

/** @type {Set<ChildProcess>} */
const live = new Set();
after(() => {
  for (const proc of live) proc.kill();
});

/**
 * Start `pxsig serve --no-open` in `cwd` (server-start.mjs), killed at the latest when the file's
 * tests end.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, bin?: boolean, args?: string[] }} opts
 */
export const startServer = (opts) =>
  start({
    ...opts,
    onSpawn: (proc) => {
      live.add(proc);
      proc.on('exit', () => live.delete(proc));
    },
  });
