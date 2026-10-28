/**
 * machine.mjs — what pxsig keeps per machine, outside every repository: `settings.json` (answers
 * that describe this machine, written by `pxsig setup`) and, on Windows, the server's token files.
 *
 *   macOS    ~/Library/Application Support/pxsig/
 *   Linux    $XDG_CONFIG_HOME/pxsig/ (default ~/.config/pxsig/)
 *   Windows  %LOCALAPPDATA%\pxsig\   (inside the profile, never the roaming folder)
 *
 * pxsig changes no permissions and runs no tool for them: the folder is the user's own. A missing
 * settings file means setup has not run; nothing depends on it existing.
 *
 * Per repository, beside it: `<stateDir>` (`repoStateDir`), state that belongs to a clone but not in
 * it (the warn-mode readiness tally). Every worktree of a clone shares one (ROBUSTNESS R7).
 *
 *   macOS    ~/Library/Application Support/pxsig/<repo-key>/
 *   Linux    $XDG_STATE_HOME/pxsig/<repo-key>/ (default ~/.local/state/pxsig/<repo-key>/)
 *   Windows  %LOCALAPPDATA%\pxsig\<repo-key>\
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { writeJson } from './files.mjs';
import { spawnSync } from './spawn.mjs';
/** @import { MachineOptions } from '../types.js' */

/**
 * This machine's pxsig folder, for `platform` and `env` (the defaults: this process).
 * @param {MachineOptions} [opts]
 * @returns {string}
 */
export function machineDir({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (platform === 'win32')
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pxsig');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'pxsig');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'pxsig');
}

/** @param {MachineOptions} [opts] */
export const settingsPath = (opts) => join(machineDir(opts), 'settings.json');

/**
 * `{ path, exists, settings }`; an unreadable or missing file reads as no settings.
 * @param {MachineOptions} [opts]
 * @returns {{ path: string, exists: boolean, settings: Record<string, unknown> }}
 */
export function readSettings(opts) {
  const path = settingsPath(opts);
  try {
    return {
      path,
      exists: true,
      // settings.json is the file `pxsig setup` writes (writeSettings): a JSON object.
      settings: /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(path, 'utf8'))),
    };
  } catch {
    return { path, exists: false, settings: {} };
  }
}

/**
 * Write `settings.json` whole: a temp file beside it, then a rename, so a crash leaves the old one.
 * @param {Record<string, unknown>} settings
 * @param {MachineOptions} [opts]
 */
export function writeSettings(settings, opts) {
  const path = settingsPath(opts);
  return writeJson(path, settings, { pretty: true });
}

/**
 * Where a workspace's server token files go on Windows: one folder per workspace, in the profile.
 * @param {string} workspaceRoot
 * @param {MachineOptions} [opts]
 */
export function windowsTokenDir(workspaceRoot, opts) {
  const key = createHash('sha256')
    .update(resolve(workspaceRoot).toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return join(machineDir({ platform: 'win32', ...opts }), 'tokens', key);
}

/**
 * The folder that holds every repository's `<stateDir>` on this machine.
 * @param {MachineOptions} [opts]
 * @returns {string}
 */
export function stateRoot({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (platform === 'linux')
    return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'pxsig');
  return machineDir({ platform, env, home });
}

/**
 * A remote URL without credentials, `.git` or a trailing slash, its host lower-cased.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function normaliseRemote(url) {
  if (!url) return '';
  let u = String(url)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  u = u.replace(/^([a-z+]+:\/\/)[^@/]*@/i, '$1');
  return u.replace(
    /^([a-z+]+:\/\/)?([^/:]+)/i,
    (/** @type {string} */ _, /** @type {string} */ scheme = '', /** @type {string} */ host) =>
      `${scheme}${host.toLowerCase()}`
  );
}

/**
 * `<repo-key>`: the first 12 hex of sha256 over the real path of the clone's git common dir
 * (case-folded on macOS and Windows) and its normalised `origin` URL, so every worktree of a clone
 * gets the same key. Outside git: the workspace's real path.
 * @param {string} workspaceRoot
 * @param {MachineOptions & { git?: (cwd: string, args: string[]) => string }} [opts]
 * @returns {string}
 */
export function repoKey(workspaceRoot, { platform = process.platform, git = gitLine } = {}) {
  // The OS's own real path (on Windows it expands 8.3 short names such as RUNNER~1), with `/`.
  /** @param {string} p */
  const real = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  let common =
    git(workspaceRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']) ||
    git(workspaceRoot, ['rev-parse', '--git-common-dir']);
  if (common && !isAbsolute(common)) common = resolve(workspaceRoot, common);
  let path = real(common || workspaceRoot).replace(/\\/g, '/');
  if (platform === 'win32' || platform === 'darwin') path = path.toLowerCase();
  const remote = common
    ? normaliseRemote(git(workspaceRoot, ['config', '--get', 'remote.origin.url']))
    : '';
  return createHash('sha256').update(`${path}\n${remote}`).digest('hex').slice(0, 12);
}

/**
 * This repository's `<stateDir>`.
 * @param {string} workspaceRoot
 * @param {MachineOptions & { git?: (cwd: string, args: string[]) => string }} [opts]
 */
export const repoStateDir = (workspaceRoot, opts = {}) =>
  join(stateRoot(opts), repoKey(workspaceRoot, opts));

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function gitLine(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}
