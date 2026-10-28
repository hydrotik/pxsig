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

/** What `runManifest` returns: the entries plus the resolved settings Rust and the renderer read. */
export interface RunManifest {
  version: 2;
  baseUrl: string;
  viewport: Size;
  colorScheme: string;
  globals: string;
  settleMs: number;
  target: string;
  waitFor: Config['capture']['waitFor'];
  grid: number;
  minCellPx: number;
  detail: boolean;
  trim: Config['trim'];
  gate: Gate;
  modes: Record<string, Mode>;
  defaultMode: string;
  srcRoot: string;
  affectsAll: string[];
  affectsIgnore: string[];
  affectsAliases: Record<string, string>;
  affectsUnresolved: string[];
  store: {
    dir: string;
    a11y: string;
    approvals: string;
    a11yDecisions: string;
    /** Suite name (`''` for the default manifest) → workspace-relative manifest path. */
    manifests: Record<string, string>;
    suite: string | null;
  };
  a11y: boolean;
  stories: ManifestEntry[];
  skipped: ManifestSkipped[];
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
  flags?: { name: string }[];
  subcommands?: Record<string, HelpCommand>;
}

/** help/commands.json, as far as args.mjs reads it. */
export interface HelpCommands {
  global: HelpCommand;
  commands: Record<string, HelpCommand>;
}

// --- files (lib/files.mjs) -----------------------------------------------------------------------

/** A log line that is cut short or does not parse (integrity code `log-torn`). */
export interface TornLine {
  /** 1-based line number. */
  line: number;
  /** The line's text, cut at 80 characters. */
  text: string;
}

// --- psig (lib/psig.mjs; docs/spec.md section 5) -------------------------------------------------

/** One entry of a `.psig` header's `sections`. */
export interface PsigSection {
  name: string;
  length: number;
  sha256?: string;
  /** The image section: `image/png`. */
  type?: string;
  width?: number;
  height?: number;
}

/**
 * A `.psig` header, as read from the file. The keys a reader must tolerate missing (an older or a
 * foreign file) are optional.
 */
export interface PsigHeader {
  format?: string;
  container?: number;
  entry?: { id: string; story: string; mode: string; state: string | null };
  /** 0.5 and later: the render environment (lib/env.mjs). */
  env?: EnvRecord;
  /** The spec v1 record, without `sig`. */
  record?: Record<string, unknown>;
  encryption?: string;
  sections?: PsigSection[];
}

// --- manifest (lib/manifest.mjs; docs/spec.md section 6) -----------------------------------------

/** An interaction state from `parameters.pxsig.states`. */
export interface InteractionState {
  name: string;
  action: string;
  target?: string;
  key?: string | string[];
  waitFor?: string;
  fullPage?: boolean;
}

/** A story's `parameters.pxsig` (plain data: read through a JSON round-trip). */
export interface StoryPxsigParameters {
  disable?: boolean;
  modes?: string[];
  addModes?: string[];
  gate?: Partial<Gate>;
  grid?: number;
  detail?: boolean;
  ignore?: string[];
  states?: InteractionState[];
  delay?: number;
  target?: string;
  a11y?: boolean;
  viewport?: Size;
}

/** What `harvestParameters` reads for one story. */
export interface StoryParameters {
  pxsig: StoryPxsigParameters;
  tags: string[];
  play?: boolean;
  /** Loading the story failed: the error's message. */
  error?: string;
}

/** The part of Storybook's preview (`window.__STORYBOOK_PREVIEW__`) `harvestParameters` reads. */
export interface StorybookPreviewWindow {
  __STORYBOOK_PREVIEW__: {
    storeInitializationPromise: Promise<unknown>;
    storyStoreValue: {
      loadStory(options: { storyId: string }): Promise<{
        parameters?: { pxsig?: unknown };
        tags?: string[];
        playFunction?: unknown;
      }>;
    };
  };
}

