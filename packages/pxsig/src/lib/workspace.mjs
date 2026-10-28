/**
 * workspace.mjs — find the workspace, pick a project, resolve its config and store.
 *
 * Every surface (CLI, MCP server, server + dashboard, Storybook addon) goes through here, so they
 * agree on which project and which store they mean.
 *
 *   workspace   the repository root: the folder holding `pxsig.workspace.json`, or, without one,
 *               the folder of the nearest `pxsig.config.json` (a one-project workspace)
 *   project     one package under test: one source root, one Storybook, one store
 *   store       the project's baselines, manifest, approvals and run output (`<project>/.pxsig/`)
 *
 * Config layers, first that sets a value wins: CLI flags > PXSIG_* environment > the project's
 * pxsig.config.json > the workspace file's `defaults` > built-in defaults. Paths are relative to
 * the file that declares them (a project's config: its folder; the workspace file's `defaults`:
 * the workspace root; a CLI flag: the current folder); `$workspace/` makes one relative to the
 * workspace root anywhere. `pxsig config` shows which layer set each key.
 */
/** @import { Config, ConfigFile, Flags, ImageTag, Manifest, Mode, PackageJson, PeerBase, Project, ProjectRef, RunManifest, SetupProblem, Workspace, WorkspaceFile } from '../types.js' */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './paths.mjs';
import { writeAtomic } from './files.mjs';
import { spawnSync } from './spawn.mjs';
import { checkEnforcementConfig } from './enforcement.mjs';

export const WORKSPACE_FILE = 'pxsig.workspace.json';
export const CONFIG_FILE = 'pxsig.config.json';

/** Built-in defaults. Nothing here names a repository, a path outside the project or a library. */
export const DEFAULTS = Object.freeze({
  srcRoot: 'src',
  storybook: { url: 'http://localhost:6006', configDir: null, staticDir: null },
  store: { dir: '.pxsig', layout: 'package' },
  capture: {
    viewport: [900, 600],
    settleMs: 200,
    target: '#storybook-root',
    waitFor: [],
    browserEndpoint: null,
  },
  grid: 64,
  minCellPx: 8,
  detail: true,
  trim: { pad: 16, tolerance: 8 },
  gate: {
    threshold: 24,
    minCells: 3,
    minSsim: 0.99,
    maxChangedPct: 2,
    detail: { blockDelta: 32, energyDelta: 48, minTiles: 3 },
  },
  modes: { default: { globals: '', colorScheme: 'light' } },
  defaultMode: null,
  modesByDefault: null,
  suites: {},
  affects: { workspaceDeps: true, extra: [], ignore: [], aliases: {}, unresolved: [] },
  nonVisual: [],
  a11y: true,
  integrity: {},
});

/** A plain object (a config layer, a JSON object): what `merge` merges. */
/** @typedef {Record<string, unknown>} Obj */
/** The CLI flags layer (`flagLayer`): config keys only. */
/** @typedef {{ storybook?: { url?: string, staticDir?: string, configDir?: string }, grid?: number, minCellPx?: number, capture?: { settleMs?: number, browserEndpoint?: string } }} FlagLayer */
/** @type {(v: unknown) => v is Obj} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge for config layers: objects merge, everything else (arrays included) replaces.
 * @param {...unknown} layers
 * @returns {Obj}
 */
export function merge(...layers) {
  /** @type {Obj} */
  const out = {};
  for (const l of layers) {
    if (!isObj(l)) continue;
    for (const [k, v] of Object.entries(l))
      out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

/** A problem with the setup (no workspace, a bad config): commands exit 2 with its message. */
export class SetupError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, choices?: string[] }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    this.setup = true;
    Object.assign(this, extra);
  }
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new SetupError(`${path} is not valid JSON: ${/** @type {Error} */ (e).message}`);
  }
}

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
      file: null,
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
    const dir = resolve(root, rel);
    return { name, dir, configPath: join(dir, CONFIG_FILE) };
  });
  return { root, file, defaults: ws.defaults ?? {}, server: ws.server ?? {}, projects };
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
 * The version of this pxsig install.
 * @type {string}
 */
export const PXSIG_VERSION = /** @type {{ version: string }} */ (
  // pxsig's own package.json, which always has a version.
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
).version;

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
 * `ghcr.io/hydrotik/pxsig:0.5.0-pw1.58.2[-r2][-amd64]` → { pxsig, playwright }, or null.
 * @param {string | null | undefined} image
 * @returns {ImageTag | null}
 */
