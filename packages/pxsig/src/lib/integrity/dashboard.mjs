/**
 * `dashboard-stale` (docs/integrity.md#setup-problems): a dashboard build `pxsig serve` would not
 * serve because it is for another pxsig version, or records none (lib/dashboard-dir.mjs). The build
 * is the one PXSIG_DASHBOARD_DIR names, else the project's own `dashboard.ui` build; serve then
 * serves the prebuilt dashboard. A missing build is not a problem here: serve says so itself.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDirFor, shellWord, uiOf, versionMismatch } from '../dashboard-dir.mjs';
import { herePath } from '../machine.mjs';
import { PXSIG_VERSION } from '../workspace/versions.mjs';
/** @import { Project } from '../../types.js' */
/** @import { LedgerSetup } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

/**
 * @param {IntegrityContext} ctx
 * @param {{ env?: Record<string, string | undefined>, version?: string, cwd?: string }} [o]
 * @returns {LedgerSetup[]}
 */
export function dashboardProblems(ctx, { env = process.env, version = PXSIG_VERSION, cwd } = {}) {
  /** @type {Project | undefined} */
  const P = ctx.project;
  if (!P) return [];
  const here = (/** @type {string} */ p) => herePath(p, { cwd: cwd ?? process.cwd() });
  /** @type {{ dir: string, what: string, fix: string } | null} */
  let build = null;
  if (env.PXSIG_DASHBOARD_DIR) {
    const dir = resolve(cwd ?? process.cwd(), env.PXSIG_DASHBOARD_DIR);
    build = {
      dir,
      what: `the dashboard build in ${here(dir)} (PXSIG_DASHBOARD_DIR)`,
      fix: `run \`pxsig dashboard build --out ${shellWord(here(dir))}\``,
    };
  } else {
    const ui = uiOf(P);
    if (ui)
      build = {
        dir: buildDirFor(P.root),
        what: `the dashboard build for dashboard.ui (${ui})`,
        fix: `run \`pxsig dashboard build\` in ${shellWord(here(P.root))}`,
      };
  }
  if (!build || !existsSync(join(build.dir, 'index.html'))) return [];
  const off = versionMismatch(build.dir, version);
  if (!off) return [];
  return [
    {
      code: 'dashboard-stale',
      severity: ctx.integrity?.severity?.['dashboard-stale'] ?? 'warn',
      reason: `${build.what} ${off}: \`pxsig serve\` serves the prebuilt dashboard instead. To serve it, ${build.fix}`,
    },
  ];
}
