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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './paths.mjs';

export const WORKSPACE_FILE = 'pxsig.workspace.json';
export const CONFIG_FILE = 'pxsig.config.json';

/** Built-in defaults. Nothing here names a repository, a path outside the project or a library. */
export const DEFAULTS = Object.freeze({
  srcRoot: 'src',
  storybook: { url: 'http://localhost:6006', configDir: null, staticDir: null },
  store: { dir: '.pxsig', layout: 'package' },
  capture: { viewport: [900, 600], settleMs: 200, target: '#storybook-root', waitFor: [] },
  grid: 64,
  minCellPx: 8,
  detail: true,
  trim: { pad: 16, tolerance: 8 },
  gate: { threshold: 24, minCells: 3, minSsim: 0.99, maxChangedPct: 2, detail: { blockDelta: 32, energyDelta: 48, minTiles: 3 } },
  modes: { default: { globals: '', colorScheme: 'light' } },
  defaultMode: null,
  modesByDefault: null,
  suites: {},
  affects: { workspaceDeps: true, extra: [] },
  nonVisual: [],
  a11y: true,
  integrity: {},
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge for config layers: objects merge, everything else (arrays included) replaces. */
export function merge(...layers) {
  const out = {};
  for (const l of layers) {
    if (!isObj(l)) continue;
    for (const [k, v] of Object.entries(l)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

export class SetupError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.setup = true;
    Object.assign(this, extra);
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new SetupError(`${path} is not valid JSON: ${e.message}`);
  }
}

/** Walk up from `start` to the first folder holding `name`; stops after a `.git` folder. */
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
 * Returns { root, file, defaults, server, projects: [{ name, dir, configPath }] }.
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
      if (!cfg) throw new SetupError(`no ${WORKSPACE_FILE} or ${CONFIG_FILE} here or above ${cwd}: run \`pxsig init\` in the package to test`);
      root = dirname(cfg);
    }
  }
  if (!file) {
    const configPath = join(root, CONFIG_FILE);
    const cfg = readJsonFile(configPath);
    return { root, file: null, defaults: {}, server: {}, projects: [{ name: cfg.name ?? packageName(root) ?? 'default', dir: root, configPath }] };
  }
  const ws = readJsonFile(file);
  if (!isObj(ws.projects)) throw new SetupError(`${file}: "projects" must map a project name to its folder`);
  const projects = Object.entries(ws.projects).map(([name, rel]) => {
    const dir = resolve(root, rel);
    return { name, dir, configPath: join(dir, CONFIG_FILE) };
  });
  return { root, file, defaults: ws.defaults ?? {}, server: ws.server ?? {}, projects };
}

function packageName(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name?.replace(/^@[^/]+\//, '') ?? null;
  } catch {
    return null;
  }
}

/**
 * Which project a command means. An explicit name or path wins; else the project that contains
 * `cwd`; else the only project. Returns null when several fit and none was named.
 */
export function pickProject(ws, { project = null, cwd = process.cwd() } = {}) {
  if (project) {
    const byName = ws.projects.find((p) => p.name === project);
    if (byName) return byName;
    const abs = resolve(cwd, project);
    const byDir = ws.projects.find((p) => p.dir === abs);
    if (byDir) return byDir;
    throw new SetupError(`no project "${project}" in ${ws.file ?? ws.root} (projects: ${ws.projects.map((p) => p.name).join(', ')})`);
  }
  const here = resolve(cwd) + sep;
  const inside = ws.projects.filter((p) => here.startsWith(p.dir + sep)).sort((a, b) => b.dir.length - a.dir.length);
  if (inside.length) return inside[0];
  return ws.projects.length === 1 ? ws.projects[0] : null;
}

/** Config files under the workspace that no workspace entry points at (doctor: project-unlisted). */
export function unlistedConfigs(ws, { maxDepth = 4 } = {}) {
  const listed = new Set(ws.projects.map((p) => p.configPath));
  const found = [];
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
      } else if (d.isDirectory() && !d.name.startsWith('.') && !['node_modules', 'dist', 'build', 'target', 'coverage'].includes(d.name)) walk(join(dir, d.name), depth + 1);
    }
  };
  walk(ws.root, 0);
  return found;
}

/** Projects whose folder or config is gone (doctor: project-missing). */
export const missingProjects = (ws) => ws.projects.filter((p) => !existsSync(p.configPath)).map((p) => p.name);

/** The version of this pxsig install. */
export const PXSIG_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

