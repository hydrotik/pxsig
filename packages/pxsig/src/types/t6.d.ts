/**
 * types/t6.d.ts — the shapes of the CLI (cli.mjs, cli/), the MCP server (mcp.mjs, mcp-call.mjs),
 * help (help.mjs) and setup (setup.mjs, lib/setup.mjs). Types only: nothing here runs.
 */

import type {
  CheckRow,
  CheckSummary,
  EngineResult,
  EnvRecord,
  EnvSummary,
  Manifest,
  ManifestEntry,
  ManifestSkipped,
  Project,
} from '../types.js';
import type { tools } from '../tools/index.mjs';

// --- term blocks (lib/term.mjs, as the CLI builds them) ------------------------------------------
// The same shapes as types/t2.d.ts (lib/term.mjs's own, as of this writing), repeated until the
// groups merge.

/** How a command's output is rendered (`pickFormat`). */
export type Format = 'pretty' | 'plain' | 'json';

/** The SGR styles `painter` knows. */
export type Style =
  | 'bold'
  | 'dim'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'gray';

/** What `painter` returns: a function per style, plus an OSC 8 link. */
export type Painter = Record<Style, (s: string | number) => string> & {
  link: (text: string | number, url?: string | null) => string;
};

/** A styled cell: coloured in pretty mode, a link when it has a URL. */
export interface StyledCell {
  text: string | number;
  /** One of the `Style` names (typed `string`: callers build cells before they are typed). */
  color?: string;
  url?: string | null;
  /** Markdown prints the text alone. */
  noLinkInPlain?: boolean;
}

/** A value in a kv, table or list block. */
export type Cell = string | number | boolean | null | undefined | StyledCell | Cell[];

/** A table block's column. */
export interface TableColumn {
  key: string;
  label: string;
  right?: boolean;
}

/** An image line: inline in iTerm2 / WezTerm, else its path. */
export interface ImageItem {
  label: string;
  path: string;
  data?: Buffer | null;
  missing?: boolean;
}

/**
 * One block of a document `emit` prints. The first key it has, in this order, says what it is. The
 * rows of `kv` and `next` are pairs (`[label, value]`, `[command, why]`); they are typed as arrays
 * because untyped callers build them as array literals.
 */
export interface Block {
  h?: string;
  sub?: string | null;
  kv?: readonly (readonly Cell[])[];
  table?: {
    cols: readonly TableColumn[];
    rows: readonly Record<string, Cell>[];
    more?: number;
    moreHint?: string;
  };
  list?: readonly Cell[];
  note?: string;
  /** `ok`, `warn` or `bad`; any other is shown plain. */
  tone?: string;
  next?: readonly (readonly string[])[];
  /** The next block's heading ("Next" when absent). */
  title?: string;
  images?: readonly ImageItem[];
  text?: string;
}

// --- help (help.mjs; src/help/commands.json, settings.json, topics/*.md) -------------------------

/** One flag of a command in commands.json. */
export interface HelpFlag {
  name: string;
  /** The value's placeholder (`--port <n>`). */
  value?: string;
  meaning?: string;
  env?: string;
  setting?: string;
  default?: string;
  readBy?: string;
}

/** A command or subcommand in commands.json. */
export interface HelpCommandEntry {
  summary: string;
  usage: string[];
  flags?: HelpFlag[];
  effects?: string[];
  /** Exit code → meaning. */
  exits?: Record<string, string>;
  examples?: { cmd: string; shows: string }[];
  seeAlso?: string[];
  subcommands?: Record<string, HelpCommandEntry>;
}

/** commands.json's `global`: the flags every command takes (a command entry without usage). */
export interface HelpGlobal extends Partial<HelpCommandEntry> {
  summary: string;
  flags: HelpFlag[];
}

/** One config key in settings.json. */
export interface HelpSetting {
  file: string;
  meaning: string;
  /** Usually a list; two keys write it as one string (`none | git-email`). */
  values?: string[] | string;
  default?: string;
  operation?: string;
  flag?: string;
  env?: string;
}

/** What `helpSource` returns. */
export interface HelpSource {
  global: HelpGlobal;
  commands: Record<string, HelpCommandEntry>;
  settings: Record<string, HelpSetting>;
  /** Topic name → its Markdown. */
  topics: Record<string, string>;
}

/** What `lookup` returns. */
export type HelpFound =
  | {
      kind: 'command';
      name: string;
      entry: HelpCommandEntry;
      parent?: HelpCommandEntry | null;
      topic?: string;
    }
  | { kind: 'topic'; name: string; topic: string; entry?: undefined; parent?: undefined }
  | { kind: 'setting'; name: string; entry: HelpSetting; topic?: undefined; parent?: undefined };

