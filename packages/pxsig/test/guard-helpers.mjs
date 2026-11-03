/**
 * guard-helpers.mjs — what guard.test.mjs and guard-server.test.mjs share: the rules' fixtures
 * (origins, tokens, the dashboard link session), the authorize shorthands, and the server helpers
 * (a free port, raw requests, the built dashboard, the link cookie, `pxsig serve`).
 */
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, linkCookie, Links } from '../src/lib/guard.mjs';
import { rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { startServer } from './server-proc.mjs';

/** @import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http' */
/**
 * @typedef {ReturnType<typeof import('./fixture.mjs').fixture>} Fixture
 * @typedef {{ status: number, error: string, code?: string }} Refusal
 * A server answer's JSON, as far as these tests read it: flat strings (`link`, `error`, `code`;
 * docs/server.md).
 * @typedef {Record<string, string>} Answer
 * @typedef {{ status: number | undefined, headers: IncomingHttpHeaders, text: string, json: () => Answer }} RawResponse
 * An MCP tool result (docs/mcp.md).
 * @typedef {{ isError?: boolean, content: { text: string }[] }} ToolResult
 * @typedef {{ port: number, url: string, log: () => string, stop: () => Promise<unknown> }} Server
 */

export const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

export const own = 'http://127.0.0.1:6070';
export const storybook = new Set(['http://localhost:6006']);
export const tokens = { cli: 'xyz', mcp: 'mmm' };
export const links = new Links();
export const session = links.redeem(links.mint());
/** The dashboard's own request, from a page opened with the dashboard link. */
export const dashboard = {
  origin: own,
  'sec-fetch-site': 'same-origin',
  cookie: `other=1; ${linkCookie(6070)}=${session}`,
};
/**
 * null when allowed, else the refusal; `via` of an allowed decision through `viaOf`.
 * @param {string} action
 * @param {IncomingHttpHeaders} headers
 * @returns {Refusal | null}
 */
export const refuse = (action, headers) => {
  const a = authorize({
    action,
    headers,
    tokens,
    links,
    port: 6070,
    ownOrigin: own,
    allowedOrigins: storybook,
  });
  return a.ok ? null : { status: a.status, error: a.error, ...(a.code ? { code: a.code } : {}) };
};
/**
 * @param {string} action
 * @param {IncomingHttpHeaders} headers
 */
export const viaOf = (action, headers) =>
  authorize({
    action,
    headers,
    tokens,
    links,
    port: 6070,
    ownOrigin: own,
    allowedOrigins: storybook,
  }).via;

/**
 * A raw request (fetch will not send every header a browser does, Host among them).
 * @param {number} port
 * @param {{ method?: string, path: string, headers?: OutgoingHttpHeaders, body?: unknown }} req
 * @returns {Promise<RawResponse>}
 */
export const raw = (port, { method = 'GET', path, headers = {}, body }) =>
  new Promise((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () =>
          ok({ status: res.statusCode, headers: res.headers, text: s, json: () => JSON.parse(s) })
        );
      }
    );
    req.on('error', fail);
    req.end(data);
  });

/** A stand-in dashboard build (the real one may not be built where the tests run). */
export const dashboardDir = () => {
  const dash = tempDir('dash');
  writeFileSync(
    join(dash, 'index.html'),
    '<!doctype html><html><head><title>pxsig</title></head><body></body></html>'
  );
  return dash;
};

/**
 * The cookie a page opened with a fresh dashboard link gets (as `pxsig serve --link`, then the page).
 * @param {Server} S
 * @param {string} cliToken
 */
export async function dashboardCookie(S, cliToken) {
  const link = (
    await raw(S.port, {
      method: 'POST',
      path: '/__pxsig/ticket',
      headers: { 'x-pxsig-token': cliToken },
    })
  ).json().link;
  const ticket = link.split('#ticket=')[1];
  const r = await raw(S.port, {
    method: 'POST',
    path: '/__pxsig/session',
    headers: { origin: S.url, 'sec-fetch-site': 'same-origin' },
    body: { ticket },
  });
  // A traded ticket answers with its cookie.
  return /** @type {string[]} */ (r.headers['set-cookie'])[0].split(';')[0];
}

/**
 * @param {Fixture} f
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Server>}
 */
export async function serve(f, env = {}) {
  const S = await startServer({
    cwd: f.repo,
    env: {
      ...testEnv(testHome),
      PXSIG_BIN: rustBin,
      PXSIG_WORKSPACE: '',
      PXSIG_DASHBOARD_DIR: dashboardDir(),
      ...env,
    },
  });
  return { port: S.port, url: S.url, log: S.log, stop: () => S.stop() };
}
