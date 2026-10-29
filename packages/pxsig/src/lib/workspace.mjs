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
/** @import { Project } from '../types.js' */
/** @typedef {import('./workspace/layers.mjs').Obj} Obj */
/** @typedef {import('./workspace/layers.mjs').FlagLayer} FlagLayer */
import { SetupError } from './workspace/core.mjs';
import { findWorkspace, pickProject } from './workspace/find.mjs';
import { loadProject } from './workspace/project.mjs';

export { SetupError } from './workspace/core.mjs';
export {
  DEFAULTS,
  expand,
  flagLayer,
  merge,
  provenance,
  resolveModes,
} from './workspace/layers.mjs';
export {
  CONFIG_FILE,
  WORKSPACE_FILE,
  findWorkspace,
  missingProjects,
  pickProject,
  satisfies,
  unlistedConfigs,
  workspaceProblems,
} from './workspace/find.mjs';
export {
  PXSIG_VERSION,
  engineProblems,
  engineVersion,
  imageProblems,
  parseImageTag,
} from './workspace/versions.mjs';
export { loadProject } from './workspace/project.mjs';
export {
  componentOfImport,
  entryConfig,
  runManifest,
  writeRunManifest,
} from './workspace/run-manifest.mjs';
export {
  browserFile,
  resolvePeer,
  rustBinary,
  serverFile,
  serverUrlFor,
} from './workspace/peers.mjs';

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
