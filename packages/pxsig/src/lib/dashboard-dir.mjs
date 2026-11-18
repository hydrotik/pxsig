/**
 * dashboard-dir.mjs — which dashboard `pxsig serve` serves.
 *
 *   1. PXSIG_DASHBOARD_DIR, when set and its build is from this pxsig version.
 *   2. A project's own build, when its pxsig.config.json names a UI adapter (`dashboard.ui`) and
 *      `pxsig dashboard build` has written <project>/node_modules/.cache/pxsig/dashboard with this
 *      pxsig version, after the adapter's last edit.
 *   3. Otherwise the prebuilt dashboard. When (1) or (2) was asked for but is missing or out of
 *      date, a note says so with the exact command. A build is for one pxsig version only: one
 *      from another version, or one that records none, is out of date. Serve never builds by itself: a build needs the
 *      project's Vite and can fail or take a while, and the prebuilt dashboard always works.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readJson } from './files.mjs';

/**
 * Where `pxsig dashboard build` writes by default, for the project in `dir`.
 * @param {string} dir
 */
export const buildDirFor = (dir) => join(dir, 'node_modules', '.cache', 'pxsig', 'dashboard');
/** What a build records beside its index.html. */
export const STAMP = 'pxsig-build.json';

const BUILTIN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * `p` as one POSIX shell word: as it is when it needs no quoting, else single-quoted (after a
 * leading `~/`, which the shell expands only outside quotes).
 * @param {string} p
 */
export const shellWord = (p) => {
  if (/^[\w./~@%+=:,-]+$/.test(p)) return p;
  const home = p.startsWith('~/') ? '~/' : '';
  return `${home}'${p.slice(home.length).replace(/'/g, `'\\''`)}'`;
};

/**
 * The pxsig version a dashboard build records: the stamp `pxsig dashboard build` writes, else the
 * reference build's BUILD.json (scripts/build-record.mjs); null when it records none.
 * @param {string} dir
 * @returns {string | null}
 */
export function builtVersion(dir) {
  for (const file of [STAMP, 'BUILD.json']) {
    // Either file's JSON; only its `pxsig` string is read.
    const v = /** @type {{ pxsig?: unknown } | null} */ (readJson(join(dir, file), null))?.pxsig;
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * Why the build in `dir` is not for pxsig `version` (`is from pxsig 0.7.6 (this is 0.7.7)`,
 * `records no pxsig version (this is 0.7.7)`), or null when it is.
 * @param {string} dir
 * @param {string} version
 */
export function versionMismatch(dir, version) {
  const v = builtVersion(dir);
  if (v === version) return null;
  return v
    ? `is from pxsig ${v} (this is ${version})`
    : `records no pxsig version (this is ${version})`;
}

/**
 * The newest modification time under a file or folder (node_modules and dot folders skipped).
 * @param {string} p
 * @returns {number}
 */
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

/**
 * The UI adapter a project's config names (`dashboard.ui`), or null.
 * @param {{ configPath: string }} project
 * @returns {string | null}
 */
export function uiOf(project) {
  // The config file's JSON, read only through optional chaining; `ui` is checked below.
  const ui = /** @type {{ dashboard?: { ui?: unknown } } | null} */ (
    readJson(project.configPath, null)
  )?.dashboard?.ui;
  return typeof ui === 'string' && ui ? ui : null;
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
export function chooseDashboard({
  projects,
  prebuilt,
  version,
  contract = null,
  root = process.cwd(),
  builtinDir = () => null,
  env = process.env,
}) {
  if (env.PXSIG_DASHBOARD_DIR) {
    const dir = resolve(env.PXSIG_DASHBOARD_DIR);
    // A folder with no build is served as named: the server's answer says it is not built.
    const off = existsSync(join(dir, 'index.html')) ? versionMismatch(dir, version) : null;
    if (off)
      return {
        dir: prebuilt,
        source: 'prebuilt',
        note: `dashboard: the build in ${env.PXSIG_DASHBOARD_DIR} (PXSIG_DASHBOARD_DIR) ${off}: run \`pxsig dashboard build --out ${shellWord(env.PXSIG_DASHBOARD_DIR)}\`. Serving the prebuilt dashboard.`,
      };
    return {
      dir,
      source: 'env',
      note: `dashboard: ${env.PXSIG_DASHBOARD_DIR} (PXSIG_DASHBOARD_DIR)`,
    };
  }
  // The filter keeps only the projects whose config names an adapter: `ui` is a string.
  const asking =
    /** @type {{ p: { name: string, dir: string, configPath: string }, ui: string }[]} */ (
      projects.map((p) => ({ p, ui: uiOf(p) })).filter((x) => x.ui)
    );
  if (!asking.length) return { dir: prebuilt, source: 'prebuilt', note: null };
  const rel = (/** @type {string} */ p) => relative(root, p) || '.';
  /** @param {{ p: { dir: string }, ui: string }} x */
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
  if (!existsSync(join(out, 'index.html')))
    return {
      dir: prebuilt,
      source: 'prebuilt',
      note: `dashboard: ${where} has no build yet: ${command}. Serving the prebuilt dashboard.`,
    };
  const off = versionMismatch(out, version);
  if (off)
    return {
      dir: prebuilt,
      source: 'prebuilt',
      note: `dashboard: the build for ${where} ${off}: ${command}. Serving the prebuilt dashboard.`,
    };
  // pxsig-build.json, as `pxsig dashboard build` writes it (it names this version: checked above).
  const stamp = /** @type {{ builtAt?: number, contract?: string } | null} */ (
    readJson(join(out, STAMP), null)
  );
  const builtAt = stamp?.builtAt ?? statSync(join(out, 'index.html')).mtimeMs;
  if (stamp?.contract && contract && stamp.contract.split('.')[0] !== contract.split('.')[0])
    return {
      dir: prebuilt,
      source: 'prebuilt',
      note: `dashboard: the build for ${where} is for UI contract ${stamp.contract} (this pxsig has ${contract}): update the adapter (docs/ui/contract-changes.md), then ${command}. Serving the prebuilt dashboard.`,
    };
  const adapterDir = BUILTIN.test(ui) ? builtinDir(ui) : resolve(p.dir, ui);
  const edited = adapterDir ? newestMtime(adapterDir) : 0;
  if (edited > builtAt)
    return {
      dir: prebuilt,
      source: 'prebuilt',
      note: `dashboard: the adapter for ${where} changed after its last build: ${command}. Serving the prebuilt dashboard.`,
    };
  return {
    dir: out,
    source: 'adapter',
    note: `dashboard: built with the UI adapter ${ui} (${rel(out)})`,
  };
}
