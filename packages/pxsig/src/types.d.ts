/**
 * types.d.ts — the shapes pxsig's JavaScript passes around, for its JSDoc (`checkJs`) and for
 * `oxlint --type-aware`. Types only: nothing here runs. A module imports what it needs with
 * `/** @import { Workspace } from '../types.js' *\/`.
 *
 * The file formats themselves (manifest, `.psig`, approval log, reports) are specified in
 * docs/spec.md; a shape here follows that document, never the other way round. Each section
 * belongs to the modules named in its heading; add to the section of the module you type.
 */

// --- args (lib/args.mjs) -------------------------------------------------------------------------

/** Parsed command-line flags: `--name value` → string, a bare `--name` → true. */
export type Flags = Record<string, string | boolean | undefined>;

// --- workspace (lib/workspace.mjs) ---------------------------------------------------------------

/** A project as the workspace file lists it, before its config is read. */
export interface ProjectRef {
  name: string;
  /** Absolute folder. */
  dir: string;
  /** Absolute path of its `pxsig.config.json`. */
  configPath: string;
}

/** What `findWorkspace` returns. */
export interface Workspace {
  /** Absolute folder holding `pxsig.workspace.json`, or the single package's folder. */
  root: string;
  /** Absolute path of `pxsig.workspace.json`; null for a single package without one. */
  file: string | null;
  /** `defaults` from the workspace file: the project config layer below each project's own. */
  defaults: Record<string, unknown>;
  /** `server` from the workspace file (`port`). */
  server: { port?: number };
  projects: ProjectRef[];
}
