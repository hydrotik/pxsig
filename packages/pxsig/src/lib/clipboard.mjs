/**
 * clipboard.mjs — put the dashboard link on the clipboard: `pxsig serve --link --copy`.
 *
 *   macOS    `pbcopy`
 *   Linux    `wl-copy` (Wayland), else `xclip -selection clipboard` (X11)
 *   Windows  nothing is started (it would take a shell): the caller says to copy the printed link
 *
 * Opt-in: any program on this computer, an assistant included, can read the clipboard, while the
 * printed link reaches only the person at the terminal. The link works once and has 5 minutes to be
 * accessed, so what the clipboard holds stops working soon. Programs start through lib/spawn.mjs,
 * without a shell; the link goes on stdin, never on a command line.
 */
import { spawn } from './spawn.mjs';

/**
 * @typedef {(program: string, args: string[], input: string) => Promise<Error | null>} Feed
 *   start `program`, write `input` to its stdin, resolve with null when it exits 0
 * @typedef {{ copied: boolean, note: string | null }} Copied
 *   `note`: why nothing was copied (null when it was)
 */

/** @type {Feed} */
export const feed = (program, args, input) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(program, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (e) {
      // refused by lib/spawn.mjs
      resolve(/** @type {Error} */ (e));
      return;
    }
    child.once('error', resolve);
    child.once('close', (code) => resolve(code === 0 ? null : new Error(`exit ${code}`)));
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });

/** The programs to try on each OS, in order. */
export const COPIERS = /** @type {Record<string, [string, string[]][]>} */ ({
  darwin: [['pbcopy', []]],
  linux: [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
  ],
});

/**
 * Copy `text` to the clipboard. Never rejects: a missing or failing copier is a `note`, and the
 * caller has printed the link anyway.
 * @param {string} text
 * @param {{ platform?: string, run?: Feed }} [options] seams for the tests
 * @returns {Promise<Copied>}
 */
export async function copyText(text, { platform = process.platform, run = feed } = {}) {
  const copiers = COPIERS[platform];
  if (!copiers)
    return { copied: false, note: 'pxsig copies nothing on this OS: copy the link above' };
  /** @type {string[]} */
  const failed = [];
  for (const [program, args] of copiers) {
    const err = await run(program, args, text);
    if (!err) return { copied: true, note: null };
    failed.push(`${program}: ${err.message.split('\n')[0]}`);
  }
  return { copied: false, note: `could not copy (${failed.join('; ')}): copy the link above` };
}
