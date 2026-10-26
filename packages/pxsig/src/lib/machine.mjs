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
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** This machine's pxsig folder, for `platform` and `env` (the defaults: this process). */
export function machineDir({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pxsig');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'pxsig');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'pxsig');
}

export const settingsPath = (opts) => join(machineDir(opts), 'settings.json');

/** `{ path, exists, settings }`; an unreadable or missing file reads as no settings. */
export function readSettings(opts) {
  const path = settingsPath(opts);
  try {
    return { path, exists: true, settings: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { path, exists: false, settings: {} };
  }
}

/** Write `settings.json` whole: a temp file beside it, then a rename, so a crash leaves the old one. */
export function writeSettings(settings, opts) {
  const path = settingsPath(opts);
  mkdirSync(machineDir(opts), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, path);
      return path;
    } catch (e) {
      // Windows refuses a rename while another process (a virus scanner, an editor) has the file open.
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}

/** Where a workspace's server token files go on Windows: one folder per workspace, in the profile. */
export function windowsTokenDir(workspaceRoot, opts) {
  const key = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex').slice(0, 16);
  return join(machineDir({ platform: 'win32', ...opts }), 'tokens', key);
}
