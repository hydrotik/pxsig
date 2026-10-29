/** The run manifest (workspace.mjs): the entries plus the resolved settings Rust reads for a run. */
/** @import { Manifest, Project, RunManifest } from '../../types.js' */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { toPosix } from '../paths.mjs';
import { writeAtomic } from '../files.mjs';
import { SetupError } from './core.mjs';

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
