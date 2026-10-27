/**
 * spawn.mjs — the only place pxsig starts a program. Everything it may start is listed here and in
 * docs/platforms.md ("Programs pxsig starts"); anything else is refused, so the list stays true.
 *
 *   node (this pxsig), the engine binary, git                every OS
 *   ps (a lock's start time)                                 macOS, Linux
 *   osascript, open (open the dashboard)                     macOS
 *   xdg-open (open the dashboard)                            Linux
 *   fc-list (a digest of the installed fonts, render env)    Linux, when fontconfig is installed
 *   docker (`pxsig browser start|stop|status` only)          every OS, only on that command
 *
 * Windows starts nothing else: no shell, no PowerShell, no cmd.exe. Playwright starts its own
 * browser; that is the library's process, listed in the docs. `PXSIG_DEBUG=spawn` (set by
 * `pxsig serve --debug`) prints every start on stderr.
 */
import * as cp from 'node:child_process';

const BY_OS = {
  darwin: ['git', 'ps', 'osascript', 'open', 'docker'],
  linux: ['git', 'ps', 'xdg-open', 'fc-list', 'docker'],
  win32: ['git', 'docker'],
};

/** Why pxsig may not start `program` on `platform`, or null. */
export function refused(program, platform = process.platform) {
  if (program === process.execPath) return null;
  if (/^pxsig(\.exe)?$/i.test(program.split(/[\\/]/).pop())) return null; // the engine binary
  if ((BY_OS[platform] ?? ['git']).includes(program)) return null;
  return `pxsig does not start "${program}" on ${platform} (see "Programs pxsig starts" in docs/platforms.md)`;
}

function check(program, args, opts = {}) {
  const why = refused(program);
  if (why) throw new Error(why);
  if (opts.shell) throw new Error(`pxsig does not start a shell (asked to run "${program}" through one)`);
  if (/(^|,)spawn(,|$)/.test(process.env.PXSIG_DEBUG ?? '')) process.stderr.write(`[spawn] ${program} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
}

/** A start a policy blocked (AppLocker, WDAC, a sandbox) names the list instead of failing bare. */
function explain(program, e) {
  if (e && ['EACCES', 'EPERM'].includes(e.code)) e.message = `${program} could not start (${e.code}): it may be blocked on this machine. What pxsig starts and why: "Programs pxsig starts" in docs/platforms.md`;
  return e;
}

export function spawn(program, args = [], opts = {}) {
  check(program, args, opts);
  return cp.spawn(program, args, opts);
}

export function spawnSync(program, args = [], opts = {}) {
  check(program, args, opts);
  const r = cp.spawnSync(program, args, opts);
  if (r.error) explain(program, r.error);
  return r;
}

export function execFile(program, args = [], opts = {}, done = () => {}) {
  if (typeof opts === 'function') [opts, done] = [{}, opts];
  check(program, args, opts);
  return cp.execFile(program, args, opts, (err, ...rest) => done(err && explain(program, err), ...rest));
}
