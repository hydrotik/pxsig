/**
 * setup.mjs — set a project up, keep its manifest in step with Storybook, and move an old store in.
 *
 *   initProject      write pxsig.config.json, the store's .gitignore / .gitattributes, and the
 *                    workspace entry (`pxsig init`)
 *   buildManifest    every story in the project's srcRoot × its modes × its interaction states,
 *                    from the running Storybook (`pxsig manifest`)
 *   migrateLegacy    a pre-0.2 store (its baselines folder, base renders and manifests) into
 *                    `<store>/` with `.psig` baselines, verified (`pxsig migrate`)
 *   ensureGitattributes  `*.psig binary diff=psig` in the repository's root `.gitattributes`, so
 *                    colocated `__pxsig__/` baselines are binary to git too (the store's own
 *                    `.gitattributes` only covers files under the store)
 *
 * Nothing here approves anything or changes a signature: migration packs the same signature bytes.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { componentOf, loadStoryIndex, resolveContext, writeJsonAtomic } from './integrity.mjs';
import { expandEntries, harvestParameters } from './manifest.mjs';
import { CONFIG_FILE, entryConfig, SetupError, WORKSPACE_FILE } from './workspace.mjs';
import { toPosix } from './paths.mjs';
import { writeJson } from './files.mjs';
/** @import { ManifestEntry, Project, WorkspaceFile } from '../types.js' */
/** @import { BuiltManifest, DescribedConfig, InitConfig } from '../types/t6.js' */
export {
  ensureGitattributes,
  PSIG_ATTRIBUTE,
  STORE_GITATTRIBUTES,
  STORE_GITIGNORE,
} from './setup/shared.mjs';
export { migrateLegacy, verifyMigration } from './setup/migrate.mjs';
import {
  ensureGitattributes,
  readJson,
  STORE_GITATTRIBUTES,
  STORE_GITIGNORE,
} from './setup/shared.mjs';

/**
 * The layout a project resolves to, from its config and the workspace defaults.
 * @param {InitConfig} cfg
 * @param {string | null} workspaceRoot
 * @returns {string}
 */
const layoutOf = (cfg, workspaceRoot) =>
  cfg.store?.layout ??
  (workspaceRoot
    ? // the workspace file, as written: its defaults are a project config layer
      /** @type {WorkspaceFile & { defaults?: InitConfig }} */ (
        readJson(join(workspaceRoot, WORKSPACE_FILE), {})
      )?.defaults?.store?.layout
    : null) ??
  'package';

/**
 * The Storybook folders `pxsig init` records when it finds them in the package: `.storybook/`
 * (storybook.configDir) and a `storybook-static/` build folder (storybook.staticDir), both as
 * paths relative to the package, as pxsig.config.json reads them. Null when absent.
 * @param {string} dir
 * @returns {{ configDir: string | null, staticDir: string | null }}
 */
export function detectStorybook(dir) {
  /** @param {string} p */
  const isDir = (p) => {
    try {
      return statSync(join(dir, p)).isDirectory();
    } catch {
      return false;
    }
  };
  return {
    configDir: isDir('.storybook') ? '.storybook' : null,
    staticDir: isDir('storybook-static') ? 'storybook-static' : null,
  };
}

/**
 * Set a package up: its config (unless one exists), its store and, in a monorepo, its entry in
 * the workspace file. A colocated project also gets `*.psig binary diff=psig` in the root
 * `.gitattributes` (the workspace's, else its own). Returns what it wrote.
 * @param {{ dir: string, name?: string | null, label?: string | null, srcRoot?: string, storybookUrl?: string | null, storybookConfigDir?: string | null, storybookStaticDir?: string | null, workspaceRoot?: string | null, layout?: string | null }} opts
 * @returns {string[]}
 */
