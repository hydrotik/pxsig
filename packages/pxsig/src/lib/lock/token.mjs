/**
 * lock/token.mjs — proof that a store lock's holder is still running.
 *
 *   <store>/reports/.lock-<token>   held open by the lock's holder for as long as it holds the lock
 *
 * A lock records a random `token`. Before it writes the lock, the holder creates the file named by
 * that token and keeps it open until it releases the lock; the operating system closes it when the
 * process ends, however it ends (Ctrl+C, a closed terminal, Task Manager, `kill -9`). A lock counts
 * as held only while that file is held open, so a pid that the system gave to another process (Windows
 * reuses them within seconds) no longer makes a lock look live. Nothing is started and nothing
 * listens: the proof is a file handle, checked with node:fs alone.
 *
 *   Windows   the holder opens the file normally (any process may still read it); a probe opens it
 *             with exclusive sharing (libuv's UV_FS_O_EXLOCK, share mode 0), which Windows refuses
 *             with a sharing violation (EBUSY) while any handle on it is open.
 *   macOS     the holder opens it with O_EXLOCK (an flock taken at open); a probe opening it with
 *             O_EXLOCK | O_NONBLOCK gets EAGAIN while the holder has it.
 *   Linux     no open-time lock exists in node:fs; the probe looks for the file among the holder pid's
 *             open files (/proc/<pid>/fd), by device and inode.
 *
 * Node opens every file close-on-exec (and non-inheritable on Windows), so a program the holder
 * started never keeps a crashed holder's lock alive. When the probe cannot tell (another user's
 * process on Linux, a platform with neither mechanism), it answers null and the caller judges the
 * lock by its pid as before.
 *
 * A process never probes its own tokens: it knows them (`mine`), so a holder and a reader in one
 * process (the server and a command it runs in process) never open the file at all. A probe that
 * finds the file busy because some other program has it open at that moment (a virus scanner, a
 * backup) answers "held": a spurious "held" is retried, a lock is never broken by it.
 */
import { closeSync, constants, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** libuv's exclusive-sharing open flag on Windows (uv/win.h); node:fs does not export it. */
const WIN_EXLOCK = 0x10000000;
/** O_EXLOCK on macOS (sys/fcntl.h); node:fs does not export it. */
const DARWIN_EXLOCK = 0x20;

/** The tokens this process holds now. */
const mine = new Set();

/** @param {string} dir @param {string} token */
export const tokenPath = (dir, token) => join(dir, `.lock-${token}`);

/** @param {unknown} e */
const code = (e) => /** @type {NodeJS.ErrnoException} */ (e).code;

/**
 * Create the token's file and hold it open. Throws when the file already exists.
 * @param {string} dir
 * @param {string} token
 * @param {NodeJS.Platform} [platform]
 * @returns {{ file: string, release: () => void }}
 */
export function holdToken(dir, token, platform = process.platform) {
  const file = tokenPath(dir, token);
  const create = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL;
  // Windows needs no flag: the probe's exclusive open is refused while this handle is open.
  const lock = platform === 'darwin' ? DARWIN_EXLOCK | constants.O_NONBLOCK : 0;
  /** @type {number | null} */
  let fd;
  try {
    fd = openSync(file, create | lock, 0o600);
  } catch (e) {
    // A file system without open-time locks (some network mounts): hold it plainly. Probes there
    // cannot tell (null) and the lock is judged by its pid, as before.
    if (!lock || !['ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(code(e) ?? '')) throw e;
    fd = openSync(file, create, 0o600);
  }
  mine.add(token);
  return {
    file,
    release() {
      if (fd == null) return;
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
      fd = null;
      mine.delete(token);
      try {
        rmSync(file, { force: true });
      } catch {
        // a probe has it open this instant (Windows): a closed token file proves nothing, left as is
      }
    },
  };
}

/**
 * Does `pid` hold the token's file open? true or false when the platform can say; null when it
 * cannot (the caller then judges the lock by its pid).
 * @param {string} dir
 * @param {string} token
 * @param {number} pid
 * @param {{ platform?: NodeJS.Platform, procRoot?: string }} [opts]
 * @returns {boolean | null}
 */
export function tokenHeld(
  dir,
  token,
  pid,
  { platform = process.platform, procRoot = '/proc' } = {}
) {
  if (pid === process.pid && mine.has(token)) return true; // ours: never opened from here
  const file = tokenPath(dir, token);
  if (platform === 'win32' || platform === 'darwin') {
    const flags =
      platform === 'win32'
        ? constants.O_RDONLY | WIN_EXLOCK
        : constants.O_RDONLY | DARWIN_EXLOCK | constants.O_NONBLOCK;
    try {
      closeSync(openSync(file, flags));
      return false; // nobody holds it
    } catch (e) {
      const c = code(e);
      if (c === 'ENOENT') return false;
      if (c === 'EBUSY' || c === 'EAGAIN' || c === 'EWOULDBLOCK') return true;
      return null; // ENOTSUP on a file system without open-time locks, EPERM, …: cannot tell
    }
  }
  /** @type {import('node:fs').Stats} */
  let want;
  try {
    want = statSync(file);
  } catch (e) {
    return code(e) === 'ENOENT' ? false : null;
  }
  /** @type {string[]} */
  let fds;
  const dirOf = join(procRoot, String(pid), 'fd');
  try {
    fds = readdirSync(dirOf);
  } catch (e) {
    // No such process: not held. No /proc, or another user's process: cannot tell.
    return code(e) === 'ENOENT' && pidListed(procRoot) ? false : null;
  }
  for (const fd of fds) {
    try {
      const s = statSync(join(dirOf, fd));
      if (s.ino === want.ino && s.dev === want.dev) return true;
    } catch {
      // closed meanwhile, or not a file
    }
  }
  return false;
}

/** Is `procRoot` a /proc that lists processes (so a missing pid there means none)? */
function pidListed(/** @type {string} */ procRoot) {
  try {
    statSync(join(procRoot, String(process.pid)));
    return true;
  } catch {
    return false;
  }
}
