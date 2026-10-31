/**
 * guard.mjs — who may write through `pxsig serve`.
 *
 * Decisions (approve, approve a story, reject, unreview, the a11y decisions, pruning accepted a11y
 * rules) need a person: the dashboard (or the Storybook panel that embeds it), or `pxsig approve
 * apply` / `pxsig a11y --prune` at a terminal.
 * The dashboard decides through the dashboard link: `pxsig serve` prints `<url>/report/#ticket=<t>`
 * for a person at a terminal (`pxsig serve --link` prints a new one). The page trades the ticket
 * (single use, accessed within five minutes) once, at `POST /__pxsig/session`, for a cookie that scripts cannot read
 * and other sites cannot send (HttpOnly, SameSite=Strict), valid until the server stops. No token is
 * ever put in a page, so a script fetching the page, with whatever headers, gets nothing to decide
 * with. The server also makes two random tokens it writes to files only its owner can read
 * (`serve-<port>.token`, which `pxsig approve apply` reads after its own person-at-a-terminal
 * check, and `serve-<port>.mcp.token`, which the MCP server reads). On macOS and Linux they sit in
 * `node_modules/.cache/pxsig/` with mode 0600; on Windows, where a mode protects nothing, in the
 * user's own `%LOCALAPPDATA%\pxsig\tokens\<workspace>\` (lib/machine.mjs), with no permission
 * change and no tool run. A decision with neither the link's cookie nor a file token is refused,
 * and what it carried says how it was made (`via: dashboard`, `cli` or `mcp` in the logs): what
 * the request body says is ignored.
 *
 * The MCP's token is an agent's, so it decides less: it may mark entries rejected and clear a
 * rejection (AGENT_DECISIONS), nothing that writes a baseline or an accepted list, and the server
 * refuses its unreview of a person's approval or accept. A rejection only asks for attention.
 *
 * Every write also refuses a request a browser sent from another site (CSRF): an Origin that is
 * not the server's own (or, for checks and repairs only, a project's Storybook), or a
 * `Sec-Fetch-Site` other than same-origin. Every request refuses a Host that is not loopback
 * (DNS rebinding).
 *
 * This is a guard, not authentication: a process running as the person can read the token file.
 * It stops an agent (or a script) from approving by posting to the server or by reading the page,
 * and a web page from posting to it at all.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { windowsTokenDir } from './machine.mjs';
import { serverFile } from './workspace.mjs';
/** @import { IncomingHttpHeaders } from 'node:http' */
/** @import { Authorization, Tokens } from '../types.js' */

export const TOKEN_HEADER = 'x-pxsig-token';

/** Routes that record a decision: refused without the token. */
export const DECISIONS = new Set([
  'approve',
  'approve-story',
  'reject',
  'unreview',
  'a11y-accept',
  'a11y-reject',
  'a11y-unreview',
  'a11y-unaccept',
  'a11y-prune',
]);

/** What an agent's (the MCP's) token may decide: rejections, and clearing them. */
export const AGENT_DECISIONS = new Set(['reject', 'unreview', 'a11y-reject', 'a11y-unreview']);

export const NEEDS_PERSON =
  'approving needs a person: use the dashboard or `pxsig approve` in a terminal';
/** A browser decision without the dashboard link's cookie (a tab opened from a bookmark, say). */
export const NEEDS_LINK =
  'approving here needs the dashboard link: open the link `pxsig serve` printed, or run `pxsig serve --link` in a terminal';
export const NEEDS_LINK_CODE = 'needs-dashboard-link';

export const newToken = () => randomBytes(32).toString('hex');

/**
 * The token file for the server at `url` (one per port: a second server on another port has its
 * own); `kind` is `cli` or `mcp`.
 * @param {string} root
 * @param {string} url
 * @param {string} [kind]
 * @param {string} [platform]
 */
export const tokenFile = (root, url, kind = 'cli', platform = process.platform) =>
  join(
    platform === 'win32' ? windowsTokenDir(root) : dirname(serverFile(root)),
    `serve-${new URL(url).port || '80'}${kind === 'cli' ? '' : `.${kind}`}.token`
  );

/**
 * @param {string} root
 * @param {string} url
 * @param {string} token
 * @param {string} [kind]
 */
export function writeToken(root, url, token, kind = 'cli') {
  const file = tokenFile(root, url, kind);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // an existing file keeps its old mode otherwise
  return file;
}

/**
 * @param {string} root
 * @param {string} url
 * @param {string} [kind]
 * @returns {string | null}
 */
