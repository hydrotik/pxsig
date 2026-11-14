#!/usr/bin/env node
/**
 * dashboard-build.mjs — this repository's dashboard build (`pnpm build:dashboard`, `pnpm --filter
 * @pxsig/dashboard build`): Vite with packages/dashboard/vite.config.mjs, then postbuild.mjs (a
 * classic script) and scripts/build-record.mjs (BUILD.json).
 *
 * pxsig has one UI, the hydrotik design system, so with no adapter named (no PXSIG_UI_ADAPTER, no
 * `dashboard.ui` in the pxsig.config.json of the folder pnpm ran in) the build is the `hydrotik`
 * adapter, compiled from:
 *   1. PXSIG_DS_SOURCE, when it names a folder (a design-system checkout, used as it is), else
 *   2. target/design-system at the commit pinned in design-system.json, fetched first when it is
 *      missing or stale (scripts/ds-fetch.mjs; PXSIG_DS_SOURCE, when set to a git URL, or
 *      `git config pxsig.dsSource` names where from).
 * When neither can be had the build fails and says how to fix it; it never falls back to plain.
 * Naming an adapter still works, for the builds where another UI is the subject (the custom-UI
 * example, the adapter-contract checks): `PXSIG_UI_ADAPTER=plain`, or a path. A named `hydrotik`
 * without PXSIG_DS_SOURCE gets target/design-system too.
 *
 * This is the repository's entry only: `pxsig dashboard build` in a consumer project keeps
 * build-config.mjs's own default (plain without a design system), since npm consumers cannot get
 * the unpublished design system.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adapterSpec } from '../packages/dashboard/build-config.mjs';
import { DsFetchError, ensureDesignSystem } from './ds-fetch.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const dashboard = join(repo, 'packages', 'dashboard');

/**
 * The environment additions that make the build in force the repository's: none when another
 * adapter is named, else `hydrotik` and the design-system folder.
 * @param {object} [o]
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {string} [o.cwd]     where pxsig.config.json is read (pnpm's INIT_CWD)
 * @param {() => string} [o.ensure]  target/design-system at the pin (scripts/ds-fetch.mjs)
 * @returns {{ add: Record<string, string>, why: string }}
 */
export function repoBuildEnv({
  env = process.env,
  cwd = env.INIT_CWD ?? process.cwd(),
  ensure = () => ensureDesignSystem({ repo, env }),
} = {}) {
  const saved = process.env;
  /** @type {{ spec: string, from: string }} */
  let picked;
  try {
    // adapterSpec reads process.env: let it read `env`.
    process.env = env;
    picked = adapterSpec({ cwd });
  } finally {
    process.env = saved;
  }
  const named = !picked.from.startsWith('default');
  if (named && picked.spec !== 'hydrotik')
    return { add: {}, why: `${picked.spec} (${picked.from})` };
  const src = env.PXSIG_DS_SOURCE;
  const local = src && existsSync(src) && statSync(src).isDirectory() ? src : null;
  const ds = local ?? ensure();
  return {
    add: { PXSIG_UI_ADAPTER: 'hydrotik', PXSIG_DS_SOURCE: ds },
    why: `hydrotik (${named ? picked.from : 'this repository'}), design system from ${local ? 'PXSIG_DS_SOURCE' : 'target/design-system'}`,
  };
}

/** Vite's command-line script, from the dashboard's own dependencies. */
function viteBin() {
  const pj = join(dashboard, 'node_modules', 'vite', 'package.json');
  // vite's package.json: `bin.vite` is its CLI, relative to the package.
  const { bin } = /** @type {{ bin: { vite: string } }} */ (JSON.parse(readFileSync(pj, 'utf8')));
  return join(dashboard, 'node_modules', 'vite', bin.vite);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  /** @type {{ add: Record<string, string>, why: string }} */
  let plan;
  try {
    plan = repoBuildEnv();
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    if (e instanceof DsFetchError)
      console.error(
        '\n[dashboard-build] the dashboard in this repository builds on the hydrotik design system; to build another adapter on purpose, name it: PXSIG_UI_ADAPTER=plain (or a path).'
      );
    process.exit(1);
  }
  console.log(`[dashboard-build] adapter: ${plan.why}`);
  const env = { ...process.env, ...plan.add };
  for (const args of [
    [viteBin(), 'build', '--config', 'vite.config.mjs'],
    ['postbuild.mjs'],
    [join(repo, 'scripts', 'build-record.mjs')],
  ]) {
    const r = spawnSync(process.execPath, args, { cwd: dashboard, env, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