export function parseImageTag(image) {
  const m = String(image ?? '').match(
    /:(\d+\.\d+\.\d+(?:-[\w.]+?)?)-pw(\d+\.\d+\.\d+)(?:-r\d+)?(?:-(?:amd64|arm64))?(?:@|$)/
  );
  return m ? { pxsig: m[1], playwright: m[2] } : null;
}

/**
 * Inside the container image (`PXSIG_IMAGE` set): the image's pxsig and Playwright should be the
 * ones the project pins, or its renders are not the ones the project's own install would make.
 * @param {PeerBase} P
 * @param {string | null | undefined} wsRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SetupProblem[]}
 */
export function imageProblems(P, wsRoot, env = process.env) {
  const tag = parseImageTag(env.PXSIG_IMAGE);
  if (!tag) return [];
  /** @type {SetupProblem[]} */
  const out = [];
  /** @param {string} pj */
  const version = (pj) => {
    try {
      return /** @type {PackageJson} */ (JSON.parse(readFileSync(pj, 'utf8'))).version ?? null;
    } catch {
      return null;
    }
  };
  let pw = null;
  try {
    pw = version(resolvePeer(P, 'playwright/package.json', env));
  } catch {
    // no Playwright resolves: the check itself says so
  }
  if (pw && pw !== tag.playwright)
    out.push({
      code: 'image-mismatch',
      severity: 'warn',
      reason: `the image ${env.PXSIG_IMAGE} is built for Playwright ${tag.playwright}, but Playwright ${pw} resolves here: renders use browsers that do not match the driver. Use the image tag for ${pw}, or set PXSIG_PLAYWRIGHT to the image's own`,
    });
  const pinned = wsRoot ? version(join(wsRoot, 'node_modules', 'pxsig', 'package.json')) : null;
  if (pinned && pinned !== tag.pxsig)
    out.push({
      code: 'image-mismatch',
      severity: 'warn',
      reason: `the image ${env.PXSIG_IMAGE} runs pxsig ${tag.pxsig}, but this project pins pxsig ${pinned}: use the image tag for ${pinned}`,
    });
  return out;
}

/** @type {Map<string, string | null>} */
const engineVersions = new Map();
/**
 * The engine binary's version (`pxsig --version`), once per binary and build; null when it does not run.
 * @param {string} bin
 * @returns {string | null}
 */
export function engineVersion(bin) {
  let key;
  try {
    key = `${bin}|${statSync(bin).mtimeMs}`;
  } catch {
    return null;
  }
  if (!engineVersions.has(key)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    engineVersions.set(key, (String(r.stdout ?? '').match(/(\d+\.\d+\.\d+\S*)/) ?? [])[1] ?? null);
  }
  // Set just above when it was missing.
  return /** @type {string | null} */ (engineVersions.get(key));
}

/**
 * An engine binary older than this CLI (a stale `PXSIG_BIN`, a platform package left behind): it
 * ignores the render environment the CLI sends, so the baselines it writes carry no `env`.
 * @param {string | null | undefined} bin
 * @returns {SetupProblem[]}
 */
export function engineProblems(bin) {
  if (!bin || !existsSync(bin)) return [];
  const v = engineVersion(bin);
  if (!v) return [];
  /** @param {unknown} x */
  const mm = (x) => String(x).split('.').slice(0, 2).map(Number);
  const [a, b] = mm(v);
  const [c, d] = mm(PXSIG_VERSION);
  if (a > c || (a === c && b >= d)) return [];
  return [
    {
      code: 'engine-old',
      severity: 'warn',
      reason: `the engine binary is pxsig ${v}, older than this pxsig ${PXSIG_VERSION}: baselines it writes carry no render environment (env), and other newer engine features are missing. Install the matching @pxsig/cli package (or unset PXSIG_BIN)`,
    },
  ];
}

/**
 * `$workspace/x` → workspace-relative; anything else → relative to `base`. Returns absolute.
 * @overload
 * @param {Pick<Workspace, 'root'>} ws
 * @param {string} base
 * @param {string} p
 * @returns {string}
 */
/**
 * @overload
 * @param {Pick<Workspace, 'root'>} ws
 * @param {string} base
 * @param {string | null | undefined} p
 * @returns {string | null}
 */
/**
 * @param {Pick<Workspace, 'root'>} ws
 * @param {string} base
 * @param {string | null | undefined} p
 * @returns {string | null}
 */
