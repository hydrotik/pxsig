/**
 * live/theme-run.mjs — one theme's live screens, in a process of its own (scripts/live/themes.mjs
 * starts one per theme):
 *
 *   node scripts/live/theme-run.mjs <options.json> <results.json>
 *
 * The options are runTheme's (scripts/live/run.mjs) but the browser, which this process launches
 * as scripts/screens-check.mjs does (the dashboard project's browser pool: the same engine and
 * launch arguments). The results, one per step, are written as JSON; a crash exits 2
 * (scripts/lib/crash.mjs) and writes none.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserPool } from '../../packages/pxsig/src/lib/capture.mjs';
import { openProject } from '../../packages/pxsig/src/lib/workspace.mjs';
import { asMain } from '../lib/crash.mjs';
import { runTheme } from './run.mjs';
import { repo } from './stage.mjs';

/** @import { ThemeOptions } from './themes.mjs' */

if (asMain(import.meta.url, 'live')) {
  const [input, output] = process.argv.slice(2);
  // options.json, as themes.mjs wrote it.
  const o = /** @type {ThemeOptions & { theme: 'dark' | 'light' }} */ (
    JSON.parse(readFileSync(input, 'utf8'))
  );
  const pool = browserPool(openProject({ cwd: join(repo, 'packages', 'dashboard') }));
  try {
    const browser = await pool.get('chromium');
    const results = await runTheme({ ...o, browser, log: (m) => console.log(m) });
    writeFileSync(output, JSON.stringify(results));
  } finally {
    await pool.close();
  }
}