/** A manifest entry (docs/spec.md, "Entry keys"). */
export interface ManifestEntry {
  id: string;
  story: string;
  mode: string;
  state: string | null;
  /** Baseline path, relative to the workspace root. */
  sig: string;
  /** The story file, relative to the workspace root. */
  importPath: string;
  globals: string;
  colorScheme: string;
  viewport: Size;
  browser: string;
  grid?: number;
  gate?: Partial<Gate>;
  detail?: false;
  ignore?: string[];
  interaction?: InteractionState;
  delay?: number;
  target?: string;
  play?: true;
  a11y: boolean;
}

/** A story the manifest leaves out, with the reason. */
export interface ManifestSkipped {
  id: string;
  reason: string;
}

/** A manifest file, version 2. */
export interface Manifest {
  version: number;
  project?: string;
  stories: ManifestEntry[];
  skipped?: ManifestSkipped[];
}

/** A story `expandEntries` turns into entries. */
export interface StoryRef {
  id: string;
  importPath: string;
  /** The baseline path for an entry key. */
  sigFor: (key: string) => string;
}

/**
 * The settings `expandEntries` reads: `entryConfig(P)` (lib/workspace.mjs), or the older shape with
 * one `globals` / `colorScheme` and no modes.
 */
export interface EntryConfig {
  modes?: Record<string, Mode>;
  defaultMode?: string | null;
  modesByDefault?: string[] | null;
  viewport?: Size;
  a11y?: boolean;
  globals?: string;
  colorScheme?: Mode['colorScheme'];
}

// --- env (lib/env.mjs; docs/configuration.md#env) ------------------------------------------------

/** A field's tier: a `major` difference is a mismatch, a `minor` one only compatible. */
export type EnvTier = 'major' | 'minor';

/** The render environment of one browser (`env`, `v` 1), as a `.psig` header and check.json keep it. */
export interface EnvRecord {
  v: number;
  /** First 16 hex of sha256 over the major fields (`envId`). */
  id: string;
  browser: { name: string; version: string | null; channel: string | null; launchArgs: string[] };
  playwright: string | null;
  os: {
    platform: string | null;
    arch: string | null;
    release: string | null;
    distro: string | null;
  };
  fonts: {
    probe: { digest: string; families: Record<string, string> };
    system: string | null;
  };
  render: {
    dpr: number;
    gpu: string;
    colorGamut: string;
    timezone: string | null;
    locale: string | null;
    reducedMotion: string;
  };
  capture: { pipeline: number };
  container: { image: string | null; revision: string | null; digest: string | null } | null;
  pxsig: string | null;
  engine: string | null;
  node: string;
}

/** An env before its `id` is computed over it. */
export type EnvFields = Omit<EnvRecord, 'id'> & { id?: string };

/** What `collectEnv` uses of a Playwright Browser (tests pass a stand-in with only this). */
export interface EnvBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    reducedMotion: 'reduce';
  }): Promise<{
    newPage(): Promise<{
      setContent(html: string): Promise<unknown>;
      evaluate<A>(fn: (arg: A) => unknown, arg?: A): Promise<unknown>;
    }>;
    close(): Promise<unknown>;
  }>;
  browserType?(): { name?(): string };
  version?(): string;
}

/** The browser server this process connected to, and what `pxsig browser start` recorded for it. */
export interface RemoteBrowser {
  endpoint: string;
  record?: { image?: string | null; revision?: string | null; digest?: string | null } | null;
}

/** What `PROBE_PAGE` returns from the probe page. */
export interface EnvProbe {
  /** Family → text width per probe size. */
  widths: Record<string, number[]>;
  renderer: string | null;
  colorGamut: string;
  timezone: string | null;
  locale: string | null;
  platform: string | null;
}

/** How a baseline's env compares with a render's. */
export type EnvMatch = 'same' | 'compatible' | 'mismatch' | 'unknown';

/** What `compareEnv` returns. */
export interface EnvComparison {
  match: EnvMatch;
  /** The differing fields (only when not `same`). */
  diff?: string[];
  /** The font families, when `fonts.probe` differs. */
  fonts?: string[];
}

/** `summary.envMismatch` and `summary.envFields`, from `envSummary`. */
export interface EnvSummary {
  envMismatch: number;
  envFields?: string[];
}

