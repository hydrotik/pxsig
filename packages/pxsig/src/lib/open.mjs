/**
 * open.mjs — open a dashboard address in the default browser: `pxsig serve` on start, and
 * `pxsig serve --link --open` with the link it gets.
 *
 *   macOS    reuse a Chrome tab already on the server's origin (osascript), else `open <url>`
 *   Linux    `xdg-open <url>`
 *   Windows  nothing is started (it would take a shell): the caller prints the address
 *
 * Programs start through lib/spawn.mjs, without a shell, the address as one argument.
 */
import { execFile } from './spawn.mjs';

/**
 * @typedef {(program: string, args: string[], done: (err: Error | null, out?: unknown) => void) => unknown} Run
 * @typedef {{ opened: boolean, reused: boolean, note: string | null }} Opened
 *   `note`: what to tell the person when nothing opened (null when it did)
 */

/**
 * The AppleScript that points a Chrome tab already on `target`'s origin at `target`; it prints
 * "reused", or "none" when no such tab is open (or Chrome is not running).
 * @param {string} target
 */
export function reuseTabScript(target) {
  const origin = new URL(target).origin;
  return `
    if application "Google Chrome" is running then
      tell application "Google Chrome"
        repeat with w in windows
          set i to 0
          repeat with t in tabs of w
            set i to i + 1
            if URL of t starts with "${origin}" then
              set URL of t to "${target}"
              set active tab index of w to i
              set index of w to 1
              activate
              return "reused"
            end if
          end repeat
        end repeat
      end tell
    end if
    return "none"`;
}

/**
 * Open `target` in the default browser. Never rejects: a program that is missing or fails is a
 * `note`, and the caller has printed the address anyway.
 * @param {string} target
 * @param {{ platform?: string, run?: Run }} [options] seams for the tests
 * @returns {Promise<Opened>}
 */
export function openLink(target, { platform = process.platform, run = execFile } = {}) {
  /** @type {(note: string | null, reused?: boolean) => Opened} */
  const result = (note, reused = false) => ({ opened: note == null, reused, note });
  if (platform === 'win32')
    return Promise.resolve(result('pxsig opens no browser on Windows: open the link above'));
  /** @type {(program: string, args: string[]) => Promise<{ err: Error | null, out: string }>} */
  const start = (program, args) =>
    new Promise((resolve) => {
      try {
        run(program, args, (err, out) => resolve({ err, out: typeof out === 'string' ? out : '' }));
      } catch (e) {
        // refused by lib/spawn.mjs (an OS without an opener on its list)
        resolve({ err: /** @type {Error} */ (e), out: '' });
      }
    });
  const failed = (/** @type {Error} */ err) =>
    result(`could not open a browser (${err.message.split('\n')[0]}): open the link above`);
  if (platform !== 'darwin')
    return start('xdg-open', [target]).then(({ err }) => (err ? failed(err) : result(null)));
  return start('osascript', ['-e', reuseTabScript(target)]).then(({ err, out }) =>
    !err && out.trim() === 'reused'
      ? result(null, true)
      : start('open', [target]).then(({ err: e }) => (e ? failed(e) : result(null)))
  );
}
