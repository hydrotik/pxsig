/**
 * live/server.mjs — the real `pxsig serve` for the live screens: the CLI process a person runs
 * (packages/pxsig/src/serve.mjs, its `main()`, flags, dashboard selection, startup line and SIGTERM
 * shutdown), on a free port, in the staged workspace; then waiting until it is idle after an action.
 *
 * Guards (scripts/live/run.mjs relies on them): the port is never 6006 or 6070, the workspace is
 * the staging folder, PXSIG_URL names this server once it is up, and the URL it answers on is the
 * one it printed.
 */
import { resolve, sep } from 'node:path';
import { freePort, startServer } from '../../packages/pxsig/test/server-start.mjs';

/** Ports a person's own servers use (Storybook, pxsig serve): never asked for, never talked to. */
export const FORBIDDEN_PORTS = [6006, 6070];
/** A port nothing listens on: Storybook's URL, so the server serves storybook.staticDir itself. */
export const DEAD_URL = 'http://127.0.0.1:1';
/** How long the server's answer must hold still: past the store watcher's debounce and quiet window. */
export const QUIET_MS = 2_000;
const IDLE_MS = 60_000;

/** A free port that is not one of FORBIDDEN_PORTS. */
export async function safePort() {
  for (;;) {
    const p = await freePort();
    if (!FORBIDDEN_PORTS.includes(p)) return p;
  }
}

/**
 * Refuse any URL that is not a loopback server on an allowed port.
 * @param {string} url
 */
export function assertSafeUrl(url) {
  const u = new URL(url);
  if (u.hostname !== '127.0.0.1' || FORBIDDEN_PORTS.includes(Number(u.port)))
    throw new Error(`live screens: refusing ${u.host}`);
  return url;
}

/**
 * Start `pxsig serve` in the staged workspace `dir`, under `base` (the staging folder).
 * @param {{ dir: string, base: string, dashboard: string, env: NodeJS.ProcessEnv }} o
 */
export async function startLiveServer({ dir, base, dashboard, env }) {
  if (!resolve(dir).startsWith(resolve(base) + sep))
    throw new Error('live screens: the workspace must be inside the staging folder');
  const S = await startServer({
    cwd: dir,
    port: safePort,
    env: {
      ...env,
      PXSIG_WORKSPACE: dir,
      PXSIG_DASHBOARD_DIR: dashboard,
      PXSIG_STORYBOOK_URL: DEAD_URL,
      PXSIG_URL: DEAD_URL,
    },
  });
  assertSafeUrl(S.url);
  return S;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Wait until the server is idle: no check running or queued, no repair, and its status answer
 * (integrity included) unchanged for QUIET_MS. Throws after IDLE_MS.
 * @param {string} url
 */
export async function idle(url) {
  const deadline = Date.now() + IDLE_MS;
  let last = '';
  let since = Date.now();
  for (;;) {
    const s = await fetch(`${assertSafeUrl(url)}/__pxsig/status`, {
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => r.text())
      .catch(() => '');
    /** @type {{ running?: boolean, queued?: number, repairing?: boolean }} */
    let j = {};
    try {
      // GET /__pxsig/status (docs/server.md), as far as idleness reads it.
      j = /** @type {{ running?: boolean, queued?: number, repairing?: boolean }} */ (
        JSON.parse(s)
      );
    } catch {
      // not an answer: not idle
    }
    const busy = !s || j.running || (j.queued ?? 0) > 0 || j.repairing;
    if (busy || s !== last) {
      last = s;
      since = Date.now();
    } else if (Date.now() - since >= QUIET_MS) return;
    if (Date.now() > deadline)
      throw new Error(`the server was not idle within ${IDLE_MS / 1000} s`);
    await sleep(200);
  }
}