// --- MCP (mcp.mjs, mcp-call.mjs; docs/mcp.md) ----------------------------------------------------

/** A JSON-RPC 2.0 error object. */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * A reply from pxsig's MCP server, as mcp-call reads it: `result` on success, `error` otherwise. The
 * caller names the result's shape for the method it called.
 */
export interface RpcReply<R> {
  jsonrpc?: '2.0';
  id: number;
  result: R;
  error?: RpcError;
}

/** One content item of a tool result. */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** A `tools/call` result. */
export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

/** A `tools/list` result, as far as mcp-call prints it. */
export interface McpToolsList {
  tools: { name: string; description: string }[];
}

// --- setup (setup.mjs) ---------------------------------------------------------------------------

/** A file `pxsig setup` prints and may create. */
export interface SetupFile {
  role: 'mcp' | 'instructions';
  file: string;
  scope: 'project' | 'user';
  lang: string;
  text: string;
  /**
   * `absent`, `written`, `declined`, `exists: add the block by hand` or `home folder: add by hand`:
   * set for every file before it is read.
   */
  state: string;
}

// --- init, manifest, migrate (lib/setup.mjs) -----------------------------------------------------

/** The keys of a project's `pxsig.config.json` `initProject` writes and reads back. */
export interface InitConfig {
  version?: number;
  name?: string;
  label?: string;
  srcRoot?: string;
  storybook?: { url?: string; configDir?: string };
  store?: { dir?: string; layout?: string };
}

/** What `buildManifest` returns. */
export interface BuiltManifest {
  manifest: Manifest & { project: string; suite?: string; skipped: ManifestSkipped[] };
  /** Absolute path of the manifest file. */
  path: string;
  added: string[];
  removed: string[];
  skipped: ManifestSkipped[];
}

/** What `describeConfig` returns (`pxsig config`). */
export interface DescribedConfig {
  sources: Project['configSources'];
  project: string;
  label: string | null;
  workspace: string;
  workspaceFile: string | null;
  configFile: string;
  root: string;
  srcRoot: string;
  storybook: Project['storybook'];
  store: Project['store'];
  modes: Project['modes'];
  defaultMode: string;
  modesByDefault: string[];
  affects: string[];
  rustBin: string;
  config: Project['config'];
  /** `pxsig config` adds warn mode, when the config sets it. */
  enforcement?: unknown;
}

/** A pre-0.2 manifest under the legacy folder's `js/`: entries as the old pxsig wrote them. */
export interface LegacyManifest {
  stories?: ManifestEntry[];
  skipped?: ManifestSkipped[];
}

/** One baseline `pxsig pack` moves (the plan file the engine reads). */
export interface MigratePack {
  /** The legacy baseline. */
  sig: string;
  /** The new `.psig`. */
  out: string;
  image: string | null;
  entry: { id: string; story: string | null; mode: string | null; state: string | null };
}

/** One manifest a migration writes. */
export interface MigrateManifest {
  suite: string | null;
  from: string;
  to: string;
  entries: number;
  manifest: {
    version: number;
    project: string;
    suite?: string;
    stories: ManifestEntry[];
    skipped: ManifestSkipped[];
  };
}

/** `verifyMigration`'s result for one manifest. */
export interface MigrateVerify {
  suite: string | null;
  entries: number;
  passOld: number;
  passNew: number;
  differ: number;
  sample: string[];
}

/** The engine's check result for one entry, as `verifyMigration` compares it. */
export type EngineVerdict = EngineResult & { id: string; metrics?: unknown; detail?: unknown };

/** What `migrateLegacy` returns (`pxsig migrate`). */
export interface MigratePlan {
  from: string;
  to: string;
  manifests: MigrateManifest[];
  pack: MigratePack[];
  copies: { from: string; to: string }[];
  problems: string[];
  summary: {
    manifests: string[];
    baselines: number;
    withImage: number;
    copies: number;
    approvals: boolean;
    problems: number;
  };
  /** The engine's `pack --json` summary (with `apply`). */
  packed?: unknown;
  gitattributes?: string | null;
  verify?: MigrateVerify[];
}

// --- reports the MCP and the CLI read (docs/spec.md section 7) -----------------------------------

/** The engine's metrics for one entry (docs/spec.md section 4; crates/pxsig-cli batch.rs). */
export interface EngineMetrics {
  ssim: number;
  matchScore?: number;
  colorDiffPct?: number;
  edgeDiffPct?: number;
  maxCellDiff?: number;
  changedCells?: number;
  changedCellsPct: number;
  psnr?: number | 'inf';
  ahashHamming?: number;
  dhashHamming?: number;
  identical?: boolean;
  grid?: number;
  threshold?: number;
}