/** The project's `env` settings with their defaults (`envConfig`). */
export interface EnvSettings {
  ignore: string[];
  fontProbe: string[];
  strict: boolean;
}

// --- rows (lib/rows.mjs; docs/spec.md section 7) -------------------------------------------------

/** One axe violation as a render reports it. */
export interface A11yViolation {
  id: string;
  impact?: string | null;
  help?: string;
  /** How many elements. */
  nodes?: number;
  /** The first few elements' selectors. */
  targets?: string[];
}

/** A row's `a11y`: the render's axe result, with what is new against the entry's accepted list. */
export interface A11yResult {
  violations?: A11yViolation[];
  error?: string;
  /** Violations not on the entry's accepted list. */
  new?: number;
  /** The entry's accepted rule ids, or null when the store has no a11y.json. */
  baseline?: string[] | null;
}

/** The engine's result for one entry (check.json metrics and verdict, section 4). */
export interface EngineResult {
  pass?: boolean;
  flaky?: boolean;
  error?: string | null;
  [metric: string]: unknown;
}

/** One render, as the renderer (lib/capture.mjs) reports it. */
export interface RenderResult {
  id?: string;
  png?: string | null;
  ms?: number;
  error?: string;
  a11y?: { violations?: A11yViolation[]; error?: string } | null;
}

/** One row of check.json: the engine's result, the render and the review state of an entry. */
export interface CheckRow {
  id: string;
  story?: string;
  mode?: string;
  state?: string | null;
  browser?: string;
  globals?: string;
  pass?: boolean;
  changed?: boolean;
  error?: string | null;
  new?: boolean;
  reasons?: string[];
  note?: string;
  renderMs?: number;
  checkedAt?: string;
  a11y?: A11yResult | null;
  js?: unknown;
  skipped?: boolean;
  /** Approved in review since this verdict (the server marks the row; the next check clears it). */
  approved?: { at: string; batch: string };
  flaky?: boolean;
  cached?: boolean;
  /** The render's env id (lib/env.mjs `annotateRow`). */
  env?: string | null;
  baselineEnv?: string | null;
  envMatch?: EnvMatch;
  envDiff?: string[];
  envFonts?: string[];
  [key: string]: unknown;
}

/** check.json's `summary`, as `summarize` counts it (plus what the caller adds). */
export interface CheckSummary {
  entries: number;
  checked: number;
  skipped: number;
  passed: number;
  failed: number;
  changed: number;
  approved: number;
  flaky: number;
  new: number;
  errors: number;
  cached: number;
  a11yViolations: number;
  a11yNew: number;
  modes: (string | undefined)[];
}

// --- approvals (lib/approvals.mjs) ---------------------------------------------------------------

/**
 * One line of `<store>/approvals.ndjson`, as `record` (and `pxsig migrate`) write it. A line from an
 * older pxsig may lack the later keys.
 */
export interface ApprovalLine {
  at: string;
  id: string;
  /** Who, only with `approvals.identity: "git-email"`. */
  by?: string | null;
  via: string;
  batch: string;
  reason?: string | null;
  kind?: string | null;
  gitHead?: string | null;
  /** sha256 of the baseline before (null: a first baseline) and after. */
  before?: string | null;
  after?: string | null;
  /** The assistant's marker, when one started the process (lib/agents.mjs). */
  agent?: string;
  /** The pxsig version that wrote the line. */
  pxsig?: string;
  [key: string]: unknown;
}

// --- integrity (lib/integrity.mjs) ---------------------------------------------------------------

/** A story in the story index: Storybook's index.json, or the static scan of the story files. */
export interface IndexStory {
  id: string;
  title: string;
  name: string;
  /** The story file, relative to the workspace root. */
  importPath: string;
  tags?: string[];
  /** The static scan: the export the story comes from, and where its title came from. */
  exportName?: string;
  titleSource?: string;
}

