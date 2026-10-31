/**
 * server-pick.mjs — whether the panel may use the pxsig server that answered at a candidate address
 * (manager.mjs). Several workspaces can each run `pxsig serve`, and the default port belongs to
 * whichever started first, so the server's `GET /__pxsig/status` answer names its workspace
 * (`workspaceId`, lib/workspace/peers.mjs in pxsig) and the preset hands the manager this
 * Storybook's own (preset.cjs).
 */

/** The address every pxsig server tries first: any workspace's may be listening there. */
export const DEFAULT_SERVER = 'http://127.0.0.1:6070';

/**
 * - the `pxsig-server` localStorage key is the person's choice: always used;
 * - a server that names a workspace is used when it is this Storybook's;
 * - a server that names none (pxsig 0.6 or earlier) is used at an address the preset found for this
 *   workspace (the `server` option, server.json, the workspace's port), never at the default alone.
 * @param {{ workspaceId?: unknown } | null | undefined} status the server's status answer
 * @param {{ url: string, workspaceId?: string | null, pinned?: string[], override?: string | null }} at
 * @returns {boolean}
 */
export function acceptsServer(status, { url, workspaceId = null, pinned = [], override = null }) {
  if (override && url === override) return true;
  const id = status?.workspaceId;
  if (typeof id === 'string') return id === workspaceId;
  return pinned.includes(url);
}