export function expand(ws, base, p) {
  if (p == null) return null;
  if (p.startsWith('$workspace/')) return resolve(ws.root, p.slice('$workspace/'.length));
  return isAbsolute(p) ? p : resolve(base, p);
}

/** The path-valued config keys (dotted), for resolving each layer's paths against its own file. */
const PATH_KEYS = ['srcRoot', 'storybook.configDir', 'storybook.staticDir', 'store.dir'];

/**
 * A copy of `layer` with its relative paths made absolute against `base` (`$workspace/` kept).
 * @param {Workspace} ws
 * @param {Obj} layer
 * @param {string} base
 * @returns {Obj}
 */
function anchorPaths(ws, layer, base) {
  if (!isObj(layer)) return layer;
  const out = merge(layer);
  /** @param {unknown} p */
  const fix = (p) =>
    typeof p === 'string' && !p.startsWith('$workspace/') ? expand(ws, base, p) : p;
  for (const key of PATH_KEYS) {
    const [a, b] = key.split('.');
    // With `b`, the condition checked that `out[a]` is an object.
    if (b ? isObj(out[a]) && out[a][b] != null : out[a] != null)
      b
        ? (/** @type {Obj} */ (out[a])[b] = fix(/** @type {Obj} */ (out[a])[b]))
        : (out[a] = fix(out[a]));
  }
  if (isObj(out.affects) && Array.isArray(out.affects.extra))
    out.affects.extra = out.affects.extra.map(fix);
  for (const k of ['ignore', 'unresolved'])
    if (isObj(out.affects) && Array.isArray(out.affects[k]))
      // The condition checked that it is an array.
      out.affects[k] = /** @type {unknown[]} */ (out.affects[k]).map((g) =>
        typeof g === 'string' && g.startsWith('$repo/') ? g : fix(g)
      );
  if (isObj(out.affects) && isObj(out.affects.aliases))
    out.affects.aliases = Object.fromEntries(
      Object.entries(out.affects.aliases).map(([k, v]) => [k, fix(v)])
    );
  return out;
}

/**
 * The CLI flags layer (layer 1). Maps the config flags every command accepts onto config keys;
 * paths are relative to `cwd`. Unknown flags are ignored (they belong to the command).
 *
 *   --storybook-url u      storybook.url          --storybook-static dir   storybook.staticDir
 *   --storybook-config d   storybook.configDir    --grid n                 grid
 *   --min-cell-px n        minCellPx              --settle-ms n            capture.settleMs
 *   --browser ws://…       capture.browserEndpoint
 *
 * Each value is read again after the check on its line, so the casts below hold.
 * @param {Flags} [flags]
 * @param {string} [cwd]
 * @returns {FlagLayer}
 */
export function flagLayer(flags = {}, cwd = process.cwd()) {
  /**
   * @param {string} k
   * @returns {string | null}
   */
  const str = (k) => (typeof flags[k] === 'string' && flags[k] !== '' ? flags[k] : null);
  /**
   * @param {string} k
   * @returns {number | null}
   */
  const num = (k) => (str(k) != null && Number.isFinite(Number(str(k))) ? Number(str(k)) : null);
  /** @type {FlagLayer} */
  const out = {};
  /** @type {{ url?: string, staticDir?: string, configDir?: string }} */
  const sb = {};
  if (str('storybook-url')) sb.url = /** @type {string} */ (str('storybook-url'));
  if (str('storybook-static'))
    sb.staticDir = resolve(cwd, /** @type {string} */ (str('storybook-static')));
  if (str('storybook-config'))
    sb.configDir = resolve(cwd, /** @type {string} */ (str('storybook-config')));
  if (Object.keys(sb).length) out.storybook = sb;
  if (num('grid') != null) out.grid = /** @type {number} */ (num('grid'));
  if (num('min-cell-px') != null) out.minCellPx = /** @type {number} */ (num('min-cell-px'));
  if (num('settle-ms') != null)
    out.capture = { settleMs: /** @type {number} */ (num('settle-ms')) };
  if (str('browser'))
    out.capture = { ...out.capture, browserEndpoint: /** @type {string} */ (str('browser')) };
  return out;
}

/**
 * Which layer set each key: dotted path → layer name, for every leaf of the merged config (arrays
 * and `modes` count as one value). Later layers win, as in `merge`.
 * @param {{ name: string, value: unknown }[]} layers
 * @returns {Record<string, string>}
 */
