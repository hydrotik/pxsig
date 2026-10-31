/**
 * types/config.d.ts — the command line, the workspace and the project config (lib/args.mjs,
 * lib/workspace.mjs; schema/project.json is the source). Types only; types.d.ts re-exports them.
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

/** `pxsig.workspace.json` (schema/workspace.json). Read as written: only `projects` is checked. */
export interface WorkspaceFile {
  $schema?: string;
  version?: number;
  /** Project name → its folder, relative to the workspace root. */
  projects?: Record<string, string>;
  /** Project config keys applied under each project's own config. */
  defaults?: Record<string, unknown>;
  /** The pxsig versions this workspace needs, as a range. */
  requires?: string;
  server?: { port?: number };
}

/**
 * A project's `pxsig.config.json` (schema/project.json), as read: any subset of the config keys.
 * `loadProject` merges it over the defaults.
 */
export type ConfigFile = Record<string, unknown> & { name?: string; modes?: Record<string, Mode> };

/** The keys of a `package.json` pxsig reads. */
export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
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

// --- config (lib/workspace.mjs; schema/project.json is the source) -------------------------------

/** `[width, height]` in CSS pixels. */
export type Size = [number, number];

/**
 * A named render setting (schema `$defs/mode`). A type, not an interface, so it is a plain object
 * to `isObj` (lib/workspace.mjs).
 */
export type Mode = {
  globals?: string;
  colorScheme?: 'light' | 'dark';
  viewport?: Size;
  browser?: 'chromium' | 'firefox' | 'webkit';
  extends?: string;
};

/** The gate's detail rule: off, on with the defaults, or tuned. */
export type DetailGate = boolean | { blockDelta?: number; energyDelta?: number; minTiles?: number };

export interface Gate {
  threshold: number;
  minCells: number;
  minSsim: number;
  maxChangedPct: number;
  maxEdgePct?: number;
  detail: DetailGate;
}

export type GateMode = 'enforce' | 'warn';

/**
 * The merged config of a project: built-in defaults, then each layer on top (lib/workspace.mjs).
 * A type, not an interface, so the merged layers (`Record<string, unknown>`) can be cast to it.
 */
export type Config = {
  $schema?: string;
  version?: number;
  name?: string;
  label?: string | null;
  srcRoot: string;
  storybook: { url: string; configDir: string | null; staticDir: string | null };
  store: { dir: string; layout: 'package' | 'colocated' };
  capture: {
    viewport: Size;
    settleMs: number;
    target: string;
    waitFor: { selector: string; minMs?: number; stableMarkup?: string }[];
    browserEndpoint: string | null;
  };
  grid: number;
  minCellPx: number;
  detail: boolean;
  trim: false | { pad?: number; tolerance?: number };
  gate: Gate;
  modes: Record<string, Mode>;
  defaultMode: string | null;
  modesByDefault: string[] | null;
  suites: Record<string, { modes?: string[]; addModes?: string[] }>;
  affects: {
    workspaceDeps: boolean;
    extra: string[];
    ignore: string[];
    aliases: Record<string, string>;
    unresolved: string[];
  };
  env?: { ignore?: string[]; fontProbe?: string[]; strict?: boolean };
  enforcement?: {
    default?: GateMode;
    gates?: Partial<Record<'visual' | 'verify' | 'env' | 'doctor' | 'stale', GateMode>> & {
      a11y?: GateMode | 'off';
    };
    warnUntil?: string;
    noticeDays?: number;
    advisoryExit?: number;
  };
  nonVisual: string[];
  a11y: boolean;
  integrity: {
    requireBaselineImages?: boolean;
    staleAfterSourceChange?: boolean;
    sourceRoots?: string[] | null;
    maxTracedFiles?: number;
    severity?: Record<string, 'error' | 'warn' | 'info'>;
    indexTimeoutMs?: number;
    renderSkewMs?: number;
    manifests?: string[];
  };
  importPathPattern?: string;
  approvals?: { identity?: 'none' | 'git-email'; level?: 'standard' | 'strict' };
  dashboard?: { ui?: string };
};

/** Absolute paths of a project's store (`<project>/.pxsig/` by default). */
export interface Store {
  root: string;
  layout: 'package' | 'colocated';
  baselines: string;
  latest: string;
  retry: string;
  diffs: string;
  diffLatest: string;
  reports: string;
  cache: string;
  history: string;
  trash: string;
  approvals: string;
  a11y: string;
}

/** A project, resolved: what `loadProject` / `openProject` return. */
export interface Project {
  name: string;
  /** The dashboard title after "pxsig ·" (config `label`); null: the name. */
  label: string | null;
  /** Absolute project folder. */
  root: string;
  workspaceRoot: string;
  workspaceFile: string | null;
  configPath: string;
  config: Config;
  /** Which layer set each config key (dotted path → layer name). */
  configSources: Record<string, string>;
  srcRoot: string;
  storybook: { url: string; configDir: string | null; staticDir: string | null };
  modes: Record<string, Mode>;
  defaultMode: string;
  modesByDefault: string[];
  /** Workspace-relative paths whose change affects every entry. */
  affects: string[];
  affectsIgnore: string[];
  affectsAliases: Record<string, string>;
  affectsUnresolved: string[];
  store: Store;
  manifestPath: (suite?: string | null) => string;
  sigFor: (id: string, importPath: string | null | undefined) => string;
  rustBin: string;
  serverUrl: () => string;
}

/** A problem the integrity ledger's `setup` lists (workspace, engine, image). */
export interface SetupProblem {
  code: string;
  severity: 'error' | 'warn' | 'info';
  reason: string;
}

/** Where a peer dependency is looked for (`resolvePeer`): a project, or any folders. */
export type PeerBase = { root?: string; workspaceRoot?: string } | null | undefined;

/** `ghcr.io/hydrotik/pxsig:<pxsig>-pw<playwright>…`, read by `parseImageTag`. */
export interface ImageTag {
  pxsig: string;
  playwright: string;
}

// --- args (lib/args.mjs) -------------------------------------------------------------------------

/** A flag no command knows, as `unknownFlags` reports it. */
export interface UnknownFlag {
  name: string;
  /** The closest known flag, within two edits (one for a short name). */
  suggestion: string | null;
  /** The word it took as its value, if any. */
  took: string | null;
}

/** One command (or subcommand, or the global options) in help/commands.json: only what args.mjs reads. */
export interface HelpCommand {
  flags?: { name: string; value?: string }[];
  subcommands?: Record<string, HelpCommand>;
}

/** help/commands.json, as far as args.mjs reads it. */
export interface HelpCommands {
  global: HelpCommand;
  commands: Record<string, HelpCommand>;
}
