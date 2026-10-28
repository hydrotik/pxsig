/**
 * types/t2.d.ts — the shapes of lib/term.mjs, lib/approvals.mjs, approve.mjs, lib/prune.mjs and
 * lib/enforcement.mjs, for their JSDoc (`checkJs`) and `oxlint --type-aware`. Types only: nothing
 * here runs. The file formats (approval log, a11y.json, prune log) are specified in docs/spec.md; a
 * shape here follows that document.
 */

// --- term (lib/term.mjs) -------------------------------------------------------------------------

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

/** What `progress` returns. */
export interface Progress {
  update: (text: string) => void;
  done: (msg?: string | null, ok?: boolean) => void;
}

/** Who is at the terminal: the defaults are this process's. */
export interface TerminalOptions {
  e?: NodeJS.ProcessEnv;
  stdin?: boolean;
  stdout?: boolean;
}

// --- approvals (lib/approvals.mjs; docs/spec.md, the approval log) -------------------------------

/** The project keys the approval log's paths come from. */
export type ApprovalProject = Pick<import('../types.js').Project, 'store' | 'workspaceRoot'>;

/** What an approval's paths are worked out from: a manifest entry's id and baseline path. */
export interface EntryPaths {
  id: string;
  /** Baseline path, relative to the workspace root. */
  sig: string;
}

/** `record`'s options. */
export interface RecordOptions {
  batch: string;
  via: string;
  reason?: string | null;
  /** sha256 of the baseline before (`snapshot`); null for a first baseline. */
  before?: string | null;
  kind?: string | null;
  /** A person's decision (no `agent`); by default, when `via` is `dashboard` or `cli`. */
  person?: boolean;
}

/** An entry `undo` would not restore, and why. */
export interface Refusal {
  id: string;
  why: string;
}

/** What `undo` returns. */
export interface UndoResult {
  restored: string[];
  removed: string[];
  refused: Refusal[];
  source: 'history' | 'git';
}

/** A baseline the last logged approval does not explain (`verify`). */
export interface Mismatch {
  id: string;
  /** The first 12 hex of the logged and the current sha256. */
  logged: string | undefined;
  now: string | undefined;
  /** The pxsig that wrote the line (null: before 0.4.0). */
  writtenBy: string | null;
  older: boolean;
}

/** A baseline an approval wrote before a crash cut its log line short (`verify`). */
export interface Interrupted {
  id: string;
  batch: string;
  logged: string | undefined;
  now: string | undefined;
  writtenBy: string | null;
}

/** What `verify` returns. */
export interface VerifyResult {
  logged: number;
  untracked: number;
  untrackedSample: string[];
  untrackedIds: string[];
  mismatched: Mismatch[];
  interrupted: Interrupted[];
  torn: number;
}

/** What `mergeBase` returns. */
export type MergeBase =
  | { error: string; base?: undefined; why?: undefined }
  | { base: string; error?: undefined; why?: undefined }
  | { base: null; why: string; error?: undefined };

/** What `appendedSince` returns. */
export interface Appended {
  rewritten: boolean;
  lines: import('../types.js').ApprovalLine[];
}

/** How an approval was made, for the PR summary. */
export type Route = 'dashboard' | 'terminal' | 'mcp' | 'other';

/** What `changedByRoute` returns. */
export type RouteCounts = { total: number; agents: Record<string, number> } & Record<Route, number>;

/** One row of `traceLog`: a log line, the commit that added it and the pull request that merged it. */
export interface TraceRow {
  line: number;
  id: string;
  batch: string;
  at: string;
  via: string;
  commit: string | null;
  pr: number | null;
}

// --- enforcement (lib/enforcement.mjs; docs/configuration.md#enforcement) -----------------------

/** A gate warn mode can be set for. */
export type GateName = 'visual' | 'a11y' | 'verify' | 'env' | 'doctor' | 'stale';

/** A gate's setting for a run: `off` is the a11y gate's only. */
export type GateSetting = 'enforce' | 'warn' | 'off';

