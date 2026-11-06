/**
 * serve/create.mjs — `createPxsigServer`: one server for a workspace's projects. It opens them,
 * watches their stores, and answers HTTP; `start()` brings up the engine, the store locks and
 * Storybook, then listens and starts integrity; `stop()` lets go of everything it holds. No argv,
 * no `process.exit`, no signals: serve.mjs `main` does those.
 *
 * Binds to 127.0.0.1 only. One writer per store (lib/lock.mjs): the server holds each served
 * project's `<store>/reports/.lock` for as long as it runs, and every write for that project
 * (approve, reject, re-check, repair) happens here, in its queue. While another process holds a
 * project's lock, the server waits for it and answers that project's writes with 409.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LINK_ELSEWHERE, LINK_TIMING } from '../lib/dashboard-link.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { Links, loopbackHost, newToken, removeToken, writeToken } from '../lib/guard.mjs';
import { resolveContext } from '../lib/integrity.mjs';
import { alive } from '../lib/lock.mjs';
import { openLink } from '../lib/open.mjs';
import { relPath } from '../lib/paths.mjs';
import { ensureStorybook } from '../lib/static.mjs';
import { humanAtTerminal } from '../lib/term.mjs';
import { rustBinary, serverFile } from '../lib/workspace.mjs';
import { startEngine } from './engine.mjs';
import { cors, json } from './http.mjs';
import { runIntegrity } from './integrity.mjs';
import { startReact } from './react.mjs';
import { projectFile, reportFile } from './pages.mjs';
import { openState, takeLock } from './projects.mjs';
import { dashboardLink, dispatch, routes } from './routes.mjs';
import { watchSources, watchStores } from './watch.mjs';
/** @import { ServerResponse } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */
/** @import { Flags, Workspace } from '../types.js' */
/** @import { HttpError, ServerRecord } from '../types/t5.js' */
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/** Why the server cannot start: serve.mjs prints `[serve] <message>` and exits 2. */
export class StartError extends Error {}

/**
 * @param {{ ws: Workspace, flags: Flags, only?: string[] | null, port: number, watch?: boolean,
 *   tab?: string | boolean | null, open?: boolean }} opts `port` 0: any free port; `watch`,
 *   `tab` and `open` are `--watch`, `--tab` and not `--no-open`
 */