/** One changed region of the pixel diff. */
export interface PixelRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
}

/** A row's `pixels`: the engine's pixel diff against the baseline image. */
export interface PixelDiff {
  width: number;
  height: number;
  changed: number;
  maxDelta?: number;
  tolerance?: number;
  /** The first 20 regions. */
  regions?: PixelRegion[];
  regionCount: number;
}

/** A check.json row with the engine's result keys typed. */
export interface ReportRow extends CheckRow {
  metrics?: EngineMetrics | null;
  detail?: { changedTiles?: number; newEdgeTiles?: number; [key: string]: unknown } | null;
  pixels?: PixelDiff | null;
}

/** `<store>/reports/check.json` (or `check-<suite>.json`), as pxsig wrote it. */
export interface CheckReport {
  generatedAt: string;
  project?: string;
  suite?: string | null;
  summary?: Partial<CheckSummary> & Partial<EnvSummary>;
  /** Env id → the environment. */
  envs?: Record<string, EnvRecord>;
  rows: ReportRow[];
}

/** `review.json` / `a11y-review.json`: entry id → the decision since its last check. */
export type ReviewFile = Record<string, { state?: string; [key: string]: unknown } | undefined>;

/** One line of `<store>/reports/history.ndjson`, as the engine appends it (batch.rs). */
export interface HistoryLine {
  at: string;
  summary?: { stories?: number; failed?: number; [key: string]: unknown };
  /** Entry id → `[pass (1 or 0), ssim, changedCells, detail tiles]`. */
  rows?: Record<string, [number, number | null, number | null, number]>;
  /** Warn mode: the gates of the run. */
  enforcement?: unknown;
  wouldFail?: boolean;
}

/** One path the selection cannot trace (`failSafe`). */
export interface FailSafe {
  path: string;
  class: string;
  why: string;
}

/** One unresolved import (`unresolved`). */
export interface UnresolvedImport {
  file: string;
  spec: string;
  line: number;
  why: string;
  accepted: boolean;
  selects: 'none' | 'all' | 'entries';
  /** With `selects: entries`: how many. */
  n?: number;
}

/** The engine's `affected --json` (crates/pxsig-cli affected.rs). */
export interface AffectedResult {
  all: boolean;
  reason: string;
  changed: string[];
  ids: string[];
  traced: string[];
  storyFiles?: string[];
  graphFiles?: number;
  mergeBase?: string | null;
  warnings?: string[];
  files?: Record<string, unknown>[];
  baselines?: string[];
  records?: Record<string, string[]>;
  removed?: string[];
  failSafe?: FailSafe[];
  ignored?: string[];
  otherSuites?: Record<string, number>;
  unresolved?: UnresolvedImport[];
  remote?: unknown[];
}

/** `GET /__pxsig/status`, as far as the MCP reads it (docs/server.md). */
export interface ServerStatusReply {
  running?: boolean;
  queued?: number;
  dashboard?: string;
}

/** `POST /__pxsig/check`'s answer. */
export interface ServerCheckReply {
  queued?: string[];
  registered?: string[];
  skipped?: { name: string; why: string }[];
}

// --- MCP tools' arguments (docs/mcp.md, "Tools"; each tool's inputSchema) ------------------------

/** Every tool's optional project. */
export interface ProjectArg {
  project?: string;
}

/** `pxsig_list`. */
export interface ListArgs extends ProjectArg {
  state?: string;
  component?: string;
  mode?: string;
  limit?: number;
}

/** The images `pxsig_entry` and `imageOf` know. */
export type ImageKind = 'baseline' | 'current' | 'diff';

/** `pxsig_entry`. */
export interface EntryArgs extends ProjectArg {
  id: string;
  images?: readonly ImageKind[];
}

/** `pxsig_a11y`. */
export interface A11yArgs extends ProjectArg {
  only_new?: boolean;
  component?: string;
  limit?: number;
  prune_plan?: boolean;
  mode?: string;
  ids?: string[];
}

/** `pxsig_affected`. */
export interface AffectedArgs extends ProjectArg {
  files?: string[];
  since?: string;
}

/** `pxsig_stale`. */
export interface StaleArgs extends ProjectArg {
  limit?: number;
  max_files?: number;
}

/** `pxsig_check`. */
export interface CheckArgs extends ProjectArg {
  ids?: string[];
  stories?: string[];
  changed_files?: string[];
  since?: string;
  all?: boolean;
  timeout_s?: number;
}

/** `pxsig_review`. */
export interface ReviewArgs extends ProjectArg {
  action: string;
  ids: string[];
  confirm: boolean;
}