/**
 * Workspace-level problems for the integrity ledger's `setup`: packages with a config that no
 * workspace entry lists, listed projects whose config is gone, and pxsig installs in the workspace
 * on another major version (one engine must write and check every baseline).
 */
export function workspaceProblems(P) {
  let ws;
  try {
    ws = findWorkspace({ cwd: P.workspaceRoot, workspace: P.workspaceRoot, env: {} });
  } catch {
    return [];
  }
  const out = [];
  const where = ws.file ? WORKSPACE_FILE : `a ${WORKSPACE_FILE} (this workspace has none)`;
  for (const f of unlistedConfigs(ws)) if (ws.file || f !== CONFIG_FILE) out.push({ code: 'project-unlisted', severity: 'warn', reason: `${f} is not listed in ${where}: nothing checks that package` });
  for (const n of missingProjects(ws)) out.push({ code: 'project-missing', severity: 'error', reason: `project "${n}" is listed in ${WORKSPACE_FILE} but its ${CONFIG_FILE} is gone` });
  const major = (v) => String(v).split('.')[0];
  const seen = new Set();
  for (const dir of [ws.root, ...ws.projects.map((p) => p.dir)]) {
    const pj = join(dir, 'node_modules', 'pxsig', 'package.json');
    if (seen.has(pj) || !existsSync(pj)) continue;
    seen.add(pj);
    try {
      const v = JSON.parse(readFileSync(pj, 'utf8')).version;
      if (major(v) !== major(PXSIG_VERSION)) out.push({ code: 'version-skew', severity: 'warn', reason: `${toPosix(relative(ws.root, pj))} is pxsig ${v}; this one is ${PXSIG_VERSION}` });
    } catch {
      // unreadable: not ours to judge
    }
  }
  return out;
}

/** `$workspace/x` → workspace-relative; anything else → relative to `base`. Returns absolute. */
export function expand(ws, base, p) {
  if (p == null) return null;
  if (p.startsWith('$workspace/')) return resolve(ws.root, p.slice('$workspace/'.length));
  return isAbsolute(p) ? p : resolve(base, p);
}

/** The path-valued config keys (dotted), for resolving each layer's paths against its own file. */
const PATH_KEYS = ['srcRoot', 'storybook.configDir', 'storybook.staticDir', 'store.dir'];

/** A copy of `layer` with its relative paths made absolute against `base` (`$workspace/` kept). */
function anchorPaths(ws, layer, base) {
  if (!isObj(layer)) return layer;
  const out = merge(layer);
  const fix = (p) => (typeof p === 'string' && !p.startsWith('$workspace/') ? expand(ws, base, p) : p);
  for (const key of PATH_KEYS) {
    const [a, b] = key.split('.');
    if (b ? isObj(out[a]) && out[a][b] != null : out[a] != null) b ? (out[a][b] = fix(out[a][b])) : (out[a] = fix(out[a]));
  }
  if (isObj(out.affects) && Array.isArray(out.affects.extra)) out.affects.extra = out.affects.extra.map(fix);
  return out;
}

/**
 * The CLI flags layer (layer 1). Maps the config flags every command accepts onto config keys;
 * paths are relative to `cwd`. Unknown flags are ignored (they belong to the command).
 *
 *   --storybook-url u      storybook.url          --storybook-static dir   storybook.staticDir
 *   --storybook-config d   storybook.configDir    --grid n                 grid
 *   --min-cell-px n        minCellPx              --settle-ms n            capture.settleMs
 */
export function flagLayer(flags = {}, cwd = process.cwd()) {
  const str = (k) => (typeof flags[k] === 'string' && flags[k] !== '' ? flags[k] : null);
  const num = (k) => (str(k) != null && Number.isFinite(Number(str(k))) ? Number(str(k)) : null);
  const out = {};
  const sb = {};
  if (str('storybook-url')) sb.url = str('storybook-url');
  if (str('storybook-static')) sb.staticDir = resolve(cwd, str('storybook-static'));
  if (str('storybook-config')) sb.configDir = resolve(cwd, str('storybook-config'));
  if (Object.keys(sb).length) out.storybook = sb;
  if (num('grid') != null) out.grid = num('grid');
  if (num('min-cell-px') != null) out.minCellPx = num('min-cell-px');
  if (num('settle-ms') != null) out.capture = { settleMs: num('settle-ms') };
  return out;
}