/** What `resolveEnforcement` reads of a project (tests pass a stand-in with only this). */
export interface EnforcementProject {
  config?: Pick<import('../types.js').Config, 'enforcement'> | null;
  /** Which layer set each config key (dotted path → layer name). */
  configSources?: Record<string, string>;
}

/** `resolveEnforcement`'s options: the defaults are this process's. */
export interface EnforcementOptions {
  flags?: import('../types.js').Flags;
  env?: NodeJS.ProcessEnv;
  /** A person at a terminal (`humanAtTerminal`). */
  human?: () => boolean;
  /** Why not (`whyNotPerson`). */
  why?: () => string | null;
  now?: Date;
}

/** What `resolveEnforcement` returns: each gate's setting for this run, and why. */
export interface Enforcement {
  /** Gate → its setting. */
  gates: Record<string, GateSetting>;
  /** Gate → the layer that decided it (`project config`, `built-in`, `--warn`, …). */
  layers: Record<string, string>;
  /** The config has an `enforcement` key. */
  present: boolean;
  warnUntil: string | null;
  noticeDays: number;
  advisoryExit: number;
  daysLeft: number | null;
  daysSince: number | null;
  /** Gates `warnUntil` returned to enforce. */
  expired: string[];
  /** Gates on warn because reviewed config (or a person's --warn) said so. */
  configured: string[];
  /** Gates on warn by the built-in default only (the a11y gate). */
  quiet: string[];
  ending: boolean;
}

/** What one gate would fail on (`outcome`'s input): `gate: null` is a failure no setting can warn. */
export interface Finding {
  gate: string | null;
  exit: number;
  count: number;
  what: string;
}

/** A finding as `outcome` reports it. */
export type FindingSummary = Pick<Finding, 'gate' | 'count' | 'what'>;

/** What `outcome` returns: the run's exit, and what warn mode changed. */
export interface Outcome {
  exit: number;
  wouldExit: number;
  wouldFail: boolean;
  advisory: boolean;
  reasons: FindingSummary[];
  enforcedFailures: FindingSummary[];
  warnedFailing: string[];
  ran: string[];
}

/** The `enforcement` key of `check.json` (`reportBlock`). */
export interface EnforcementReport {
  gates: Record<string, GateSetting>;
  layers: Record<string, string>;
  warnUntil: string | null;
  daysLeft?: number | null;
  expired?: string[];
  configured: string[];
  wouldFail: boolean;
  wouldExit: number;
  exit: number;
  reasons: FindingSummary[];
  contexts: { enforce: string[]; advisory: string[] };
}

/** One line of `<stateDir>/readiness.ndjson` (`appendReadiness`). */
export interface ReadinessLine {
  at: string;
  project: string;
  suite: string | null;
  sha: string | null;
  branch: string | null;
  gates: string[];
  wouldFail: boolean;
  wouldExit: number;
  counts: Record<string, number>;
  source: string | undefined;
}

/** What `readinessTally` returns. */
export interface ReadinessTally {
  runs: number;
  wouldFail: number;
  /** The same on the default branch, when it has lines. */
  main?: { branch: string; runs: number; wouldFail: number };
  last: ReadinessLine | null;
}

/** The part of a tally the lines read. */
export type TallyCounts = Pick<ReadinessTally, 'runs' | 'wouldFail' | 'main'>;

// --- prune (lib/prune.mjs; docs/spec.md, a11y.json and a11y-decisions.ndjson) --------------------

/** How `classify` sorts an accepted rule. */
export type PruneClass = 'prunable' | 'still-fires' | 'stale' | 'not-covered';

/** A check report as `classify` reads it: check.json (suite null) or a check-<suite>.json. */
export interface PruneReportRef {
  suite: string | null;
  /** Absolute path (`readReports`). */
  path?: string;
  /** Workspace-relative path, for the plan's evidence. */
  file: string;
  check: { rows: import('../types.js').CheckRow[]; generatedAt?: string };
}

