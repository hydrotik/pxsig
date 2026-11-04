/**
 * server-proc.mjs — start `pxsig serve` for a test, wait until it is ready, stop it and wait until
 * it is gone. Every test that runs a real server starts it here.
 *
 * - The port: `serve` has no "any free port" (`--port 0` reads as unset, so 6070), so a test asks
 *   the OS for a free port and passes it. Another process can take that port before the server
 *   binds it; the server then moves to the next one, so the URL is read from the line the server
 *   prints, never assumed. A server that could not bind at all is started again on a new port.
 * - Ready: the dashboard line, then the startup integrity pass finished (each project has a ledger,
 *   or the pass said why it failed), then a status answer. A CLI started at once then finds an idle
 *   server, as a person's does.
 * - Stop: kill, then wait for the exit. On Windows a killed process keeps its working folder busy
 *   until it is gone, and a folder removed before that fails with EBUSY.
 * - A server a test left running (a failed start, a test that timed out) is killed when the file's
 *   tests end: its open pipes would keep the test process, and the CI job, alive.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

/** @import { ChildProcess } from 'node:child_process' */

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

/** How long a start may take: a loaded Windows runner has needed more than 20 s. */
const START_MS = 90_000;

/** @type {Set<ChildProcess>} */
const live = new Set();
after(() => {
  for (const proc of live) proc.kill();
});

/** @returns {Promise<number>} */
export const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      // Listening on TCP: the address is an AddressInfo.
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => ok(p));
    });
  });

/** @param {number} ms */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Has the startup integrity pass finished in every project? (GET /__pxsig/status, docs/server.md)
 * @param {string} url
 * @param {string} log
 */
async function settled(url, log) {
  try {
    const r = await fetch(`${url}/__pxsig/status`, { signal: AbortSignal.timeout(5000) });
    const s = /** @type {{ projects?: { integrity: unknown, error: unknown }[] }} */ (
      await r.json()
    );
    if (/integrity failed/.test(log)) return true;
    return !!s.projects?.every((p) => p.integrity || p.error);
  } catch {
    return false;
  }
}

/**
 * One start on one port: resolves with the server's URL, or rejects (the process killed and gone).
 * @param {ChildProcess} proc
 * @param {() => string} log
 * @param {Promise<unknown>} exited
 * @param {number} deadline
 */
async function ready(proc, log, exited, deadline) {
  let gone = false;
  void exited.then(() => (gone = true));
  for (;;) {
    const m = /dashboard → (http:\/\/127\.0\.0\.1:\d+)\//.exec(log());
    if (m && (await settled(m[1], log()))) return m[1];
    if (gone) throw new Error(`server exited (${proc.exitCode}):\n${log()}`);
    if (Date.now() > deadline) {
      proc.kill();
      await exited;
      throw new Error(`server did not start in ${START_MS / 1000} s:\n${log()}`);
    }
    await sleep(100);
  }
}

/**
 * Start `pxsig serve --no-open` in `cwd`: src/serve.mjs, or with `bin` through the `pxsig` command
 * (a wrapper process that starts the server). `args`: more flags (`--watch`).
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, bin?: boolean, args?: string[] }} opts
 */
export async function startServer({ cwd, env, bin = false, args = [] }) {
  const cmd = bin ? [join(pkg, 'bin', 'pxsig.mjs'), 'serve'] : [join(pkg, 'src', 'serve.mjs')];
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const proc = spawn(process.execPath, [...cmd, '--port', String(port), '--no-open', ...args], {
      cwd,
      env,
    });
    live.add(proc);
    /** @type {Promise<{ code: number | null, signal: NodeJS.Signals | null }>} */
    const exited = new Promise((ok) =>
      proc.on('exit', (code, signal) => (live.delete(proc), ok({ code, signal })))
    );
    let log = '';
    proc.stdout?.on('data', (d) => (log += d));
    proc.stderr?.on('data', (d) => (log += d));
    let url;
    try {
      url = await ready(proc, () => log, exited, Date.now() + START_MS);
    } catch (e) {
      // Every port it tried was taken between the free-port probe and its bind: once more.
      if (attempt < 3 && /EADDRINUSE/.test(log)) continue;
      throw e;
    }
    return {
      url,
      port: Number(new URL(url).port),
      proc,
      exited,
      log: () => log,
      /** Kill (SIGTERM; on Windows a forced stop) and wait until the process is gone. */
      stop: (/** @type {NodeJS.Signals} */ signal = 'SIGTERM') => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
        return exited;
      },
    };
  }
}
