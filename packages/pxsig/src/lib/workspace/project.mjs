/** Resolving one project (workspace.mjs): its layers, merged config, paths and store. */
/** @import { Config, ConfigFile, Mode, PackageJson, Project, ProjectRef, Workspace } from '../../types.js' */
/** @import { Obj } from './layers.mjs' */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { toPosix } from '../paths.mjs';
import { checkEnforcementConfig } from '../enforcement.mjs';
import { SetupError, readJsonFile } from './core.mjs';
import { CONFIG_FILE } from './find.mjs';
import {
  DEFAULTS,
  anchorPaths,
  expand,
  isObj,
  merge,
  provenance,
  resolveModes,
} from './layers.mjs';
import { componentOfImport } from './run-manifest.mjs';
import { rustBinary, serverUrlFor } from './peers.mjs';

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
 * `approvals`: only what this pxsig does (docs/agents.md#approval-levels: Strict is a later
 * release).
 * @param {Config} config
 * @param {ProjectRef} ref
 */
function checkApprovals(config, ref) {
  const a = config.approvals ?? {};
  if (a.level != null && a.level !== 'standard')
    throw new SetupError(
      a.level === 'strict'
        ? `project "${ref.name}": approvals.level "strict" is not available yet; remove it or set "standard"`
        : `project "${ref.name}": approvals.level must be "standard"`
    );
  if (a.identity != null && !['none', 'git-email'].includes(a.identity))
    throw new SetupError(`project "${ref.name}": approvals.identity must be "none" or "git-email"`);
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
