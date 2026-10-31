/**
 * Finding the workspace and its projects (workspace.mjs), the workspace-level problems the integrity
 * ledger reports, and the `requires` version range.
 */
/** @import { ConfigFile, PackageJson, Project, ProjectRef, SetupProblem, Workspace, WorkspaceFile } from '../../types.js' */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { toPosix } from '../paths.mjs';
import { SetupError, readJsonFile } from './core.mjs';
import { isObj } from './layers.mjs';
import { workspaceId } from './peers.mjs';
import { PXSIG_VERSION, engineProblems, imageProblems } from './versions.mjs';

export const WORKSPACE_FILE = 'pxsig.workspace.json';
export const CONFIG_FILE = 'pxsig.config.json';

/**
 * Walk up from `start` to the first folder holding `name`; stops after a `.git` folder.
 * @param {string} start
 * @param {string} name
 * @returns {string | null}
 */
function findUp(start, name) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, name))) return join(dir, name);
    if (existsSync(join(dir, '.git'))) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Find the workspace from `cwd` (or `--workspace` / PXSIG_WORKSPACE, or the legacy PXSIG_ROOT).
 * @param {{ cwd?: string, workspace?: string | null, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Workspace}
 */
export function findWorkspace({ cwd = process.cwd(), workspace = null, env = process.env } = {}) {
  const forced = workspace ?? env.PXSIG_WORKSPACE ?? env.PXSIG_ROOT ?? null;
  let file = null;
  let root = null;
  if (forced) {
    root = resolve(cwd, forced);
    file = existsSync(join(root, WORKSPACE_FILE)) ? join(root, WORKSPACE_FILE) : null;
    if (!file && !existsSync(join(root, CONFIG_FILE)))
      throw new SetupError(`no ${WORKSPACE_FILE} or ${CONFIG_FILE} in ${root}`);
  } else {
    file = findUp(cwd, WORKSPACE_FILE);
    if (file) root = dirname(file);
    else {
      const cfg = findUp(cwd, CONFIG_FILE);
      if (!cfg)
        throw new SetupError(
          `no ${WORKSPACE_FILE} or ${CONFIG_FILE} here or above ${cwd}: run \`pxsig init\` in the package to test`
        );
      root = dirname(cfg);
    }
  }
  if (!file) {
    const configPath = join(root, CONFIG_FILE);
    // A project config as written (schema/project.json): `name` is a string when set.
    const cfg = /** @type {ConfigFile} */ (readJsonFile(configPath));
    return {
      root,
      id: workspaceId(root),
      file: null,
      label: null,
      defaults: {},
      server: {},
      projects: [{ name: cfg.name ?? packageName(root) ?? 'default', dir: root, configPath }],
    };
  }
  // pxsig.workspace.json as written (schema/workspace.json); `projects` is checked next.
  const ws = /** @type {WorkspaceFile} */ (readJsonFile(file));
  if (!isObj(ws.projects))
    throw new SetupError(`${file}: "projects" must map a project name to its folder`);
  if (ws.requires != null) {
    const ok = satisfies(PXSIG_VERSION, ws.requires);
    if (ok === null)
      throw new SetupError(
        `${file}: "requires" is not a version range pxsig reads ("${ws.requires}"; for example ">=0.4.0")`
      );
    if (!ok)
      throw new SetupError(
        `${file} requires pxsig ${ws.requires}; this is pxsig ${PXSIG_VERSION}: install a version in that range`,
        { code: 'version-required' }
      );
  }
  const projects = Object.entries(ws.projects).map(([name, rel]) => {
    if (typeof rel !== 'string')
      throw new SetupError(
        `${file}: the folder of project "${name}" must be a string (a path from the workspace root)`
      );
    const dir = resolve(root, rel);
    return { name, dir, configPath: join(dir, CONFIG_FILE) };
  });
  // The application this workspace is, as the dashboard's title names it (`pxsig • <label>`).
  const label = ws.label == null ? null : typeof ws.label === 'string' ? ws.label.trim() : '';
  if (label === '' || (label && label.length > 60))
    throw new SetupError(`${file}: "label" must be text of 1 to 60 characters`);
  const id = workspaceId(root);
  return { root, id, file, label, defaults: ws.defaults ?? {}, server: ws.server ?? {}, projects };
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
function packageName(dir) {
  try {
    return (
      /** @type {PackageJson} */ (
        JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      ).name?.replace(/^@[^/]+\//, '') ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Which project a command means. An explicit name or path wins; else the project that contains
 * `cwd`; else the only project. Returns null when several fit and none was named.
 * @param {Workspace} ws
 * @param {{ project?: string | null, cwd?: string }} [opts]
 * @returns {ProjectRef | null}
 */
export function pickProject(ws, { project = null, cwd = process.cwd() } = {}) {
  if (project) {
    const byName = ws.projects.find((p) => p.name === project);
    if (byName) return byName;
    const abs = resolve(cwd, project);
    const byDir = ws.projects.find((p) => p.dir === abs);
    if (byDir) return byDir;
    throw new SetupError(
      `no project "${project}" in ${ws.file ?? ws.root} (projects: ${ws.projects.map((p) => p.name).join(', ')})`
    );
  }
  const here = resolve(cwd) + sep;
  const inside = ws.projects
    .filter((p) => here.startsWith(p.dir + sep))
    .sort((a, b) => b.dir.length - a.dir.length);
  if (inside.length) return inside[0];
  return ws.projects.length === 1 ? ws.projects[0] : null;
}

/**
 * Config files under the workspace that no workspace entry points at (doctor: project-unlisted).
 * @param {Workspace} ws
 * @param {{ maxDepth?: number }} [opts]
 * @returns {string[]}
 */
export function unlistedConfigs(ws, { maxDepth = 4 } = {}) {
  const listed = new Set(ws.projects.map((p) => p.configPath));
  /** @type {string[]} */
  const found = [];
  /**
   * @param {string} dir
   * @param {number} depth
   */
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of items) {
      if (d.isFile() && d.name === CONFIG_FILE) {
        const p = join(dir, d.name);
        if (!listed.has(p)) found.push(toPosix(relative(ws.root, p)));
      } else if (
        d.isDirectory() &&
        !d.name.startsWith('.') &&
        !['node_modules', 'dist', 'build', 'target', 'coverage'].includes(d.name)
      )
        walk(join(dir, d.name), depth + 1);
    }
  };
  walk(ws.root, 0);
  return found;
}

/**
 * Projects whose folder or config is gone (doctor: project-missing).
 * @param {Workspace} ws
 */
export const missingProjects = (ws) =>
  ws.projects.filter((p) => !existsSync(p.configPath)).map((p) => p.name);

/**
 * Workspace-level problems for the integrity ledger's `setup`: packages with a config that no
 * workspace entry lists, listed projects whose config is gone, and pxsig installs in the workspace
 * on another major version (one engine must write and check every baseline).
 * @param {Project} P
 * @returns {SetupProblem[]}
 */
export function workspaceProblems(P) {
  /** @type {Workspace} */
  let ws;
  try {
    ws = findWorkspace({ cwd: P.workspaceRoot, workspace: P.workspaceRoot, env: {} });
  } catch {
    return [];
  }
  /** @type {SetupProblem[]} */
  const out = [];
  const where = ws.file ? WORKSPACE_FILE : `a ${WORKSPACE_FILE} (this workspace has none)`;
  for (const f of unlistedConfigs(ws))
    if (ws.file || f !== CONFIG_FILE)
      out.push({
        code: 'project-unlisted',
        severity: 'warn',
        reason: `${f} is not listed in ${where}: nothing checks that package`,
      });
  for (const n of missingProjects(ws))
    out.push({
      code: 'project-missing',
      severity: 'error',
      reason: `project "${n}" is listed in ${WORKSPACE_FILE} but its ${CONFIG_FILE} is gone`,
    });
  /** @param {unknown} v */
  const major = (v) => String(v).split('.')[0];
  const requires = ws.file
    ? // findWorkspace read this file already; `requires` is a range string when set.
      (/** @type {WorkspaceFile} */ (readJsonFile(ws.file)).requires ?? null)
    : null;
  const seen = new Set();
  for (const dir of [ws.root, ...ws.projects.map((p) => p.dir)]) {
    const pj = join(dir, 'node_modules', 'pxsig', 'package.json');
    if (seen.has(pj) || !existsSync(pj)) continue;
    seen.add(pj);
    try {
      const v = /** @type {PackageJson} */ (JSON.parse(readFileSync(pj, 'utf8'))).version;
      if (major(v) !== major(PXSIG_VERSION))
        out.push({
          code: 'version-skew',
          severity: 'warn',
          reason: `${toPosix(relative(ws.root, pj))} is pxsig ${v}; this one is ${PXSIG_VERSION}`,
        });
      if (requires && satisfies(v, requires) === false)
        out.push({
          code: 'version-required',
          severity: 'warn',
          reason: `${toPosix(relative(ws.root, pj))} is pxsig ${v}, outside the workspace's "requires" (${requires}): it refuses to run here once it reads that key (0.4.0 and later), and an older one ignores it`,
        });
    } catch {
      // unreadable: not ours to judge
    }
  }
  out.push(...engineProblems(P.rustBin));
  out.push(...imageProblems(P, ws.root));
  return out;
}

/**
 * Whether `version` satisfies a `requires` range: comparators (>=, >, <=, <, =, or a bare version)
 * joined by spaces (all must hold), alternatives joined by `||`. Null when the range cannot be read.
 * @param {unknown} version
 * @param {unknown} range
 * @returns {boolean | null}
 */
export function satisfies(version, range) {
  /**
   * @param {unknown} v
   * @returns {[number, number, number] | null}
   */
  const num = (v) => {
    const m = String(v)
      .trim()
      .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
  };
  /**
   * @param {number[]} a
   * @param {number[]} b
   */
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const v = num(String(version).split('-')[0]);
  if (!v) return null;
  let read = true;
  const ok = String(range)
    .split('||')
    .some((alt) =>
      alt
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .every((c) => {
          const m = c.match(/^(>=|<=|>|<|=)?(.+)$/);
          const w = m && num(m[2]);
          if (!w) return (read = false);
          const d = cmp(v, w);
          return /** @type {Record<string, boolean>} */ ({
            '>=': d >= 0,
            '<=': d <= 0,
            '>': d > 0,
            '<': d < 0,
            '=': d === 0,
          })[m[1] ?? '='];
        })
    );
  return read ? ok : null;
}
