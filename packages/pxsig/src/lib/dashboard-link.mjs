/**
 * dashboard-link.mjs — what the dashboard says about approving from it: whether this browser holds
 * the dashboard link's session, and the command a person runs for a new link, in the folder the
 * server serves. One wording of the link's timing for the server, the CLI and the docs.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookieValue, linkCookie } from './guard.mjs';
/** @import { IncomingHttpHeaders } from 'node:http' */
/** @import { Links } from './guard.mjs' */

/**
 * The timing, said in full: the two minutes are to open the link, never to decide.
 */
export const LINK_TIMING =
  'Open it within two minutes; it works once. Once open, that browser can approve, with no time limit, until pxsig serve stops or the browser closes.';

/** The server's start-up line when the link is not printed (not a person at this terminal). */
export const LINK_ELSEWHERE =
  'to approve from the dashboard, run `pxsig serve --link` in a terminal and open the link it prints';

/** The answer to a ticket that was used or not opened in time. */
export const LINK_EXPIRED =
  'this dashboard link was used already or not opened within two minutes: run `pxsig serve --link` in a terminal for a new one (once open, a link has no time limit)';

const BIN = fileURLToPath(new URL('../../bin/pxsig.mjs', import.meta.url));

/**
 * The command that prints a new dashboard link, run in `root`: the project's own pxsig through its
 * package manager when it has one installed, else this pxsig by its path.
 * @param {string} root the workspace root
 * @param {{ exists?: (path: string) => boolean, bin?: string, platform?: string }} [o]
 */
export function linkCommand(
  root,
  { exists = existsSync, bin = BIN, platform = process.platform } = {}
) {
  const local = exists(
    join(root, 'node_modules', '.bin', platform === 'win32' ? 'pxsig.cmd' : 'pxsig')
  );
  if (!local) return `node "${bin}" serve --link`;
  const runner = exists(join(root, 'pnpm-lock.yaml'))
    ? 'pnpm exec pxsig'
    : exists(join(root, 'yarn.lock'))
      ? 'yarn pxsig'
      : 'npx pxsig';
  return `${runner} serve --link`;
}

/**
 * The status answer's `approving`: whether this request carries the dashboard link's session (a
 * boolean, never the session), and where and how to get a link.
 * @param {IncomingHttpHeaders} headers
 * @param {Links} links
 * @param {string} url the server's own address (`http://127.0.0.1:<port>`)
 * @param {string} root
 */
export const approving = (headers, links, url, root) => ({
  allowed: links.has(cookieValue(headers.cookie, linkCookie(Number(new URL(url).port)))),
  cwd: root,
  command: linkCommand(root),
});
