/**
 * pxsig Storybook addon preset. Register it in `.storybook/main` as `addons: ['@pxsig/storybook-addon']`,
 * or with options: `{ name: '@pxsig/storybook-addon', options: { server: 'http://127.0.0.1:6070' } }`.
 *
 * The manager page learns where the pxsig server is: the `server` option, else the address the
 * running server wrote for this workspace (node_modules/.cache/pxsig/server.json), else the
 * workspace's configured port, then the default port. The panel probes them in that order and
 * uses a server only when it serves this workspace (server-pick.mjs).
 *
 * On `storybook build` it also writes `pxsig-snapshot.json` into the build (the workspace's own
 * `pxsig snapshot`): what a deployed Storybook's panel shows, since no pxsig server is reachable
 * there. Option `snapshot: false` leaves it out. The snapshot never fails a build: without pxsig,
 * or when the command fails, one warning line and no file.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
/** @typedef {import('./types.js').PresetOptions} PresetOptions */
/** @typedef {import('./types.js').ServerFile} ServerFile */
/** @typedef {import('./types.js').WorkspaceFile} WorkspaceFile */
/** @typedef {import('./types.js').SnapshotDeps} SnapshotDeps */
/** @typedef {import('./types.js').StaticDir} StaticDir */

/**
 * The workspace root above Storybook's config dir: a pxsig.workspace.json, else a pxsig.config.json.
 * @param {string} start
 * @returns {string | null}
 */
function workspaceOf(start) {
  let dir = path.resolve(start);
  let config = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pxsig.workspace.json'))) return dir;
    if (!config && fs.existsSync(path.join(dir, 'pxsig.config.json'))) config = dir;
    if (fs.existsSync(path.join(dir, '.git'))) return config ?? dir;
    const up = path.dirname(dir);
    if (up === dir) return config;
    dir = up;
  }
}

/**
 * @param {string} p
 * @returns {unknown}
 */
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** @param {PresetOptions | undefined} options */
function servers(options) {
  /** @type {string[]} */
  const out = [];
  if (options?.server) out.push(String(options.server).replace(/\/$/, ''));
  const ws = options?.configDir ? workspaceOf(options.configDir) : null;
  if (ws) {
    // Written by `pxsig serve` (its address for this workspace).
    const running = /** @type {ServerFile | null} */ (
      readJson(path.join(ws, 'node_modules', '.cache', 'pxsig', 'server.json'))
    );
    if (running?.url) out.push(running.url);
    // The workspace file, as far as the port: pxsig validates it when it reads it.
    const port = /** @type {WorkspaceFile | null} */ (
      readJson(path.join(ws, 'pxsig.workspace.json'))
    )?.server?.port;
    if (port) out.push(`http://127.0.0.1:${port}`);
  }
  return [...new Set(out)];
}

/**
 * The workspace's id, as pxsig computes it (lib/workspace/peers.mjs `workspaceId`): the first 16
 * hex characters of the SHA-256 of its real path. The manager uses a server only when its status
 * answer names this id (server-pick.mjs); the path itself never reaches the page.
 * @param {PresetOptions | undefined} options
 * @returns {string | null}
 */
function workspaceIdOf(options) {
  const ws = options?.configDir ? workspaceOf(options.configDir) : null;
  if (!ws) return null;
  let real = path.resolve(ws);
  try {
    real = fs.realpathSync(real);
  } catch {
    // a folder that is gone: its resolved path
  }
  return crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
}

/**
 * The workspace's own pxsig CLI: `node_modules/pxsig` from Storybook's config dir up to the workspace.
 * @param {string} configDir
 * @param {string} ws
 * @returns {string | null}
 */
function pxsigCli(configDir, ws) {
  let dir = path.resolve(configDir);
  for (;;) {
    const bin = path.join(dir, 'node_modules', 'pxsig', 'bin', 'pxsig.mjs');
    if (fs.existsSync(bin)) return bin;
    const up = path.dirname(dir);
    if (dir === path.resolve(ws) || up === dir) return null;
    dir = up;
  }
}

/**
 * Write the snapshot for a build; its folder, or null (with the reason on stderr).
 * @param {PresetOptions} options
 * @param {SnapshotDeps} [deps]
 * @returns {string | null}
 */
function writeSnapshot(options, { run = spawnSync, warn = console.warn } = {}) {
  const ws = options?.configDir ? workspaceOf(options.configDir) : null;
  // ws is set only when options.configDir is.
  const bin = ws ? pxsigCli(/** @type {string} */ (options.configDir), ws) : null;
  if (!bin) {
    warn('pxsig: no snapshot in this build (pxsig is not installed in this workspace)');
    return null;
  }
  // bin is found only inside a workspace: ws is set from here on (the casts below).
  const dir = path.join(/** @type {string} */ (ws), 'node_modules', '.cache', 'pxsig', 'storybook');
  const file = path.join(dir, 'pxsig-snapshot.json');
  fs.rmSync(file, { force: true });
  const r = run(
    process.execPath,
    [bin, 'snapshot', '--out', file, '--workspace', /** @type {string} */ (ws)],
    {
      cwd: /** @type {string} */ (ws),
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, PXSIG_FORMAT: 'plain' },
    }
  );
  if (r.status !== 0 || !fs.existsSync(file)) {
    const why = String(r.stderr || r.stdout || r.error?.message || `exit ${r.status}`)
      .trim()
      .split('\n')
      .at(-1);
    warn(`pxsig: no snapshot in this build (${why})`);
    return null;
  }
  return dir;
}

/**
 * `storybook build` (not `storybook dev`): the snapshot's folder joins the static dirs. Storybook
 * may ask for the static dirs more than once in a build; the snapshot is made once.
 */
/** @type {string | null | undefined} */
let made;
/**
 * @param {StaticDir[]} [dirs]
 * @param {PresetOptions} [options]
 * @param {SnapshotDeps} [deps]
 * @returns {Promise<StaticDir[]>}
 */
async function staticDirs(dirs = [], options = {}, deps) {
  if (options.configType !== 'PRODUCTION' || options.snapshot === false) return dirs;
  if (deps || made === undefined) made = writeSnapshot(options, deps);
  return made ? [...dirs, { from: made, to: '/' }] : dirs;
}

module.exports = {
  staticDirs,
  workspaceIdOf,
  managerEntries: (/** @type {string[]} */ entry = []) => [
    ...entry,
    path.join(__dirname, 'manager.mjs'),
  ],
  managerHead: (
    /** @type {string | undefined} */ head,
    /** @type {PresetOptions | undefined} */ options
  ) =>
    `${head ?? ''}<script>window.__PXSIG__=${JSON.stringify({ servers: servers(options), workspaceId: workspaceIdOf(options) })}</script>`,
};
