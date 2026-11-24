/**
 * `dashboard-stale` (docs/integrity.md#setup-problems): a dashboard build `pxsig serve` would not
 * serve because it is for another pxsig version, or records none (lib/dashboard-dir.mjs). The build
 * is the one PXSIG_DASHBOARD_DIR names, else the project's own `dashboard.ui` build; serve then
 * serves the prebuilt dashboard. A missing build is not a problem here: serve says so itself.
 * Run from a git checkout of pxsig, a build is also stale when the commit it records, or its
 * uncommitted changes, are not the checkout's (lib/build-identity.mjs), and so is the prebuilt
 * dashboard when serve would serve it.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PREBUILT, pxsigSource, sourceMismatch } from '../build-identity.mjs';
import { buildDirFor, PREBUILT_FIX, shellWord, staleReason, uiOf } from '../dashboard-dir.mjs';
import { herePath } from '../machine.mjs';
import { PXSIG_VERSION } from '../workspace/versions.mjs';
/** @import { Project } from '../../types.js' */
/** @import { LedgerSetup } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

/**
 * @param {IntegrityContext} ctx
 * @param {{ env?: Record<string, string | undefined>, version?: string, cwd?: string, checkout?: import('../build-identity.mjs').SourceState | null, prebuilt?: string }} [o]
 * @returns {LedgerSetup[]}
 */
export function dashboardProblems(
  ctx,
  {
    env = process.env,
    version = PXSIG_VERSION,
    cwd,
    checkout = pxsigSource(),
    prebuilt = PREBUILT,
  } = {}
) {
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
  const severity = ctx.integrity?.severity?.['dashboard-stale'] ?? 'warn';
  /** @type {LedgerSetup[]} */
  const out = [];
  const built = build && existsSync(join(build.dir, 'index.html')) ? build : null;
  const off = built ? staleReason(built.dir, version, checkout) : null;
  if (built && off)
    out.push({
      code: 'dashboard-stale',
      severity,
      reason: `${built.what} ${off}: \`pxsig serve\` serves the prebuilt dashboard instead. To serve it, ${built.fix}`,
    });
  // The prebuilt dashboard, when serve would serve it: no build asked for, a stale one, or no
  // dashboard.ui build yet (a PXSIG_DASHBOARD_DIR folder with none is served as named).
  const served = !build || off || (!built && !env.PXSIG_DASHBOARD_DIR);
  const old = served ? sourceMismatch(prebuilt, checkout) : null;
  if (old)
    out.push({
      code: 'dashboard-stale',
      severity,
      reason: `the prebuilt dashboard ${old}: \`pxsig serve\` serves it as it is. To rebuild it, ${PREBUILT_FIX}`,
    });
  return out;
}
