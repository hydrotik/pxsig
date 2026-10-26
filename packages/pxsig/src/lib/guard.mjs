/**
 * guard.mjs — who may write through `pxsig serve`.
 *
 * Decisions (approve, approve a story, reject, unreview, the a11y decisions) need a person: the
 * dashboard (or the Storybook panel that embeds it), or `pxsig approve apply` at a terminal.
 * The server makes three random tokens when it starts: one it puts in the dashboard page when a
 * browser loads that page as a document, and two it writes to files only its owner can read
 * (`serve-<port>.token`, which `pxsig approve apply` reads after its own person-at-a-terminal
 * check, and `serve-<port>.mcp.token`, which the MCP server reads). On macOS and Linux they sit in
 * `node_modules/.cache/pxsig/` with mode 0600; on Windows, where a mode protects nothing, in the
 * user's own `%LOCALAPPDATA%\pxsig\tokens\<workspace>\` (lib/machine.mjs), with no permission
 * change and no tool run. A decision without one of them is refused, and the token used says how the decision was made (`via:
 * dashboard`, `cli` or `mcp` in the logs): what the request body says is ignored.
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
 * This is a guard, not authentication: a local process can read the token file or the page.
 * It stops an agent (or a script) from approving by posting to the server, and a web page from
 * posting to it at all.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { windowsTokenDir } from './machine.mjs';
import { serverFile } from './workspace.mjs';

export const TOKEN_HEADER = 'x-pxsig-token';

/** Routes that record a decision: refused without the token. */
export const DECISIONS = new Set(['approve', 'approve-story', 'reject', 'unreview', 'a11y-accept', 'a11y-reject', 'a11y-unreview', 'a11y-unaccept']);

/** What an agent's (the MCP's) token may decide: rejections, and clearing them. */
export const AGENT_DECISIONS = new Set(['reject', 'unreview', 'a11y-reject', 'a11y-unreview']);

export const NEEDS_PERSON = 'approving needs a person: use the dashboard or `pxsig approve` in a terminal';

export const newToken = () => randomBytes(32).toString('hex');

/**
 * The token file for the server at `url` (one per port: a second server on another port has its
 * own); `kind` is `cli` or `mcp`.
 */
export const tokenFile = (root, url, kind = 'cli', platform = process.platform) =>
  join(platform === 'win32' ? windowsTokenDir(root) : dirname(serverFile(root)), `serve-${new URL(url).port || '80'}${kind === 'cli' ? '' : `.${kind}`}.token`);

export function writeToken(root, url, token, kind = 'cli') {
  const file = tokenFile(root, url, kind);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // an existing file keeps its old mode otherwise
  return file;
}

export function readToken(root, url, kind = 'cli') {
  try {
    return readFileSync(tokenFile(root, url, kind), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function removeToken(root, url, token, kind = 'cli') {
  if (readToken(root, url, kind) === token) rmSync(tokenFile(root, url, kind), { force: true });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A Host header naming this server on a loopback name (or none: HTTP/1.0). */
export function loopbackHost(host, port) {
  if (!host) return true;
  const m = String(host).toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  return !!m && LOOPBACK.has(m[1]) && Number(m[2] ?? 80) === port;
}

const same = (a, b) => {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Whether a write may go ahead: `{ ok: true, via }` (`via` set for a decision: which token it
 * carried), or `{ ok: false, status, error }`. `headers` are Node's (lower-case names); `tokens`
 * is `{ dashboard, cli, mcp }`; `ownOrigin` is `http://<host header>` (already checked to be loopback);
 * `allowedOrigins` the Storybook origins.
 */
export function authorize({ action, headers, tokens, ownOrigin, allowedOrigins }) {
  const refused = refuseWrite({ action, headers, ownOrigin, allowedOrigins });
  if (refused) return { ok: false, ...refused };
  if (!DECISIONS.has(action)) return { ok: true, via: null };
  const sent = headers[TOKEN_HEADER];
  if (same(sent, tokens.dashboard)) return { ok: true, via: 'dashboard' };
  // The file tokens never come from a browser: a browser request carrying one is refused.
  const browser = !!(headers.origin || headers['sec-fetch-site']);
  if (same(sent, tokens.cli) && !browser) return { ok: true, via: 'cli' };
  if (same(sent, tokens.mcp) && !browser && AGENT_DECISIONS.has(action)) return { ok: true, via: 'mcp' };
  return { ok: false, status: 403, error: NEEDS_PERSON };
}

/** Why a write is refused on its origin alone, or null (the token is `authorize`'s). */
function refuseWrite({ action, headers, ownOrigin, allowedOrigins }) {
  const decision = DECISIONS.has(action);
  const origin = headers.origin;
  const site = headers['sec-fetch-site'];
  const fromStorybook = !!origin && allowedOrigins.has(origin);
  if (origin && origin !== ownOrigin && !(fromStorybook && !decision)) return { status: 403, error: decision ? `cross-origin: ${NEEDS_PERSON}` : 'cross-origin' };
  if (site && site !== 'same-origin' && !(fromStorybook && !decision)) return { status: 403, error: decision ? `cross-site: ${NEEDS_PERSON}` : 'cross-site' };
  return null;
}

/** The dashboard page with the token in it: `<meta name="pxsig-token">`, read by its fetches. */
export const withToken = (html, token) => html.replace(/<head[^>]*>/i, (m) => `${m}<meta name="pxsig-token" content="${token}">`);

/** A browser loading the page itself (a tab, or the Storybook panel's iframe), not a script. */
export const pageLoad = (headers) => ['document', 'iframe'].includes(headers['sec-fetch-dest']) && headers['sec-fetch-mode'] === 'navigate';
