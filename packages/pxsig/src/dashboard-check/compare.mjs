/**
 * dashboard-check/compare.mjs — `pxsig dashboard check --compare <dir>`: each screen against the
 * same screen (feature, screen number, theme) of an earlier check's output, with pxsig's own
 * engine and the gate stories get by default:
 *
 *   1. `pxsig capture <earlier.png> --detail`: the earlier screenshot as a baseline;
 *   2. `pxsig compare <new.png> <baseline> --json`: the verdict and its metrics (SSIM, changed
 *      cells), the same numbers an entry's check reports;
 *   3. for a changed screen, `pxsig diff <earlier.png> <new.png> --mask`: the changed pixels, which
 *      the gallery shows beside the two screenshots.
 *
 * Writes under the check's --out only (shots/earlier, shots/diff, a scratch folder it removes).
 * Advisory: a changed screen never changes the exit code.
 */
import { spawnSync } from '../lib/spawn.mjs';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '../lib/files.mjs';
/** @import { DashboardCheckReport, ScreenCompare, ScreenResult } from '../types/t4.js' */

/** The key a screen is matched by between two runs. */
export const screenKey = (/** @type {Pick<ScreenResult, 'feature' | 'index' | 'theme'>} */ x) =>
  `${x.feature}#${x.index + 1}@${x.theme}`;

/**
 * The earlier check's report.json, or why it cannot be used.
 * @param {string} dir
 * @returns {{ report: DashboardCheckReport, error: null } | { report: null, error: string }}
 */
export function readEarlier(dir) {
  const report = /** @type {DashboardCheckReport | null} */ (readJson(join(dir, 'report.json')));
  if (!report?.screens)
    return {
      report: null,
      error: `no dashboard check output at ${dir} (report.json is missing or has no screens): run \`pxsig dashboard check --out ${dir}\` on the earlier build first`,
    };
  return { report, error: null };
}

/**
 * Compare every rendered screen with its earlier one. Sets `compare` on each screen and returns
 * the screens of the earlier run that this one no longer has (of those `inScope`: the features and
 * themes this run checks).
 * @param {{ screens: ScreenResult[], earlier: DashboardCheckReport, earlierDir: string, outDir: string, bin: string, inScope: (x: ScreenResult) => boolean }} o
 * @returns {string[]} keys of screens only the earlier run has
 */
export function compareScreens({ screens, earlier, earlierDir, outDir, bin, inScope }) {
  /** @type {Map<string, ScreenResult>} */
  const before = new Map(earlier.screens.map((x) => [screenKey(x), x]));
  const scratch = join(outDir, '.compare');
  mkdirSync(scratch, { recursive: true });
  /** @param {string[]} args */
  const run = (args) => spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  try {
    for (const x of screens) {
      const was = before.get(screenKey(x));
      before.delete(screenKey(x));
      /** @type {ScreenCompare} */
      let c;
      if (!was?.shot || !existsSync(join(earlierDir, was.shot)))
        c = {
          status: was ? 'not-rendered-before' : 'new',
          ssim: null,
          changedCellsPct: null,
          reasons: [],
          earlier: null,
          diff: null,
        };
      else if (!x.shot)
        c = {
          status: 'not-rendered',
          ssim: null,
          changedCellsPct: null,
          reasons: [],
          earlier: null,
          diff: null,
        };
      else {
        const file = x.shot.split('/').pop() ?? 'shot.png';
        const earlierShot = `shots/earlier/${file}`;
        mkdirSync(join(outDir, 'shots', 'earlier'), { recursive: true });
        copyFileSync(join(earlierDir, was.shot), join(outDir, earlierShot));
        const sig = join(scratch, `${file}.psig`);
        const cap = run(['capture', join(outDir, earlierShot), '--out', sig, '--detail']);
        if (cap.status !== 0)
          throw new Error(
            `pxsig capture failed: ${(cap.stderr || cap.error?.message || '').trim()}`
          );
        const cmp = run(['compare', join(outDir, x.shot), sig, '--json', '--out-dir', scratch]);
        if (cmp.status !== 0 && cmp.status !== 1)
          throw new Error(
            `pxsig compare failed: ${(cmp.stderr || cmp.error?.message || '').trim()}`
          );
        // `pxsig compare --json`'s answer (docs/cli.md, engine commands).
        const v =
          /** @type {{ pass: boolean, metrics: { ssim: number, changedCellsPct: number, identical: boolean }, reasons: string[] }} */ (
            JSON.parse(cmp.stdout)
          );
        let diff = null;
        if (!v.pass) {
          diff = `shots/diff/${file}`;
          mkdirSync(join(outDir, 'shots', 'diff'), { recursive: true });
          run([
            'diff',
            join(outDir, earlierShot),
            join(outDir, x.shot),
            '--mask',
            join(outDir, diff),
            '--json',
          ]);
          if (!existsSync(join(outDir, diff))) diff = null;
        }
        c = {
          status: v.pass ? 'same' : 'changed',
          ssim: v.metrics.ssim,
          changedCellsPct: v.metrics.changedCellsPct,
          reasons: v.reasons,
          earlier: earlierShot,
          diff,
        };
      }
      x.compare = c;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  // Only screens this run could have rendered: --only and --themes leave the others out.
  return [...before.entries()].filter(([, x]) => inScope(x)).map(([k]) => k);
}