/**
 * Which layer set each key: dotted path → layer name, for every leaf of the merged config (arrays
 * and `modes` count as one value). Later layers win, as in `merge`.
 */
export function provenance(layers) {
  const out = {};
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
 */
export function resolveModes(modes, where = 'modes') {
  const done = {};
  const visit = (name, chain) => {
    if (done[name]) return done[name];
    const m = modes[name];
    if (!isObj(m)) throw new SetupError(`${where}: mode "${chain.at(-2) ?? name}" extends "${name}", which is not defined`);
    if (!m.extends) return (done[name] = { ...m });
    if (chain.includes(m.extends)) throw new SetupError(`${where}: modes extend each other in a cycle: ${[...chain, m.extends].join(' → ')}`);
    const parent = visit(m.extends, [...chain, m.extends]);
    const { extends: _, ...own } = m;
    return (done[name] = { ...parent, ...own });
  };
  for (const name of Object.keys(modes)) visit(name, [name]);
  return Object.fromEntries(Object.keys(modes).map((k) => [k, done[k]]));
}

/** Environment overrides (layer 3). */
function envLayer(env) {
  const out = {};
  if (env.PXSIG_STORYBOOK_URL) out.storybook = { url: env.PXSIG_STORYBOOK_URL };
  if (env.PXSIG_GRID) out.grid = Number(env.PXSIG_GRID);
  if (env.PXSIG_SOURCES) out.affects = { extra: env.PXSIG_SOURCES.split(',').map((s) => `$workspace/${s.trim()}`), workspaceDeps: false };
  return out;
}

/** Source folders of the project's workspace dependencies (affects.workspaceDeps). */
function workspaceDepRoots(ws, projectDir) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  // Runtime dependencies only: a change to a dev-only workspace package (test or build config) can't change a render.
  const deps = Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies }).filter(([, v]) => String(v).startsWith('workspace:'));
  const req = createRequire(join(projectDir, 'package.json'));
  const out = [];
  for (const [name] of deps) {
    // The linked folder (pnpm, npm and yarn workspaces all link it), else Node's resolver.
    let dir = null;
    for (const find of [() => join(projectDir, 'node_modules', name), () => join(ws.root, 'node_modules', name), () => dirname(req.resolve(`${name}/package.json`))]) {
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
export function loadProject(ws, ref, { flags = {}, env = process.env } = {}) {
  const raw = existsSync(ref.configPath) ? readJsonFile(ref.configPath) : null;
  if (!raw) throw new SetupError(`project "${ref.name}": no ${CONFIG_FILE} at ${ref.configPath}`, { code: 'project-missing' });
  // The workspace file's paths are relative to the workspace root, not to the project.
  const wsDefaults = anchorPaths(ws, ws.defaults ?? {}, ws.root);
  const layers = [
    { name: 'defaults', value: DEFAULTS },
    { name: 'workspace defaults', value: wsDefaults },
    { name: 'project config', value: raw },
    { name: 'env', value: envLayer(env) },
    { name: 'flags', value: flags },
  ];
  const config = merge(...layers.map((l) => l.value));
  const sources = provenance(layers);
  const root = ref.dir;
  const store = expand(ws, root, config.store.dir);
  // Modes are a set, not settings: a project's modes replace the defaults instead of joining them.
  const modesFrom = raw.modes ? 'project config' : wsDefaults.modes ? 'workspace defaults' : 'defaults';
  sources.modes = modesFrom;
  for (const k of Object.keys(sources)) if (k.startsWith('modes.')) delete sources[k];
  const modes = resolveModes(raw.modes ?? wsDefaults.modes ?? DEFAULTS.modes, modesFrom === 'project config' ? ref.configPath : modesFrom === 'workspace defaults' ? ws.file : 'built-in modes');
  const defaultMode = config.defaultMode ?? Object.keys(modes)[0];
  const srcRoot = expand(ws, root, config.srcRoot);
  const affects = [
    ...(config.affects.workspaceDeps ? workspaceDepRoots(ws, root) : []),
    ...(config.affects.extra ?? []).map((p) => expand(ws, root, p)),
    ref.configPath,
  ];
  const wsRel = (abs) => toPosix(relative(ws.root, abs));
  const layout = config.store.layout;
  if (!['package', 'colocated'].includes(layout)) throw new SetupError(`project "${ref.name}": store.layout must be "package" or "colocated"`);
  const P = {
    name: ref.name,
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
    manifestPath: (suite = null) => join(store, suite ? `manifest.${suite}.json` : 'manifest.json'),
    /** Workspace-relative baseline path for an entry, by layout. */
    sigFor(id, importPath) {
      const comp = componentOfImport(P, importPath);
      const file = `${id}.psig`;
      return layout === 'colocated' ? wsRel(join(srcRoot, comp, '__pxsig__', file)) : wsRel(join(store, 'baselines', comp, file));
    },
    rustBin: rustBinary(env),
    serverUrl: () => serverUrlFor(ws.root, { env, port: ws.server?.port }),
  };
  return P;
}

/** The component folder (relative to srcRoot) for a workspace-relative story file path. */
export function componentOfImport(P, importPath) {
  if (!importPath) return '_';
  const abs = resolve(P.workspaceRoot, importPath);
  const rel = toPosix(relative(P.srcRoot, dirname(abs)));
  return rel && !rel.startsWith('..') ? rel : '_';
}

/** What `expandEntries` (lib/manifest.mjs) needs to turn stories into manifest entries. */
export const entryConfig = (P) => ({
  modes: P.modes,
  defaultMode: P.defaultMode,
  modesByDefault: P.modesByDefault,
  viewport: P.config.capture.viewport,
  a11y: P.config.a11y,
});

/** The settings Rust and the renderer need for a run, merged into the entries for one run. */
export function runManifest(P, manifest) {
  const c = P.config;
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
    affectsAll: P.affects,
    a11y: c.a11y,
    stories: manifest.stories ?? [],
    skipped: manifest.skipped ?? [],
  };
}

/**
 * Write the run manifest Rust reads (entries + resolved settings) to `<store>/reports/.run/` and
 * return its path. The committed manifest holds entries only, so it can't disagree with config.
 */
export function writeRunManifest(P, manifestPath = P.manifestPath(), { dir: runDir } = {}) {
  let m;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new SetupError(`no readable manifest at ${manifestPath} (${e.code ?? e.message}): run \`pxsig manifest\` first`);
  }
  const run = runManifest(P, m);
  // `dir`: elsewhere than the store (a server without the store lock writes nothing in it).
  const dir = runDir ?? join(P.store.reports, '.run');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, basename(manifestPath));
  writeFileSync(`${out}.tmp`, JSON.stringify(run));
  renameSync(`${out}.tmp`, out);
  return { path: out, manifest: run };
}