export function initProject({
  dir,
  name = null,
  label = null,
  srcRoot = 'src',
  storybookUrl = null,
  storybookConfigDir = null,
  storybookStaticDir = null,
  workspaceRoot = null,
  layout = null,
}) {
  /** @type {string[]} */
  const wrote = [];
  const configPath = join(dir, CONFIG_FILE);
  if (layout && !['package', 'colocated'].includes(layout))
    throw new SetupError('--layout must be "package" or "colocated"');
  if (label != null && (!label.trim() || label.trim().length > 60))
    throw new SetupError('--label must be text of 1 to 60 characters');
  if (!existsSync(configPath)) {
    /** @type {InitConfig} */
    const cfg = {
      version: 1,
      ...(name ? { name } : {}),
      ...(label?.trim() ? { label: label.trim() } : {}),
      srcRoot,
    };
    if (storybookUrl || storybookConfigDir || storybookStaticDir)
      cfg.storybook = {
        ...(storybookUrl ? { url: storybookUrl } : {}),
        ...(storybookConfigDir ? { configDir: storybookConfigDir } : {}),
        ...(storybookStaticDir ? { staticDir: storybookStaticDir } : {}),
      };
    if (layout) cfg.store = { layout };
    writeJson(configPath, cfg, { pretty: true });
    wrote.push(configPath);
  }
  // the project's config, as written (by this function or by hand)
  const cfg = /** @type {InitConfig} */ (readJson(configPath, {}));
  const store = resolve(dir, cfg.store?.dir ?? '.pxsig');
  mkdirSync(store, { recursive: true });
  for (const [file, text] of [
    ['.gitignore', STORE_GITIGNORE],
    ['.gitattributes', STORE_GITATTRIBUTES],
  ]) {
    const p = join(store, file);
    if (!existsSync(p)) {
      writeFileSync(p, text);
      wrote.push(p);
    }
  }
  if (workspaceRoot && resolve(workspaceRoot) !== resolve(dir)) {
    const wsFile = join(workspaceRoot, WORKSPACE_FILE);
    const ws = /** @type {WorkspaceFile} */ (readJson(wsFile, { version: 1, projects: {} }));
    const rel = toPosix(relative(workspaceRoot, dir));
    if (!Object.values(ws.projects ?? {}).includes(rel)) {
      const key = cfg.name ?? name ?? basename(dir);
      if (ws.projects?.[key])
        throw new SetupError(`${wsFile} already has a project named "${key}": pass --name`);
      ws.projects = { ...ws.projects, [key]: rel };
      writeJson(wsFile, ws, { pretty: true });
      wrote.push(wsFile);
    }
  }
  if (layoutOf(cfg, workspaceRoot) === 'colocated') {
    const ga = ensureGitattributes(workspaceRoot ?? dir);
    if (ga) wrote.push(ga);
  }
  return wrote;
}

/**
 * A suite's entry options: `{ modes: [...] }` means exactly those modes.
 * @param {Project} P
 * @param {string | null} suite
 * @returns {{ addModes?: string[], modes?: string[] }}
 */
function suiteOptions(P, suite) {
  if (!suite) return {};
  const s = P.config.suites?.[suite];
  if (!s)
    throw new SetupError(
      `project "${P.name}" has no suite "${suite}" (suites: ${Object.keys(P.config.suites ?? {}).join(', ') || 'none'})`
    );
  const modes = s.modes ?? s.addModes ?? [];
  const unknown = modes.filter((m) => !P.modes[m]);
  if (unknown.length)
    throw new SetupError(`suite "${suite}" names unknown modes: ${unknown.join(', ')}`);
  return { addModes: modes, modes };
}

/**
 * What makes a manifest suspect without stopping it: a srcRoot that does not exist, or a Storybook
 * none of whose stories is under the project (another package's Storybook answering on the port).
 * `importPath`s are relative to the workspace root, as loadStoryIndex normalises them.
 * @param {Project} P
 * @param {{ importPath: string }[]} stories
 * @param {string} from the index the stories came from
 * @returns {string[]}
 */