/** `pxsig_doctor`. */
export interface DoctorArgs extends ProjectArg {
  component?: string;
  status?: string;
  limit?: number;
  repair?: 'none' | 'plan' | 'apply';
  only?: string[];
  offline?: boolean;
  stale?: boolean;
}

/** `doctor()`: the tool's arguments, plus what the CLI adds. */
export interface DoctorOptions extends DoctorArgs {
  via?: string;
  confirmPrune?: ((n: number) => Promise<boolean>) | null;
  /** `n`: the torn lines' count, when the plan has it (lib/repair.mjs). */
  confirmTorn?: ((n: number | undefined) => Promise<boolean>) | null;
  prune?: boolean;
}

/** `pxsig_history`. */
export interface HistoryArgs extends ProjectArg {
  limit?: number;
}

/** `pxsig_help`. */
export interface HelpArgs {
  name?: string;
}

/** `prunePlan()` (`pxsig a11y --prune`, `pxsig_a11y { prune_plan }`). */
export interface PrunePlanOptions extends ProjectArg {
  component?: string;
  mode?: string;
  only?: string[];
  cmd?: string;
  maxFiles?: number;
}

/** A JSON-RPC request or notification, as `handle` reads it. */
export interface RpcRequest {
  id?: number | string | null;
  method?: string;
  params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> };
}

// --- the tools, by name (for the CLI, which runs them in-process) --------------------------------

/** One of mcp.mjs's tools. */
export type McpTool = (typeof tools)[number];

/** A tool's name without `pxsig_`. */
export type ToolName = McpTool['name'] extends `pxsig_${infer N}` ? N : never;

/** The tool `pxsig_<N>`. */
export type ToolNamed<N extends ToolName> = Extract<McpTool, { name: `pxsig_${N}` }>;

/** What `pxsig_<N>` takes. */
export type ToolInput<N extends ToolName> = Parameters<ToolNamed<N>['run']>[0];

/** What `pxsig_<N>` resolves with. */
export type ToolOutput<N extends ToolName> = Awaited<ReturnType<ToolNamed<N>['run']>>;

// --- the CLI (cli.mjs) ---------------------------------------------------------------------------

/** What one gate would fail on (lib/enforcement.mjs `outcome`'s input; as types/t2.d.ts). */
export interface Finding {
  gate: string | null;
  exit: number;
  count: number;
  what: string;
}

/** What a read command's renderer returns, per project (`overProjects`). */
export interface Rendered {
  blocks: Block[];
  data: object;
  exit?: number;
  /** The exit is warn mode's advisory one. */
  advisory?: boolean;
}

/** One entry as `pxsig_list` and `pxsig_check` list it (mcp.mjs `brief`). */
export interface BriefEntry {
  id: string;
  state: string;
  mode?: string;
  /** The interaction state. */
  interaction?: string;
  ssim?: number;
  changedCellsPct?: number;
  changedPx?: number;
  regions?: number;
  reasons?: string[];
  error?: string;
  a11yNew?: number;
}

/** An error a command fails with: some carry the exit code (2: usage or setup) or an HTTP status. */
export type CliError = Error & { exit?: number; status?: number };

/** What mcp.mjs's `doctor` resolves with (`pxsig doctor`, `pxsig_doctor`). */
export type DoctorResult = Awaited<ReturnType<(typeof import('../tools/doctor.mjs'))['doctor']>>;

/** The JSON text `pxsig_entry` answers first: the entry in full (mcp.mjs). */
export interface EntryDetail extends BriefEntry {
  story?: string;
  browser?: string;
  metrics?: EngineMetrics | null;
  detail?: ReportRow['detail'];
  pixels?: PixelDiff | null;
  a11y?: ReportRow['a11y'];
  review: ReviewFile[string] | null;
  env: string | null;
  baselineEnv: string | null;
  envMatch: string;
  envDiff: string[] | null;
  envFonts?: string[];
  checkedAt: string | null;
  renderedAt: string | null;
  diffPage: string;
}

/** What `pxsig_check` answers (each case sets some of these). */
export interface CheckToolResult {
  checked?: number;
  note?: string;
  timedOut?: boolean;
  /** With `timedOut`: how many were queued. */
  queued?: number;
  /** New entries the server registered first. */
  registered?: string[];
  /** Names that could not be checked, and why. */
  skipped?: { name: string; why: string }[];
  via?: string;
  seconds?: number;
  counts?: Record<string, number>;
  problems?: BriefEntry[];
  a11yNew?: number;
  enforcement?: Record<string, unknown>;
  wouldFail?: boolean;
  /** Without the server: the last lines of the check's output. */
  log?: string;
}

/** A value read out of a config (JSON): `pxsig config` prints it. */
export type ConfigValue = string | number | boolean | object | null | undefined;