export function provenance(layers) {
  /** @type {Record<string, string>} */
  const out = {};
  /**
   * @param {Obj} obj
   * @param {string} prefix
   * @param {string} name
   */
  const walk = (obj, prefix, name) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (isObj(v) && key !== 'modes' && !(prefix === '' && k === 'suites')) {
        // An object replaces nothing: its own leaves carry the layer.
        walk(v, key, name);
      } else {
        for (const o of Object.keys(out)) if (o.startsWith(`${key}.`)) delete out[o];
        out[key] = name;
      }
    }
  };
  for (const { name, value } of layers) if (isObj(value)) walk(value, '', name);
  return out;
}

/**
 * Resolve `extends` in a set of modes, through any number of levels: a mode is its parent's
 * settings with its own on top. A cycle or an unknown parent is a setup error.
 * @param {Record<string, Mode>} modes
 * @param {string | null} [where]
 * @returns {Record<string, Mode>}
 */
export function resolveModes(modes, where = 'modes') {
  /** @type {Record<string, Mode>} */
  const done = {};
  /**
   * @param {string} name
   * @param {string[]} chain
   * @returns {Mode}
   */
  const visit = (name, chain) => {
    if (done[name]) return done[name];
    const m = modes[name];
    if (!isObj(m))
      throw new SetupError(
        `${where}: mode "${chain.at(-2) ?? name}" extends "${name}", which is not defined`
      );
    if (!m.extends) return (done[name] = { ...m });
    if (chain.includes(m.extends))
      throw new SetupError(
        `${where}: modes extend each other in a cycle: ${[...chain, m.extends].join(' → ')}`
      );
    const parent = visit(m.extends, [...chain, m.extends]);
    const { extends: _, ...own } = m;
    return (done[name] = { ...parent, ...own });
  };
  for (const name of Object.keys(modes)) visit(name, [name]);
  return Object.fromEntries(Object.keys(modes).map((k) => [k, done[k]]));
}

/**
 * Environment overrides (layer 3).
 * @param {NodeJS.ProcessEnv} env
 */
function envLayer(env) {
  /** @type {{ storybook?: { url: string }, grid?: number, capture?: { browserEndpoint: string }, affects?: { extra: string[], workspaceDeps: boolean } }} */
  const out = {};
  if (env.PXSIG_STORYBOOK_URL) out.storybook = { url: env.PXSIG_STORYBOOK_URL };
  if (env.PXSIG_GRID) out.grid = Number(env.PXSIG_GRID);
  if (env.PXSIG_BROWSER_WS) out.capture = { browserEndpoint: env.PXSIG_BROWSER_WS };
  if (env.PXSIG_SOURCES)
    out.affects = {
      extra: env.PXSIG_SOURCES.split(',').map((s) => `$workspace/${s.trim()}`),
      workspaceDeps: false,
    };
  return out;
}

/**
 * Source folders of the project's workspace dependencies (affects.workspaceDeps).
 * @param {Workspace} ws
 * @param {string} projectDir
 * @returns {string[]}
 */
function workspaceDepRoots(ws, projectDir) {
  /** @type {PackageJson} */
  let pkg;
  try {
    pkg = /** @type {PackageJson} */ (
      JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    );
  } catch {
    return [];
  }
  // Runtime dependencies only: a change to a dev-only workspace package (test or build config) can't change a render.
  const deps = Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies }).filter(([, v]) =>
    String(v).startsWith('workspace:')
  );
  const req = createRequire(join(projectDir, 'package.json'));
  /** @type {string[]} */
  const out = [];
  for (const [name] of deps) {
    // The linked folder (pnpm, npm and yarn workspaces all link it), else Node's resolver.
    /** @type {string | null} */
    let dir = null;
    for (const find of [
      () => join(projectDir, 'node_modules', name),
      () => join(ws.root, 'node_modules', name),
      () => dirname(req.resolve(`${name}/package.json`)),
    ]) {
      try {
        const d = realpathSync(find());
        if (existsSync(join(d, 'package.json'))) {
          dir = d;
          break;
        }
      } catch {
        // not there: try the next way
      }
    }
    // Compare real paths (the workspace itself may sit behind a symlink), report in workspace terms.
    const realRoot = realpathSync(ws.root);
    if (dir && dir.startsWith(realRoot + sep) && !dir.includes(`${sep}node_modules${sep}`)) {
      const inWs = join(ws.root, relative(realRoot, dir));
      out.push(existsSync(join(inWs, 'src')) ? join(inWs, 'src') : inWs);
    }
  }
  return out;
}

/**
 * Resolve a project: its merged config, absolute paths and store layout.
 * `flags` is layer 2 (CLI); `env` layer 3.
 */
