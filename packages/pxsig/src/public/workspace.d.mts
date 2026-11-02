/**
 * Types for `pxsig/workspace` (./workspace.mjs): the resolver as the package exports it. The
 * shapes come from ../types.js, the same ones pxsig's own JSDoc uses.
 */
import type { Project, ProjectRef, Workspace } from '../types.js';

/** What every resolver function throws for a setup the user has to fix. */
export declare class SetupError extends Error {
  constructor(message: string, extra?: { code?: string; choices?: string[] });
  readonly setup: true;
  code?: string;
  choices?: string[];
}

/** Find the workspace from `cwd` (or `workspace`, PXSIG_WORKSPACE, or the legacy PXSIG_ROOT). */
export declare function findWorkspace(opts?: {
  cwd?: string;
  workspace?: string | null;
  env?: NodeJS.ProcessEnv;
}): Workspace;

/** Which project a command means: an explicit name or path, else the one containing `cwd`. */
export declare function pickProject(
  ws: Workspace,
  opts?: { project?: string | null; cwd?: string }
): ProjectRef | null;

/** A project's resolved config and store paths. */
export declare function loadProject(
  ws: Workspace,
  ref: ProjectRef,
  opts?: { flags?: Record<string, unknown>; env?: NodeJS.ProcessEnv }
): Project;

/** Workspace + project from argv-style options, in one call. */
export declare function openProject(opts?: {
  cwd?: string;
  workspace?: string | null;
  project?: string | null;
  flags?: Record<string, unknown> | null;
  env?: NodeJS.ProcessEnv;
}): Project;
