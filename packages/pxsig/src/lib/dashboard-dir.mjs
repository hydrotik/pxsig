/**
 * dashboard-dir.mjs — which dashboard `pxsig serve` serves.
 *
 *   1. PXSIG_DASHBOARD_DIR, when set.
 *   2. A project's own build, when its pxsig.config.json names a UI adapter (`dashboard.ui`) and
 *      `pxsig dashboard build` has written <project>/node_modules/.cache/pxsig/dashboard with this
 *      pxsig version, after the adapter's last edit.
 *   3. Otherwise the prebuilt dashboard. When (2) was asked for but is missing or out of date, a
 *      note says so with the exact command. Serve never builds by itself: a build needs the
 *      project's Vite and can fail or take a while, and the prebuilt dashboard always works.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Where `pxsig dashboard build` writes by default, for the project in `dir`. */
export const buildDirFor = (dir) => join(dir, 'node_modules', '.cache', 'pxsig', 'dashboard');
/** What a build records beside its index.html. */
export const STAMP = 'pxsig-build.json';

const BUILTIN = /^[a-z0-9][a-z0-9-]*$/;

/** The newest modification time under a file or folder (node_modules and dot folders skipped). */
export function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    newest = Math.max(newest, newestMtime(join(p, e.name)));
  }
  return newest;
}

function uiOf(project) {
  try {
    const ui = JSON.parse(readFileSync(project.configPath, 'utf8'))?.dashboard?.ui;
    return typeof ui === 'string' && ui ? ui : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {{ name: string, dir: string, configPath: string }[]} o.projects  the projects served
 * @param {string} o.prebuilt     the prebuilt dashboard folder
 * @param {string} o.version      this pxsig's version
 * @param {string | null} [o.contract]  this pxsig's UI contract version (a build for another major is not served)
 * @param {string} [o.root]       the workspace root, for relative paths in notes
 * @param {(name: string) => string | null} [o.builtinDir]  a built-in adapter's folder, for staleness
 * @param {Record<string, string | undefined>} [o.env]
 * @returns {{ dir: string, source: 'env' | 'adapter' | 'prebuilt', note: string | null }}
 */
export function chooseDashboard({ projects, prebuilt, version, contract = null, root = process.cwd(), builtinDir = () => null, env = process.env }) {
  if (env.PXSIG_DASHBOARD_DIR) return { dir: resolve(env.PXSIG_DASHBOARD_DIR), source: 'env', note: `dashboard: ${env.PXSIG_DASHBOARD_DIR} (PXSIG_DASHBOARD_DIR)` };
  const asking = projects.map((p) => ({ p, ui: uiOf(p) })).filter((x) => x.ui);
  if (!asking.length) return { dir: prebuilt, source: 'prebuilt', note: null };
  const rel = (p) => relative(root, p) || '.';
  const adapterPath = ({ p, ui }) => (BUILTIN.test(ui) ? `builtin:${ui}` : resolve(p.dir, ui));
  const distinct = [...new Set(asking.map(adapterPath))];
  if (distinct.length > 1)
    return {
      dir: prebuilt,
      source: 'prebuilt',
      note: `dashboard: projects name different UI adapters (${asking.map((x) => `${x.p.name}: ${x.ui}`).join(', ')}); serving the prebuilt dashboard. Set PXSIG_DASHBOARD_DIR to one build.`,
    };
  const { p, ui } = asking[0];
  const out = buildDirFor(p.dir);
  const command = `run \`pxsig dashboard build\` in ${rel(p.dir)}`;
  const where = `dashboard.ui (${ui}) in ${rel(p.configPath)}`;
  if (!existsSync(join(out, 'index.html'))) return { dir: prebuilt, source: 'prebuilt', note: `dashboard: ${where} has no build yet: ${command}. Serving the prebuilt dashboard.` };
  let stamp = null;
  try {
    stamp = JSON.parse(readFileSync(join(out, STAMP), 'utf8'));
  } catch {
    // a build from before stamps, or a hand-made folder: judged by its index.html
  }
  const builtAt = stamp?.builtAt ?? statSync(join(out, 'index.html')).mtimeMs;
  if (stamp?.pxsig && stamp.pxsig !== version)
    return { dir: prebuilt, source: 'prebuilt', note: `dashboard: the build for ${where} is from pxsig ${stamp.pxsig} (this is ${version}): ${command}. Serving the prebuilt dashboard.` };
  if (stamp?.contract && contract && stamp.contract.split('.')[0] !== contract.split('.')[0])
    return { dir: prebuilt, source: 'prebuilt', note: `dashboard: the build for ${where} is for UI contract ${stamp.contract} (this pxsig has ${contract}): update the adapter (docs/ui/contract-changes.md), then ${command}. Serving the prebuilt dashboard.` };
  const adapterDir = BUILTIN.test(ui) ? builtinDir(ui) : resolve(p.dir, ui);
  const edited = adapterDir ? newestMtime(adapterDir) : 0;
  if (edited > builtAt) return { dir: prebuilt, source: 'prebuilt', note: `dashboard: the adapter for ${where} changed after its last build: ${command}. Serving the prebuilt dashboard.` };
  return { dir: out, source: 'adapter', note: `dashboard: built with the UI adapter ${ui} (${rel(out)})` };
}