/**
 * `approvals`: only what this pxsig does (decision 78: Strict is a later release).
 * @param {Config} config
 * @param {ProjectRef} ref
 */
function checkApprovals(config, ref) {
  const a = config.approvals ?? {};
  if (a.level != null && a.level !== 'standard')
    throw new SetupError(
      a.level === 'strict'
        ? `project "${ref.name}": approvals.level "strict" is not available yet (decision 78); remove it or set "standard"`
        : `project "${ref.name}": approvals.level must be "standard"`
    );
  if (a.identity != null && !['none', 'git-email'].includes(a.identity))
    throw new SetupError(`project "${ref.name}": approvals.identity must be "none" or "git-email"`);
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

/**
 * @param {Workspace} ws
 * @param {ProjectRef} ref
 * @param {{ flags?: Obj, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Project}
 */
export function loadProject(ws, ref, { flags = {}, env = process.env } = {}) {
  // The project's config as written (schema/project.json).
  const raw = existsSync(ref.configPath)
    ? /** @type {ConfigFile} */ (readJsonFile(ref.configPath))
    : null;
  if (!raw)
    throw new SetupError(`project "${ref.name}": no ${CONFIG_FILE} at ${ref.configPath}`, {
      code: 'project-missing',
    });
  // The workspace file's paths are relative to the workspace root, not to the project.
  const wsDefaults = anchorPaths(ws, ws.defaults ?? {}, ws.root);
  /** @type {{ name: string, value: unknown }[]} */
  const layers = [
    { name: 'defaults', value: DEFAULTS },
    { name: 'workspace defaults', value: wsDefaults },
    { name: 'project config', value: raw },
    { name: 'env', value: envLayer(env) },
    { name: 'flags', value: flags },
  ];
  // The built-in defaults set every key Config requires; each layer above them is a config file,
  // the environment or the flags (schema/project.json), checked below where pxsig relies on it.
  const config = /** @type {Config} */ (merge(...layers.map((l) => l.value)));
  const sources = provenance(layers);
  checkApprovals(config, ref);
  try {
    checkEnforcementConfig(config.enforcement, `project "${ref.name}": enforcement`);
  } catch (e) {
    throw new SetupError(/** @type {Error} */ (e).message);
  }
  // The dashboard title's label: what the page reviews, in the team's words.
  const label =
    config.label == null ? null : typeof config.label === 'string' ? config.label.trim() : '';
  if (label === '' || (label && label.length > 60))
    throw new SetupError(`project "${ref.name}": label must be text of 1 to 60 characters`);
  const root = ref.dir;
  const store = expand(ws, root, config.store.dir);
  // Modes are a set, not settings: a project's modes replace the defaults instead of joining them.
  const modesFrom = raw.modes
    ? 'project config'
    : wsDefaults.modes
      ? 'workspace defaults'
      : 'defaults';
  sources.modes = modesFrom;
  for (const k of Object.keys(sources)) if (k.startsWith('modes.')) delete sources[k];
  const modes = resolveModes(
    // The workspace's `defaults` are project config keys (schema/workspace.json).
    raw.modes ??
      /** @type {Record<string, Mode> | undefined} */ (wsDefaults.modes) ??
      // The built-in mode: `colorScheme` is 'light'.
      /** @type {Record<string, Mode>} */ (DEFAULTS.modes),
    modesFrom === 'project config'
      ? ref.configPath
      : modesFrom === 'workspace defaults'
        ? ws.file
        : 'built-in modes'
  );
  const defaultMode = config.defaultMode ?? Object.keys(modes)[0];
  const srcRoot = expand(ws, root, config.srcRoot);
  const affects = [
    ...(config.affects.workspaceDeps ? workspaceDepRoots(ws, root) : []),
    ...(config.affects.extra ?? []).map((p) => expand(ws, root, p)),
    ref.configPath,
  ];
  /** @param {string} abs */
  const wsRel = (abs) => toPosix(relative(ws.root, abs));
  // affects.ignore: globs anchored like affects.extra, plus `$repo/` for paths outside the workspace.
  const ignore = config.affects.ignore ?? [];
  if (!Array.isArray(ignore) || ignore.some((g) => typeof g !== 'string' || !g.trim()))
    throw new SetupError(`project "${ref.name}": affects.ignore must be an array of globs`);
  /** @param {string} g */
  const anchorGlob = (g) =>
    g.startsWith('$repo/')
      ? g
      : wsRel(expand(ws, root, g)).replace(/\/$/, '') + (g.endsWith('/') ? '/' : '');
  const affectsIgnore = ignore.map(anchorGlob);
  // affects.unresolved: anchored the same way; affects.aliases: prefix → workspace-relative path.
  const unresolved = config.affects.unresolved ?? [];
  if (!Array.isArray(unresolved) || unresolved.some((g) => typeof g !== 'string' || !g.trim()))
    throw new SetupError(`project "${ref.name}": affects.unresolved must be an array of globs`);
  const aliases = config.affects.aliases ?? {};
  if (
    !isObj(aliases) ||
    Object.entries(aliases).some(([k, v]) => !k || typeof v !== 'string' || !v.trim())
  )
    throw new SetupError(
      `project "${ref.name}": affects.aliases must map a specifier prefix to a path`
    );
  const affectsAliases = Object.fromEntries(
    Object.entries(aliases).map(([k, v]) => [k, wsRel(expand(ws, root, v))])
  );
  const affectsUnresolved = unresolved.map(anchorGlob);
  const layout = config.store.layout;
  if (!['package', 'colocated'].includes(layout))
    throw new SetupError(`project "${ref.name}": store.layout must be "package" or "colocated"`);
  /** @type {Project} */
  const P = {
    name: ref.name,
    /** The dashboard title after "pxsig ·" (config `label`); null: the name. */
    label,
    root,
    workspaceRoot: ws.root,
    workspaceFile: ws.file,
    configPath: ref.configPath,
    config,
    /** Which layer set each config key (`pxsig config`). */
    configSources: sources,
    srcRoot,
    storybook: {
      url: String(config.storybook.url).replace(/\/$/, ''),
      configDir: expand(ws, root, config.storybook.configDir),
      staticDir: expand(ws, root, config.storybook.staticDir),
    },
    modes,
    defaultMode,
    modesByDefault: config.modesByDefault ?? [defaultMode],
    affects: affects.map(wsRel),
    affectsIgnore,
    affectsAliases,
    affectsUnresolved,
    store: {
      root: store,
      layout,
      baselines: join(store, 'baselines'),
      latest: join(store, 'renders', 'latest'),
      retry: join(store, 'renders', 'retry'),
      diffs: join(store, 'diffs'),
      diffLatest: join(store, 'diffs', 'latest'),
      reports: join(store, 'reports'),
      cache: join(store, 'cache'),
      history: join(store, 'history'),
      trash: join(store, 'trash'),
      approvals: join(store, 'approvals.ndjson'),
      a11y: join(store, 'a11y.json'),
    },
    /** The committed manifest: `manifest.json`, or `manifest.<suite>.json` for a suite. */
    manifestPath: (/** @type {string | null} */ suite = null) =>
      join(store, suite ? `manifest.${suite}.json` : 'manifest.json'),
    /** Workspace-relative baseline path for an entry, by layout. */
    sigFor(id, importPath) {
      const comp = componentOfImport(P, importPath);
      const file = `${id}.psig`;
      return layout === 'colocated'
        ? wsRel(join(srcRoot, comp, '__pxsig__', file))
        : wsRel(join(store, 'baselines', comp, file));
    },
    rustBin: rustBinary(env),
    serverUrl: () => serverUrlFor(ws.root, { env, port: ws.server?.port }),
  };
  return P;
}

/**
 * The component folder (relative to srcRoot) for a workspace-relative story file path.
 * @param {Pick<Project, 'workspaceRoot' | 'srcRoot'>} P
 * @param {string | null | undefined} importPath
 * @returns {string}
 */
export function componentOfImport(P, importPath) {
  if (!importPath) return '_';
  const abs = resolve(P.workspaceRoot, importPath);
  const rel = toPosix(relative(P.srcRoot, dirname(abs)));
  return rel && !rel.startsWith('..') ? rel : '_';
}

/**
 * What `expandEntries` (lib/manifest.mjs) needs to turn stories into manifest entries.
 * @param {Project} P
 */
export const entryConfig = (P) => ({
  modes: P.modes,
  defaultMode: P.defaultMode,
  modesByDefault: P.modesByDefault,
  viewport: P.config.capture.viewport,
  a11y: P.config.a11y,
});

/**
 * The settings Rust and the renderer need for a run, merged into the entries for one run.
 * @param {Project} P
 * @param {Partial<Manifest>} manifest
 * @param {{ suite?: string | null }} [opts]
 * @returns {RunManifest}
 */
export function runManifest(P, manifest, { suite = null } = {}) {
  const c = P.config;
  /** @param {string} abs */
  const wsRel = (abs) => toPosix(relative(P.workspaceRoot, abs));
  // Every manifest of the store, committed or not: their records and baselines are told apart by suite.
  /** @type {Record<string, string>} */
  const manifests = { '': wsRel(P.manifestPath()) };
  for (const name of Object.keys(c.suites ?? {})) manifests[name] = wsRel(P.manifestPath(name));
  try {
    for (const f of readdirSync(P.store.root)) {
      const m = f.match(/^manifest\.(.+)\.json$/);
      if (m) manifests[m[1]] = wsRel(join(P.store.root, f));
    }
  } catch {
    // no store yet
  }
  return {
    version: 2,
    baseUrl: P.storybook.url,
    viewport: c.capture.viewport,
    colorScheme: P.modes[P.defaultMode]?.colorScheme ?? 'light',
    globals: P.modes[P.defaultMode]?.globals ?? '',
    settleMs: c.capture.settleMs,
    target: c.capture.target,
    waitFor: c.capture.waitFor,
    grid: c.grid,
    minCellPx: c.minCellPx,
    detail: c.detail,
    trim: c.trim,
    gate: c.gate,
    modes: P.modes,
    defaultMode: P.defaultMode,
    srcRoot: toPosix(relative(P.workspaceRoot, P.srcRoot)),
    // Selection (docs/ci.md, "How selection decides"): the workspace file and the Storybook config
    // also affect every entry; `affectsIgnore`, `affectsAliases`, `affectsUnresolved` and `store` are read by `pxsig affected`.
    affectsAll: [
      ...new Set([
        ...P.affects,
        ...(P.workspaceFile ? [wsRel(P.workspaceFile)] : []),
        ...(P.storybook.configDir ? [wsRel(P.storybook.configDir)] : []),
      ]),
    ],
    affectsIgnore: P.affectsIgnore ?? [],
    affectsAliases: P.affectsAliases ?? {},
    affectsUnresolved: P.affectsUnresolved ?? [],
    store: {
      dir: wsRel(P.store.root),
      a11y: wsRel(P.store.a11y),
      approvals: wsRel(P.store.approvals),
      a11yDecisions: wsRel(join(P.store.root, 'a11y-decisions.ndjson')),
      manifests,
      suite,
    },
    a11y: c.a11y,
    stories: manifest.stories ?? [],
    skipped: manifest.skipped ?? [],
  };
}

/**
 * Write the run manifest Rust reads (entries + resolved settings) to `<store>/reports/.run/` and
 * return its path. The committed manifest holds entries only, so it can't disagree with config.
 * @param {Project} P
 * @param {string} [manifestPath]
 * @param {{ dir?: string | null }} [opts]
 * @returns {{ path: string, manifest: RunManifest }}
 */
export function writeRunManifest(P, manifestPath = P.manifestPath(), { dir: runDir } = {}) {
  /** @type {Manifest} */
  let m;
  try {
    // The manifest `pxsig manifest` wrote (docs/spec.md section 6).
    m = /** @type {Manifest} */ (JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch (e) {
    throw new SetupError(
      `no readable manifest at ${manifestPath} (${/** @type {NodeJS.ErrnoException} */ (e).code ?? /** @type {Error} */ (e).message}): run \`pxsig manifest\` first`
    );
  }
  const run = runManifest(P, m, {
    suite: basename(manifestPath).match(/^manifest\.(.+)\.json$/)?.[1] ?? null,
  });
  // `dir`: elsewhere than the store (a server without the store lock writes nothing in it).
  const dir = runDir ?? join(P.store.reports, '.run');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, basename(manifestPath));
  writeAtomic(out, JSON.stringify(run));
  return { path: out, manifest: run };
}

/**
 * The pxsig binary: PXSIG_BIN, else the platform package, else a source checkout's build.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function rustBinary(env = process.env) {
  const exe = process.platform === 'win32' ? 'pxsig.exe' : 'pxsig';
  if (env.PXSIG_BIN) return resolve(env.PXSIG_BIN);
  const req = createRequire(import.meta.url);
  try {
    return req.resolve(`@pxsig/cli-${process.platform}-${process.arch}/bin/${exe}`);
  } catch {
    // no platform package: fall back to a source checkout
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // Only pxsig's own clone has its build there; an installed pxsig would otherwise run a binary
  // from the project that installed it (whatever a pull request put in its target/release).
  // The path returned is where the platform package belongs, so the "binary is missing" error names it.
  if (here.split(sep).includes('node_modules'))
    return resolve(
      here,
      '..',
      '..',
      '..',
      '@pxsig',
      `cli-${process.platform}-${process.arch}`,
      'bin',
      exe
    );
  return resolve(here, '..', '..', '..', '..', 'target', 'release', exe);
}

/**
 * Load a peer dependency (playwright, axe-core) the way the project would: from the project, then
 * the workspace root, then pxsig's own install (`PXSIG_PLAYWRIGHT`, when set, comes first for
 * Playwright). Playwright is also found through
 * `@playwright/test`, so renders use the browser build the project already tests with.
 * @param {PeerBase} P
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolvePeer(P, name, env = process.env) {
  // `filter(Boolean)` keeps the folders that are set.
  const bases = /** @type {string[]} */ ([P?.root, P?.workspaceRoot].filter(Boolean));
  /** @type {(() => string)[]} */
  const tries = [];
  // PXSIG_PLAYWRIGHT (the container image sets it): that Playwright package folder first, so the
  // driver always matches the browsers installed beside it. Unset, nothing changes.
  if (env.PXSIG_PLAYWRIGHT && (name === 'playwright' || name.startsWith('playwright/'))) {
    const dir = resolve(env.PXSIG_PLAYWRIGHT);
    tries.push(() =>
      createRequire(join(dir, 'package.json')).resolve(dir + name.slice('playwright'.length))
    );
  }
  for (const base of bases) {
    tries.push(() => createRequire(join(base, 'package.json')).resolve(name));
    if (name === 'playwright' || name.startsWith('playwright/'))
      tries.push(() =>
        createRequire(
          createRequire(join(base, 'package.json')).resolve('@playwright/test/package.json')
        ).resolve(name)
      );
  }
  tries.push(() => createRequire(import.meta.url).resolve(name));
  for (const t of tries) {
    try {
      return t();
    } catch {
      // try the next place
    }
  }
  throw new SetupError(`cannot find "${name}": install it in the workspace (pnpm add -D ${name})`);
}

/**
 * Where the running server writes its address: never committed, never inside a package.
 * @param {string} root
 */
export const serverFile = (root) => join(root, 'node_modules', '.cache', 'pxsig', 'server.json');
/**
 * Where `pxsig browser start` records its container (endpoint, image, digest): beside server.json.
 * @param {string} root
 */
export const browserFile = (root) => join(root, 'node_modules', '.cache', 'pxsig', 'browser.json');

/**
 * The server URL for a workspace: PXSIG_URL, else the running server's file, else the configured port.
 * @param {string} wsRoot
 * @param {{ env?: NodeJS.ProcessEnv, port?: number | null }} [opts]
 * @returns {string}
 */
export function serverUrlFor(wsRoot, { env = process.env, port = null } = {}) {
  if (env.PXSIG_URL) return env.PXSIG_URL.replace(/\/$/, '');
  try {
    // server.json, which `pxsig serve` writes.
    const s = /** @type {{ url?: string }} */ (
      JSON.parse(readFileSync(serverFile(wsRoot), 'utf8'))
    );
    if (s.url) return s.url;
  } catch {
    // no server file: fall through to the configured port
  }
  return `http://127.0.0.1:${port ?? 6070}`;
}

/**
 * Process-wide flags layer: the CLI sets it once from its argv (`setFlagLayer(flagLayer(flags))`)
 * so every project it opens, through any tool, sees the same flags.
 */
/** @type {Obj} */
let processFlags = {};
/** @param {Obj | null | undefined} layer */
export const setFlagLayer = (layer) => (processFlags = layer ?? {});

/**
 * One call for the common case: workspace + project from argv-style options.
 * @param {{ cwd?: string, workspace?: string | null, project?: string | null, flags?: Obj | null, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Project}
 */
export function openProject({
  cwd = process.cwd(),
  workspace = null,
  project = null,
  flags = null,
  env = process.env,
} = {}) {
  flags ??= processFlags;
  const ws = findWorkspace({ cwd, workspace, env });
  const ref = pickProject(ws, { project: project ?? env.PXSIG_PROJECT ?? null, cwd });
  if (!ref)
    throw new SetupError(
      `this workspace has ${ws.projects.length} projects; choose one with --project (${ws.projects.map((p) => p.name).join(', ')})`,
      { choices: ws.projects.map((p) => p.name) }
    );
  return loadProject(ws, ref, { flags, env });
}
