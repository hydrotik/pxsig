/**
 * live/themes.mjs — the live screens' themes side by side (scripts/live/run.mjs): one process per
 * theme, each with its own browser, workspace, server, store, state home and renders, and a log
 * whose every line names its theme. A theme's own runs stay one after another (run 1, then run 2),
 * so the repeat check between them is unchanged.
 *
 * A process per theme, not a browser context: a run starts the CLI with spawnSync (the scratch
 * store's checks, `pxsig check --full` from a terminal), which blocks its process' event loop for
 * seconds, and so would stall the other theme's page (its scrubbed requests are answered there).
 *
 * A theme's runs write to their workspace (the scratch store, Badge.jsx and storybook-static, the
 * server's node_modules/.cache/pxsig/server.json and CLI token, the React analysis), so no two
 * themes share one: each gets `target/pxsig-live-<theme>`, a copy of the staged workspace
 * (scripts/live/stage.mjs: its packages/ links and the example), made before the theme's first run.
 * The copy keeps every symbolic link as it is and sits at the staging folder's depth, so the
 * relative links (pnpm's, the React Compiler's) resolve as in the staged one; the example keeps its
 * folder name, so nothing a screen shows changes. The staged workspace and its pristine copies are
 * only read. The state home is scripts/examples/shared.mjs's, a new temp folder per process. Each
 * server takes its own free port (scripts/live/server.mjs).
 */
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LIVE_BASE, liveDir } from './stage.mjs';

/** @import { ScreenResult } from '../../packages/pxsig/src/types/t4.js' */
/** @typedef {{ theme: 'dark' | 'light', base: string, dir: string }} LiveWorkspace */
/** @typedef {{ dashboard: string, axe: string, out: string, keep: string, repeat: number, only: string[] | null, text: { ignore: string[] } | null }} ThemeOptions */

const CHILD = fileURLToPath(new URL('./theme-run.mjs', import.meta.url));

/** A theme's staging folder, beside the staged one (same depth). */
export const themeBase = (/** @type {string} */ theme) => `${LIVE_BASE}-${theme}`;

/**
 * Copy a file or a folder; a symbolic link is copied as the link it is, never followed.
 * @param {string} from
 * @param {string} to
 */
function copyVerbatim(from, to) {
  const st = lstatSync(from);
  if (st.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else if (!st.isDirectory()) copyFileSync(from, to);
  else {
    mkdirSync(to);
    for (const name of readdirSync(from)) copyVerbatim(join(from, name), join(to, name));
  }
}

/**
 * A fresh workspace for one theme: the staged one copied, any earlier copy removed first.
 * @param {'dark' | 'light'} theme
 * @returns {LiveWorkspace}
 */
export function themeWorkspace(theme) {
  const base = themeBase(theme);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(join(base, 'examples'), { recursive: true });
  copyVerbatim(join(LIVE_BASE, 'packages'), join(base, 'packages'));
  copyVerbatim(liveDir(), liveDir(base));
  return { theme, base, dir: liveDir(base) };
}

/**
 * A log whose lines name the theme: `[live] scratch store: …` becomes `[live] dark: scratch
 * store: …`; a line that already starts with `[live] dark: ` (a run's start, the repeat summary)
 * is logged as it is.
 * @param {(m: string) => void} log
 * @param {string} theme
 */
export const themeLog = (log, theme) => (/** @type {string} */ m) =>
  log(m.startsWith(`[live] ${theme}: `) ? m : m.replace(/^(?:\[live\] )?/, `[live] ${theme}: `));

/**
 * One theme's live screens in a process of its own (scripts/live/theme-run.mjs). Its stdout goes
 * to `log`, its stderr to stderr, each line through themeLog.
 * @param {'dark' | 'light'} theme
 * @param {ThemeOptions} o
 * @param {(m: string) => void} log
 * @returns {Promise<ScreenResult[]>}
 */
function inProcess(theme, o, log) {
  const dir = join(o.out, theme);
  mkdirSync(dir, { recursive: true });
  const input = join(dir, 'options.json');
  const output = join(dir, 'results.json');
  rmSync(output, { force: true });
  writeFileSync(input, JSON.stringify({ ...o, theme }));
  const child = spawn(process.execPath, [CHILD, input, output], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  createInterface({ input: child.stdout }).on('line', themeLog(log, theme));
  createInterface({ input: child.stderr }).on(
    'line',
    themeLog((m) => console.error(m), theme)
  );
  return new Promise((ok, fail) => {
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (code === 0 && existsSync(output))
        // results.json, as theme-run.mjs wrote it.
        ok(/** @type {ScreenResult[]} */ (JSON.parse(readFileSync(output, 'utf8'))));
      else fail(new Error(`[live] ${theme}: its process ended with ${signal ?? `exit ${code}`}`));
    });
  });
}

/**
 * Every theme's live screens, the themes side by side; the results in `themes` order. Each theme
 * runs to its end even when another fails; then the first failure is thrown.
 * @param {('dark' | 'light')[]} themes
 * @param {ThemeOptions} o
 * @param {(m: string) => void} log
 * @returns {Promise<ScreenResult[]>}
 */
export async function sideBySide(themes, o, log) {
  log(`[live] ${themes.join(' and ')} side by side, ${availableParallelism()} CPUs`);
  const settled = await Promise.allSettled(themes.map((t) => inProcess(t, o, log)));
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}
