/**
 * spawn.mjs — the only place pxsig starts a program. Everything it may start is listed here and in
 * docs/platforms.md ("Programs pxsig starts"); anything else is refused, so the list stays true.
 *
 *   node (this pxsig), the engine binary, git                every OS
 *   ps (a lock's start time)                                 macOS, Linux
 *   osascript, open (open the dashboard)                     macOS
 *   xdg-open (open the dashboard)                            Linux
 *   pbcopy (the dashboard link, `serve --link --copy`)       macOS
 *   wl-copy, xclip (the dashboard link, `--copy`)            Linux
 *   fc-list (a digest of the installed fonts, render env)    Linux, when fontconfig is installed
 *   docker (`pxsig browser start|stop|status` only)          every OS, only on that command
 *
 * Windows starts nothing else: no shell, no PowerShell, no cmd.exe. Playwright starts its own
 * browser; that is the library's process, listed in the docs. `PXSIG_DEBUG=spawn` (set by
 * `pxsig serve --debug`) prints every start on stderr.
 */
import * as cp from 'node:child_process';

/** @type {Record<string, string[]>} */
const BY_OS = {
  darwin: ['git', 'ps', 'osascript', 'open', 'pbcopy', 'docker'],
  linux: ['git', 'ps', 'xdg-open', 'wl-copy', 'xclip', 'fc-list', 'docker'],
  win32: ['git', 'docker'],
};

/**
 * Why pxsig may not start `program` on `platform`, or null.
 * @param {string} program
 * @param {string} [platform]
 * @returns {string | null}
 */
export function refused(program, platform = process.platform) {
  if (program === process.execPath) return null;
  if (/^pxsig(\.exe)?$/i.test(program.split(/[\\/]/).pop() ?? '')) return null; // the engine binary
  if ((BY_OS[platform] ?? ['git']).includes(program)) return null;
  return `pxsig does not start "${program}" on ${platform} (see "Programs pxsig starts" in \`pxsig help platforms\`)`;
}

/**
 * @param {string} program
 * @param {readonly string[]} args
 * @param {{ shell?: unknown }} [opts]
 */
function check(program, args, opts = {}) {
  const why = refused(program);
  if (why) throw new Error(why);
  if (opts.shell)
    throw new Error(`pxsig does not start a shell (asked to run "${program}" through one)`);
  if (/(^|,)spawn(,|$)/.test(process.env.PXSIG_DEBUG ?? ''))
    process.stderr.write(
      `[spawn] ${program} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`
    );
}

/**
 * A start a policy blocked (AppLocker, WDAC, a sandbox) names the list instead of failing bare.
 * @template {Error | null | undefined} E
 * @param {string} program
 * @param {E} e
 * @returns {E}
 */
function explain(program, e) {
  const code = /** @type {NodeJS.ErrnoException | null | undefined} */ (e)?.code;
  if (e && code && ['EACCES', 'EPERM'].includes(code))
    e.message = `${program} could not start (${code}): it may be blocked on this machine. What pxsig starts and why: "Programs pxsig starts" in \`pxsig help platforms\``;
  return e;
}

/**
 * @param {string} program
 * @param {readonly string[]} [args]
 * @param {cp.SpawnOptions} [opts]
 * @returns {cp.ChildProcess}
 */
export function spawn(program, args = [], opts = {}) {
  check(program, args, opts);
  return cp.spawn(program, args, opts);
}

/**
 * @overload
 * @param {string} program
 * @param {readonly string[]} args
 * @param {cp.SpawnSyncOptionsWithStringEncoding} opts
 * @returns {cp.SpawnSyncReturns<string>}
 */
/**
 * @overload
 * @param {string} program
 * @param {readonly string[]} [args]
 * @param {cp.SpawnSyncOptions} [opts]
 * @returns {cp.SpawnSyncReturns<string | Buffer>}
 */
/**
 * @param {string} program
 * @param {readonly string[]} [args]
 * @param {cp.SpawnSyncOptions} [opts]
 */
export function spawnSync(program, args = [], opts = {}) {
  check(program, args, opts);
  const r = cp.spawnSync(program, args, opts);
  if (r.error) explain(program, r.error);
  return r;
}

/**
 * @param {string} program
 * @param {readonly string[]} [args]
 * @param {cp.ExecFileOptions | ((err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void)} [opts]
 * @param {(err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void} [done]
 * @returns {cp.ChildProcess}
 */
export function execFile(program, args = [], opts = {}, done = () => {}) {
  if (typeof opts === 'function') [opts, done] = [{}, opts];
  check(program, args, opts);
  return cp.execFile(program, args, opts, (err, ...rest) =>
    done(err && explain(program, err), ...rest)
  );
}
