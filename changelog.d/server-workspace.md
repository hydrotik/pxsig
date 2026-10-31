### Breaking changes

- **The CLI, the MCP server and the Storybook addon use only their own workspace's server.** Every
  `pxsig serve` tries port 6070 first, so with no server running for a workspace, its commands
  reached whichever workspace's server held the port (another checkout or worktree with the same
  project name got its checks queued there). `GET /__pxsig/status` now names the workspace it serves
  (`workspaceId`, a hash of its path, not the path), and a client uses a server only when the id is
  its own. Another workspace's server counts as not running: `pxsig check` runs in this workspace
  instead and says why, `pxsig status` shows the server as down with the reason, `pxsig serve
  --link` and `pxsig approve apply` stop. A server from pxsig 0.6 or earlier names no workspace and
  is used only at the address this workspace's `server.json` (or the addon's `server` option)
  records. `PXSIG_URL` still picks a server: a mismatch there is one warning line.
  To update: start `pxsig serve` in each workspace that uses one (and restart a server from 0.6.0
  so it names its workspace), or set `PXSIG_URL` to the server meant.

### Added

- **`workspaceId` in `GET /__pxsig/status`** (`docs/server.md`, "Reading").