/** A report `readReports` found: with its absolute path. */
export type PruneReport = PruneReportRef & { path: string };

/** What the `stale` callback says of one report's rows. */
export interface PruneStale {
  /** Entry id → what changed after its row was checked. */
  ids: Map<string, string>;
  /** Staleness could not be traced: why (every row of the report counts as stale). */
  unknown: string | null;
}

/** A line `latestBy` reads: an approval-log or a11y-decisions line, as read. */
export type TimedLine = { id?: unknown; at?: unknown; action?: unknown } | null | undefined;

/** `classify`'s input: `stale` is called with the reports it is given. */
export interface ClassifyOptions<R extends PruneReportRef = PruneReportRef> {
  /** a11y.json: entry id → the accepted rule ids. */
  accepted: Record<string, string[]>;
  reports: readonly R[];
  /** Entry id → the time of its last accessibility decision, in ms. */
  decided: Map<string, number>;
  /** Entry id → the time of its last approval, in ms. */
  approved: Map<string, number>;
  stale: (report: R) => PruneStale;
  modeOf?: (id: string) => string | null | undefined;
  only?: string[] | null;
  component?: string | null;
  mode?: string | null;
}

/** The evidence of a classified rule: the row it was judged on. */
export interface PruneEvidence {
  report?: string;
  checkedAt?: string | null;
  suite?: string | null;
}

/** One accepted rule, classified. */
export interface PruneItem extends PruneEvidence {
  id: string;
  rule: string;
  class: PruneClass;
  why: string;
  mode: string | null;
}

/** A command that would decide the rules that are not prunable. */
export interface CoverCommand {
  class: string;
  entries: number;
  command: string;
}

/** One entry of a prune plan: its accepted list before and after. */
export interface PruneEntry {
  id: string;
  before: string[];
  rules: string[];
  evidence: { report?: string; checkedAt?: string | null };
  after: string[];
}

/** What `buildPlan` returns (`a11y-prune-plan.json`). */
export interface PrunePlan {
  version: 1;
  createdAt: string;
  project: string;
  a11y: string;
  a11ySha: string | null;
  reports: { file: string; suite: string | null; rows: number }[];
  counts: Record<string, number>;
  entries: number;
  prune: PruneEntry[];
  items: PruneItem[];
  cover: CoverCommand[];
}

/** `buildPlan`'s options. */
export type BuildPlanOptions = Pick<
  ClassifyOptions<PruneReport>,
  'stale' | 'only' | 'component' | 'mode'
> & {
  modeOf: NonNullable<ClassifyOptions['modeOf']>;
  cmd?: string;
};

/** A plan as `checkPlan` and `applyPrune` receive it: any keys, checked by `checkPlan`. */
export interface PlanInput {
  /** sha256 of a11y.json at planning (null: none); `checkPlan` refuses anything else. */
  a11ySha?: string | null;
  prune?: unknown;
}

/** An entry of a plan `checkPlan` passed. */
export interface CheckedPruneEntry {
  id: string;
  rules: string[];
  evidence?: { report?: string | null; checkedAt?: string | null } | null;
}

/** `applyPrune`'s options. */
export interface ApplyPruneOptions {
  batch?: string;
  reason?: string | null;
  via?: string;
  /** Runs before the writes: throws when the lock was taken over. */
  lockCheck?: () => void;
}

/** One `action: "prune"` line of a11y-decisions.ndjson, before `stamp`. */
export interface PruneLine {
  at: string;
  by: string | null;
  via: string;
  action: 'prune';
  id: string;
  before: string[];
  after: string[];
  rules: string[];
  batch: string | undefined;
  reason: string | null;
  evidence: { report: string | null; checkedAt: string | null };
}

/** What `applyPrune` returns. */
export interface PruneResult {
  batch: string | undefined;
  entries: number;
  rules: number;
  lines: PruneLine[];
}