export function createPxsigServer({
  ws,
  flags,
  only = null,
  port,
  watch = false,
  tab = null,
  open = true,
}) {
  /**
   * Decisions need one of these (lib/guard.mjs): the dashboard page's, the CLI's, or the MCP's
   * (files only the owner reads; the MCP's only rejects and clears rejections).
   */
  const TOKENS = { cli: newToken(), mcp: newToken() };
  // The dashboard link's tickets and cookies (lib/guard.mjs): in memory, so a restart ends them.
  const links = new Links();
  // --- the Rust engine, kept running: two lanes ---------------------------------------
  // The engine answers one request at a time, so tracing (`affected`, up to seconds per edited
  // file in an integrity pass) runs on its own engine: a capture, an approval or a check never
  // waits behind it.
  const engine = startEngine(ws.root, rustBinary());
  const tracer = startEngine(ws.root, rustBinary());
  const { rust } = engine;
  const kill = () => {
    engine.kill();
    tracer.kill();
  };
  // --- live updates -------------------------------------------------------------------------
  /** @type {Set<ServerResponse>} */
  const clients = new Set();
  /**
   * @param {string} event
   * @param {Record<string, unknown>} [data]
   */
  const broadcast = (event, data = {}) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  /** @type {Map<string, ProjectState>} */
  const states = new Map();
  /** @type {Set<string>} */
  const allowedOrigins = new Set();
  const info = serverFile(ws.root);

  const server = createServer(async (req, res) => {
    try {
      // A Host that is not loopback is a DNS-rebinding page posing as same-origin.
      if (!loopbackHost(req.headers.host, /** @type {AddressInfo} */ (server.address()).port))
        return json(res, 403, { error: 'unknown host' });
      cors(allowedOrigins, req, res);
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      // A request the server received always has its URL (only a client's request lacks one).
      const u = new URL(/** @type {string} */ (req.url), 'http://localhost');
      const path = decodeURIComponent(u.pathname);
      if (path === '/') return res.writeHead(302, { location: '/report/' }).end();
      if (path.startsWith('/__pxsig/'))
        return await dispatch(srv, req, res, path.slice(9), u.searchParams);
      if (path === '/api/integrity')
        return await dispatch(srv, req, res, 'integrity', u.searchParams);
      const pm = path.match(/^\/p\/([^/]+)\/(.+)$/);
      if (pm) return projectFile(srv, req, res, pm[1], pm[2]);
      if (path === '/report' || path.startsWith('/report/')) return reportFile(srv, req, res, path);
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      // What the handlers throw is an Error, an httpError carrying its status.
      if (!res.headersSent)
        json(res, /** @type {HttpError} */ (e).status || 500, {
          error: /** @type {HttpError} */ (e).message,
        });
    }
  });

  /** @type {ServeContext} */
  const srv = {
    ws,
    flags,
    states,
    allowedOrigins,
    tokens: TOKENS,
    links,
    rust,
    trace: tracer.rust,
    kill,
    broadcast,
    clients,
    // --- one browser pool for every project ----------------------------------------------------
    pool: null,
    url: null,
    routes: new Map(routes),
    info,
    server,
    watchers: new Set(),
  };

  // --- projects --------------------------------------------------------------------------------
  for (const ref of ws.projects) {
    if (only && !only.includes(ref.name)) continue;
    try {
      states.set(ref.name, openState(srv, ref));
    } catch (e) {
      // loadProject throws Errors (a missing or invalid config).
      console.error(`[serve] project ${ref.name}: ${/** @type {Error} */ (e).message}`);
    }
  }
  if (!states.size) throw new StartError('no project could be opened');
  for (const S of states.values()) {
    const o = new URL(S.P.storybook.url).origin;
    allowedOrigins.add(o);
    allowedOrigins.add(o.replace('localhost', '127.0.0.1'));
  }
  watchStores(srv);
  if (watch) watchSources(srv);

  /**
   * @param {number} port
   * @param {(error: StartError | null) => void} done
   * @param {number} [tries]
   */
  function listen(port, done, tries = 10) {
    /** @param {NodeJS.ErrnoException} e */
    const onError = (e) => {
      server.off('listening', onListening);
      if (e.code === 'EADDRINUSE' && tries > 0) return listen(port + 1, done, tries - 1);
      done(new StartError(e.message));
    };
    const onListening = () => {
      server.off('error', onError);
      const url =
        (srv.url = `http://127.0.0.1:${/** @type {AddressInfo} */ (server.address()).port}`);
      // The CLI, the MCP and the addon find the server through this file: a second server (on
      // another port, read-only beside the one holding the stores) leaves a live server's record.
      // server.json is what a pxsig server wrote.
      const recorded = /** @type {ServerRecord | null} */ (readJson(info, null));
      if (recorded?.pid && recorded.pid !== process.pid && alive(recorded.pid))
        console.log(
          `[serve] ${relPath(ws.root, info)} names the running server at ${recorded.url} (pid ${recorded.pid}): left as it is`
        );
      else {
        mkdirSync(dirname(info), { recursive: true });
        writeJson(
          info,
          {
            url,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            projects: [...states.keys()],
          },
          { pretty: true }
        );
      }
      for (const S of states.values()) S.lock?.update({ url });
      mkdirSync(dirname(info), { recursive: true });
      writeToken(ws.root, url, TOKENS.cli);
      writeToken(ws.root, url, TOKENS.mcp, 'mcp');
      const page = `${url}/report/${tab ? `#${tab}` : ''}`;
      console.log(
        `[serve] pxsig dashboard → ${page}  (${[...states.keys()].join(', ')}; Ctrl+C to stop)`
      );
      // The dashboard link goes only to a person at this terminal: an agent or a background start
      // reads this output, and with the link it could approve from a browser it drives.
      const person = humanAtTerminal();
      const link = person ? dashboardLink(srv, `${url}/report/`, tab ?? null) : null;
      console.log(`[serve] ${link ? `dashboard link: ${link}\n${LINK_TIMING}` : LINK_ELSEWHERE}`);
      if (open)
        void openLink(link ?? page).then((o) => {
          const said = o.reused ? 'reloaded the open dashboard tab' : o.note;
          if (said) console.log(`[serve] ${said}`);
        });
      done(null);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  }

  /**
   * The engine, each project's store lock and Storybook, then listen (the ready line) and the
   * startup integrity pass and React analysis, which run on while the server answers. Resolves once listening;
   * rejects with a StartError when no port could be bound.
   */
  async function start() {
    await rust('ping', {}).then((p) =>
      console.log(`[serve] Rust engine up (pxsig ${p.version}, ${p.threads} threads)`)
    );
    for (const S of states.values()) {
      takeLock(srv, S);
      // No Storybook at storybook.url but a build in storybook.staticDir: serve it ourselves.
      const sb = await ensureStorybook(S.P, { log: (m) => console.log(`[serve] ${S.name}: ${m}`) });
      if (sb.served) {
        S.reload();
        S.ctx = resolveContext(S.P);
        const o = new URL(sb.url).origin;
        allowedOrigins.add(o);
      }
    }
    /** @type {Promise<void>} */
    const listening = new Promise((ok, fail) => listen(port, (e) => (e ? fail(e) : ok())));
    // The startup integrity pass, then the React analysis (when the project has the compiler).
    for (const S of states.values())
      void runIntegrity(srv, S, 'startup').then(() => startReact(srv, S, 'startup'));
    await listening;
  }

  /**
   * Lets go of the locks, the engine, the browsers, the temp folder, the token files and
   * `server.json` (when it is this process's); closes the watchers and the listener, so an
   * in-process server ends too. serve.mjs exits right after.
   */
  async function stop() {
    for (const S of states.values()) S.lock?.release();
    kill();
    await srv.pool?.close();
    rmSync(join(tmpdir(), `pxsig-serve-${process.pid}`), { recursive: true, force: true });
    if (srv.url) {
      removeToken(ws.root, srv.url, TOKENS.cli);
      removeToken(ws.root, srv.url, TOKENS.mcp, 'mcp');
    }
    try {
      if (/** @type {Partial<ServerRecord>} */ (readJson(info, {})).pid === process.pid)
        rmSync(info);
    } catch {
      // already gone
    }
    for (const S of states.values()) clearTimeout(S.integrityTimer ?? undefined);
    for (const w of srv.watchers) w.close();
    server.closeAllConnections();
    server.close();
  }

  return { srv, start, stop };
}