/** The pxsig binary: PXSIG_BIN, else the platform package, else a source checkout's build. */
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
  return resolve(here, '..', '..', '..', '..', 'target', 'release', exe);
}

/**
 * Load a peer dependency (playwright, axe-core) the way the project would: from the project, then
 * the workspace root, then pxsig's own install. Playwright is also found through
 * `@playwright/test`, so renders use the browser build the project already tests with.
 */
export function resolvePeer(P, name) {
  const bases = [P?.root, P?.workspaceRoot].filter(Boolean);
  const tries = [];
  for (const base of bases) {
    tries.push(() => createRequire(join(base, 'package.json')).resolve(name));
    if (name === 'playwright' || name.startsWith('playwright/'))
      tries.push(() => createRequire(createRequire(join(base, 'package.json')).resolve('@playwright/test/package.json')).resolve(name));
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

/** Where the running server writes its address: never committed, never inside a package. */
export const serverFile = (root) => join(root, 'node_modules', '.cache', 'pxsig', 'server.json');

/** The server URL for a workspace: PXSIG_URL, else the running server's file, else the configured port. */
export function serverUrlFor(wsRoot, { env = process.env, port = null } = {}) {
  if (env.PXSIG_URL) return env.PXSIG_URL.replace(/\/$/, '');
  try {
    const s = JSON.parse(readFileSync(serverFile(wsRoot), 'utf8'));
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
let processFlags = {};
export const setFlagLayer = (layer) => (processFlags = layer ?? {});

/** One call for the common case: workspace + project from argv-style options. */
export function openProject({ cwd = process.cwd(), workspace = null, project = null, flags = null, env = process.env } = {}) {
  flags ??= processFlags;
  const ws = findWorkspace({ cwd, workspace, env });
  const ref = pickProject(ws, { project: project ?? env.PXSIG_PROJECT ?? null, cwd });
  if (!ref) throw new SetupError(`this workspace has ${ws.projects.length} projects; choose one with --project (${ws.projects.map((p) => p.name).join(', ')})`, { choices: ws.projects.map((p) => p.name) });
  return loadProject(ws, ref, { flags, env });
}