/** What `loadStoryIndex` returns: the live index when Storybook answers healthy, else the scan. */
export interface StoryIndex {
  source: 'storybook' | 'static';
  storybook: {
    url: string;
    reachable: boolean;
    healthy: boolean;
    version?: unknown;
    error?: string;
  };
  stories: IndexStory[];
}

// --- machine (lib/machine.mjs) -------------------------------------------------------------------

/** Which machine's folders: the defaults are this process's. */
export interface MachineOptions {
  /** `process.platform`'s values (`darwin`, `linux`, `win32`, …). */
  platform?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

// --- agents (lib/agents.mjs) ---------------------------------------------------------------------

/** One row of `MARKERS`: variables an assistant sets, and the name they give. */
export interface AgentMarker {
  vars: string[];
  /** Only a value this accepts counts. */
  when?: (value: string) => boolean;
  name: string | ((value: string) => string);
}

/** What `detectAgent` returns. */
export interface DetectedAgent {
  name: string;
  variable: string;
  /** Cleaned like a name: safe to print and to log. */
  value: string;
}

// --- assistants (lib/assistants.mjs) -------------------------------------------------------------

/** How an assistant starts pxsig's MCP server. */
export interface McpRecipe {
  file: string;
  scope: 'project' | 'user';
  lang: string;
  text: string;
}

/** One row of `ASSISTANTS`. */
export interface Assistant {
  id: string;
  label: string;
  mcp: (repo: string) => McpRecipe | null;
  instructions: { file: string; text: string } | null;
  policy: string | null;
  notes: string[];
}

// --- static (lib/static.mjs) ---------------------------------------------------------------------

/** A Storybook build served by `serveStaticDir`. */
export interface StaticServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

// --- lock (lib/lock.mjs) -------------------------------------------------------------------------

/** `<store>/reports/.lock`, as `acquireLock` writes it. */
export interface LockBody {
  pid: number;
  startedAt: string;
  host: string;
  /** Which command holds it (`check`, `serve`, …); a caller that names none writes no key. */
  holder?: string;
  command: string;
  url?: string;
  nonce: string;
  generation: number;
  heartbeatAt: string;
}

/**
 * The lock as `readLock` judges it. The file's keys may be missing (an unreadable file, a lock
 * from before the heartbeat), so all of them are optional here.
 */
export interface LockState extends Partial<LockBody> {
  stale: boolean;
  why?: string;
  foreign?: boolean;
  quiet?: boolean;
  heartbeatAgeMs?: number;
}

/** What `acquireLock` returns. */
export interface LockHandle {
  release: () => void;
  /** Rewrite the lock's body (the server adds its URL once it listens). */
  update: (extra: Partial<LockBody>) => void;
  /** Before a batch of store writes: throws when another process has taken the lock over. */
  check: () => void;
  /** This process already held it. */
  reentrant?: true;
}

/** `acquireLock` / `takeLock` options. */
export interface LockOptions {
  holder?: string;
  command?: string;
  url?: string | null;
  /** The nonce `takeLock` showed a person: replaces a quiet lock that still has it. */
  takeOver?: string | null;
}

// --- guard (lib/guard.mjs) -----------------------------------------------------------------------

// --- sarif (lib/sarif.mjs; SARIF 2.1.0) ---------------------------------------------------------

/** One SARIF rule: an axe rule. */
export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri: string;
  properties: { tags: string[] };
}

/** One SARIF result: a new violation of one rule on one entry. */
export interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: {
    physicalLocation?: { artifactLocation: { uri: string } };
    logicalLocations: { name: string; kind: string }[];
  }[];
  properties: { entry: string; mode: string | null; impact: string | null };
}

/** What `sarifLog` returns. */
export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: {
    tool: {
      driver: { name: string; version?: string; informationUri: string; rules: SarifRule[] };
    };
    results: SarifResult[];
  }[];
}

/** The server's two file tokens. */
export interface Tokens {
  cli?: string | null;
  mcp?: string | null;
}

/** What `authorize` returns. */
export type Authorization =
  | { ok: true; via: 'dashboard' | 'cli' | 'mcp' | null }
  | { ok: false; via?: undefined; status: number; error: string; code?: string };