export function readToken(root, url, kind = 'cli') {
  try {
    return readFileSync(tokenFile(root, url, kind), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} url
 * @param {string} token
 * @param {string} [kind]
 */
export function removeToken(root, url, token, kind = 'cli') {
  if (readToken(root, url, kind) === token) rmSync(tokenFile(root, url, kind), { force: true });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A Host header naming this server on a loopback name (or none: HTTP/1.0).
 * @param {string | null | undefined} host
 * @param {number} port
 */
export function loopbackHost(host, port) {
  if (!host) return true;
  const m = String(host)
    .toLowerCase()
    .match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  return !!m && LOOPBACK.has(m[1]) && Number(m[2] ?? 80) === port;
}

/**
 * @param {string | string[] | null | undefined} a
 * @param {string | string[] | null | undefined} b
 */
const same = (a, b) => {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The dashboard link's cookie for the server on `port` (cookies are per host, not per port).
 * @param {number | null} port
 */
export const linkCookie = (port) => `pxsig_link_${port}`;

/**
 * One cookie's value from a Cookie header, or null.
 * @param {string | null | undefined} header
 * @param {string} name
 * @returns {string | null}
 */
export function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/**
 * The `Set-Cookie` value for a dashboard link `session` (no Max-Age: it ends with the browser too).
 * @param {number | null} port
 * @param {string} session
 */
export const linkSetCookie = (port, session) =>
  `${linkCookie(port)}=${session}; HttpOnly; SameSite=Strict; Path=/`;

export const TICKET_MS = 5 * 60 * 1000;

/**
 * The dashboard link's tickets and the cookies they were traded for, in this server's memory only:
 * a restart ends them all. `mint` makes a ticket; `redeem` uses it once, within TICKET_MS.
 */
export class Links {
  /** @type {Map<string, number>} ticket → when it expires (ms) */
  #tickets = new Map();
  /** @type {Set<string>} */
  #sessions = new Set();
  /** @param {number} [now] */
  mint(now = Date.now()) {
    for (const [t, until] of this.#tickets) if (until < now) this.#tickets.delete(t);
    const t = newToken();
    this.#tickets.set(t, now + TICKET_MS);
    return t;
  }
  /**
   * @param {unknown} ticket
   * @param {number} [now]
   * @returns {string | null}
   */
  redeem(ticket, now = Date.now()) {
    if (typeof ticket !== 'string') return null;
    const until = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    if (until == null || until < now) return null;
    const s = newToken();
    this.#sessions.add(s);
    return s;
  }
  /** @param {unknown} session */
  has(session) {
    return typeof session === 'string' && this.#sessions.has(session);
  }
}

/**
 * Whether a write may go ahead: `{ ok: true, via }` (`via` set for a decision: what it carried), or
 * `{ ok: false, status, error, code? }`. `headers` are Node's (lower-case names); `tokens` is
 * `{ cli, mcp }`; `links` the server's Links and `port` its port (the dashboard link's cookie);
 * `ownOrigin` is `http://<host header>` (already checked to be loopback); `allowedOrigins` the
 * Storybook origins.
 * @param {{ action: string, headers: IncomingHttpHeaders, tokens: Tokens, links?: Links | null, port?: number | null, ownOrigin: string, allowedOrigins: Set<string> }} req
 * @returns {Authorization}
 */
export function authorize({
  action,
  headers,
  tokens,
  links = null,
  port = null,
  ownOrigin,
  allowedOrigins,
}) {
  const refused = refuseWrite({ action, headers, ownOrigin, allowedOrigins });
  if (refused) return { ok: false, ...refused };
  if (!DECISIONS.has(action)) return { ok: true, via: null };
  // The file tokens never come from a browser: a browser request carrying one is refused.
  const browser = !!(headers.origin || headers['sec-fetch-site']);
  if (browser && links?.has(cookieValue(headers.cookie, linkCookie(port))))
    return { ok: true, via: 'dashboard' };
  const sent = headers[TOKEN_HEADER];
  if (same(sent, tokens.cli) && !browser) return { ok: true, via: 'cli' };
  if (same(sent, tokens.mcp) && !browser && AGENT_DECISIONS.has(action))
    return { ok: true, via: 'mcp' };
  if (browser) return { ok: false, status: 403, error: NEEDS_LINK, code: NEEDS_LINK_CODE };
  return { ok: false, status: 403, error: NEEDS_PERSON };
}

/**
 * `pxsig serve --link` asking the running server for a ticket: the CLI's token, never a browser.
 * @param {IncomingHttpHeaders} headers
 * @param {Tokens} tokens
 */
export const mayMintTicket = (headers, tokens) =>
  !(headers.origin || headers['sec-fetch-site']) && same(headers[TOKEN_HEADER], tokens.cli);

/**
 * A browser page trading a ticket (`POST /__pxsig/session`): from this server's own page only.
 * @param {IncomingHttpHeaders} headers
 * @param {string} ownOrigin
 */
export const sameOriginPage = (headers, ownOrigin) =>
  headers['sec-fetch-site'] === 'same-origin' && (!headers.origin || headers.origin === ownOrigin);

/**
 * Why a write is refused on its origin alone, or null (the token is `authorize`'s).
 * @param {{ action: string, headers: IncomingHttpHeaders, ownOrigin: string, allowedOrigins: Set<string> }} req
 * @returns {{ status: number, error: string } | null}
 */
function refuseWrite({ action, headers, ownOrigin, allowedOrigins }) {
  const decision = DECISIONS.has(action);
  const origin = headers.origin;
  const site = headers['sec-fetch-site'];
  const fromStorybook = !!origin && allowedOrigins.has(origin);
  if (origin && origin !== ownOrigin && !(fromStorybook && !decision))
    return { status: 403, error: decision ? `cross-origin: ${NEEDS_PERSON}` : 'cross-origin' };
  if (site && site !== 'same-origin' && !(fromStorybook && !decision))
    return { status: 403, error: decision ? `cross-site: ${NEEDS_PERSON}` : 'cross-site' };
  return null;
}

/**
 * Headers on every dashboard page: what it may load (its own scripts and data, images it draws),
 * who may frame it (this server and the projects' Storybooks), and no content sniffing.
 * @param {Iterable<string>} allowedOrigins
 */
export const pageHeaders = (allowedOrigins) => ({
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors 'self' ${[...allowedOrigins].join(' ')}`.trim(),
  ].join('; '),
  'x-content-type-options': 'nosniff',
});
