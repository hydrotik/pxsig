/**
 * `pxsig/workspace`: the resolver, as the package exports it. Find the workspace, pick a project,
 * and load its resolved config and store paths; `SetupError` is what each throws for a setup the
 * user has to fix.
 *
 * Only these names are public. pxsig's own modules import `../lib/workspace.mjs`, which also holds
 * the internals (config layers, version checks, peer paths, run manifests); those may change in any
 * release.
 */
export {
  SetupError,
  findWorkspace,
  loadProject,
  openProject,
  pickProject,
} from '../lib/workspace.mjs';