export function manifestWarnings(P, stories, from) {
  /** @param {string} abs */
  const ws = (abs) => toPosix(relative(P.workspaceRoot, abs)) || '.';
  /** @type {string[]} */
  const warnings = [];
  if (!existsSync(P.srcRoot))
    warnings.push(`srcRoot ${ws(P.srcRoot)} does not exist (pxsig.config.json "srcRoot")`);
  /** @param {string} p */
  const inProject = (p) => {
    const r = relative(P.root, resolve(P.workspaceRoot, p));
    return r !== '' && !r.startsWith('..') && !isAbsolute(r);
  };
  if (stories.length && !stories.some((s) => inProject(s.importPath)))
    warnings.push(
      `none of the ${stories.length} stories in ${from} is under ${ws(P.root)}: is it this project's Storybook? (storybook.url, storybook.configDir)`
    );
  return warnings;
}

/**
 * Build (or rebuild) a manifest from the running Storybook. Existing entries keep their baseline
 * path; new ones get the layout's path and no baseline. Returns { manifest, added, removed,
 * skipped }, the index it read (`source`) and `manifestWarnings`.
 * @param {Project} P
 * @param {{ suite?: string | null, write?: boolean }} [opts]
 * @returns {Promise<BuiltManifest>}
 */
export async function buildManifest(P, { suite = null, write = true } = {}) {
  const ctx = resolveContext(P, { manifestPath: P.manifestPath(suite) });
  const idx = await loadStoryIndex(ctx);
  if (idx.source !== 'storybook')
    throw new SetupError(
      `Storybook is needed to read each story's parameters: ${idx.storybook.error} (${idx.storybook.url})`
    );
  const warnings = manifestWarnings(P, idx.stories, idx.storybook.url);
  const nonVisual = new Set(P.config.nonVisual ?? []);
  const stories = idx.stories.filter((s) => {
    const c = componentOf(ctx, s.importPath);
    return c != null && !nonVisual.has(c.split('/')[0]);
  });
  if (!stories.length)
    throw new SetupError(
      [
        `no stories in ${toPosix(relative(P.workspaceRoot, P.srcRoot))} in the Storybook index at ${idx.storybook.url} (check srcRoot and storybook.configDir)`,
        ...warnings,
      ].join('; ')
    );
  const params = await harvestParameters(
    P,
    P.storybook.url,
    stories.map((s) => s.id)
  );
  // the manifest pxsig wrote last time, if any
  const before = /** @type {{ stories?: ManifestEntry[] }} */ (
    readJson(ctx.manifestPath, { stories: [] })
  );
  const known = new Map((before.stories ?? []).map((e) => [e.id, e]));
  const list = stories.map((s) => ({
    id: s.id,
    importPath: s.importPath,
    sigFor: (/** @type {string} */ key) => known.get(key)?.sig ?? P.sigFor(key, s.importPath),
  }));
  const { entries, skipped } = expandEntries(entryConfig(P), list, params, suiteOptions(P, suite));
  const ids = new Set(entries.map((e) => e.id));
  const manifest = {
    version: 2,
    project: P.name,
    ...(suite ? { suite } : {}),
    stories: entries,
    skipped,
  };
  if (write) writeJsonAtomic(ctx.manifestPath, manifest, { pretty: true });
  return {
    manifest,
    path: ctx.manifestPath,
    added: entries.filter((e) => !known.has(e.id)).map((e) => e.id),
    removed: [...known.keys()].filter((id) => !ids.has(id)),
    skipped,
    source: idx.storybook.url,
    warnings,
  };
}

/**
 * The resolved config, with the files it came from and, per key, the layer that set it.
 * @param {Project} P
 * @returns {DescribedConfig}
 */
export function describeConfig(P) {
  return {
    sources: P.configSources,
    project: P.name,
    label: P.label,
    scope: P.scope,
    workspace: P.workspaceRoot,
    workspaceFile: P.workspaceFile,
    configFile: P.configPath,
    root: P.root,
    srcRoot: P.srcRoot,
    storybook: P.storybook,
    store: P.store,
    modes: P.modes,
    defaultMode: P.defaultMode,
    modesByDefault: P.modesByDefault,
    affects: P.affects,
    rustBin: P.rustBin,
    config: P.config,
  };
}
