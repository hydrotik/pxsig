/**
 * types/t3.d.ts — the shapes of the integrity ledger (lib/integrity.mjs) and its repairs
 * (lib/repair.mjs). Types only: nothing here runs. docs/integrity.md is the source of truth.
 */
import type {
  CheckRow,
  CheckSummary,
  EnvSummary,
  IndexStory,
  Manifest,
  StoryIndex,
  StoryParameters,
} from '../types.js';

// --- codes ---------------------------------------------------------------------------------------

export type Severity = 'error' | 'warn' | 'info';

/** The per-entry status codes (`CODES`; docs/integrity.md, "Status codes"). */
export type IntegrityCode =
  | 'unregistered'
  | 'render-error'
  | 'never-checked'
  | 'missing-baseline-image'
  | 'legacy-format'
  | 'unbaselined'
  | 'missing-render'
  | 'orphaned'
  | 'changed'
  | 'flaky'
  | 'stale'
  | 'a11y-new'
  | 'skipped-unaffected'
  | 'drift'
  | 'excluded'
  | 'ok';

/** One row of `CODES`. */
export interface CodeInfo {
  severity: Severity;
  /** Orders codes within a severity when picking an entry's primary status. */
  rank: number;
  title: string;
  help: string;
}

/** `config.integrity` over `DEFAULT_INTEGRITY`. */
export interface IntegritySettings {
  requireBaselineImages: boolean;
  staleAfterSourceChange: boolean;
  sourceRoots: string[] | null;
  maxTracedFiles: number;
  /** Per-code (and per setup code) severity overrides. */
  severity: Record<string, Severity>;
  indexTimeoutMs: number;
  renderSkewMs: number;
  manifests?: string[];
}

// --- the story index -----------------------------------------------------------------------------

/** One entry of Storybook's `index.json` (v4/v5), as far as it is read. */
export interface StorybookIndexEntry {
  type?: string;
  id: string;
  title: string;
  name: string;
  importPath: string;
  tags?: string[];
}

/** Storybook's `index.json`, before it is known to be one. */
export interface StorybookIndexJson {
  v?: unknown;
  entries?: unknown;
}

/** What `fetchStoryIndex` returns. */
export type FetchedIndex =
  | { url: string; reachable: false; healthy: false; error: string }
  | { url: string; reachable: true; healthy: false; status: number; error: string }
  | { url: string; reachable: true; healthy: true; version: unknown; stories: IndexStory[] };

/** The part of `fetch` `fetchStoryIndex` uses (tests pass a stand-in). */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// --- what the reconciler reads -------------------------------------------------------------------

/** A manifest as the reconciler reads it (an older one may carry `defaultMode`). */
export type IntegrityManifest = Manifest & { defaultMode?: string | null };

/** A check.json row, with the keys the reconciler reads beyond the shared ones. */
export type IntegrityRow = CheckRow & {
  /** A partial check carried this row forward from an earlier run. */
  inherited?: boolean;
  /** A partial check left it out: no edit can change it. */
  unaffected?: boolean;
  retry?: { attempt?: number; metrics?: unknown };
  /** The engine's metrics (docs/spec.md section 4); null on a carried or skipped row. */
  metrics?: { ssim: number; identical?: boolean; [metric: string]: unknown } | null;
};

/** `<store>/reports/check.json`, as far as the reconciler reads it. */
export interface IntegrityReport {
  rows: IntegrityRow[];
  generatedAt?: string;
  fullCheckAt?: string | null;
  affected?: { reason?: string } | null;
  summary?: Partial<CheckSummary> & Partial<EnvSummary>;
}

/** `<store>/reports/review.json`: entry id → its review decision. */
export type ReviewFile = Record<string, { state?: string } | undefined>;

/** A source file edited after a verdict. */
export interface EditedFile {
  /** Workspace-relative. */
  file: string;
  mtime: number;
}

/** `affected(file)` → the entry ids the file feeds. */
export type Tracer = (file: string) => Promise<string[]>;

/** One answer line of `pxsig serve` (the engine's JSON-lines protocol). */
export interface ServeAnswer {
  id: number;
  error?: string;
  result: { traced?: string[]; ids?: string[] };
}

/** What `rustAffected` returns. */
export interface RustAffected {
  affected: Tracer;
  close: () => void;
}

/** `reconcile` options. */
export interface ReconcileOptions {
  /** A `loadStoryIndex()` result (else fetched or scanned). */
  index?: StoryIndex;
  /** Do not fetch the Storybook index. */
  offline?: boolean;
  fetchImpl?: FetchLike;
  affected?: Tracer | null;
  /** Clock override, for tests. */
  now?: number;
}

// --- the ledger (docs/integrity.md, "The ledger") ------------------------------------------------

/** One issue of an entry. */
export interface Issue extends IssueExtra {
  code: IntegrityCode;
  severity: Severity;
  reason: string;
}

/** The keys some codes add to an issue. */
export interface IssueExtra {
  hint?: string;
  recoverable?: string;
  fallback?: string | null;
  file?: string;
  orphanFiles?: string[];
}

/** What is on disk for a manifest entry. */
export interface EntryFiles {
  sig: string;
  sigExists: boolean;
  baseImage: boolean;
  latestRender: boolean;
  diff: boolean;
  reconstructedBaseline: boolean;
}

/** An entry's last verdict, from check.json. */
export interface EntryVerdict {
  pass: boolean | null;
  flaky: boolean;
  error: string | null;
  skipped: boolean;
  ssim: number | null;
  checkedAt: string | null;
}

/** One row of the ledger's `entries`: a manifest entry, an unregistered story or an orphan. */
export interface LedgerEntry {
  id: string;
  story: string;
  component: string;
  mode: string | null;
  state: string | null;
  status: IntegrityCode;
  severity: Severity;
  issues: Issue[];
  /** Null for an unregistered story or an orphan. */
  files: EntryFiles | null;
  verdict: EntryVerdict | null;
  renderedAt: string | null;
  review: string | null;
  approval: { at: string; by?: string | null; via: string; batch: string } | null;
  a11y: { enabled: boolean; baselined: boolean; new: number } | null;
  /** An unregistered story's file, title and name. */
  importPath?: string;
  title?: string;
  name?: string;
  /** An orphan's files. */
  orphanFiles?: string[];
}

/** A ledger entry for a manifest entry: one with `files`. */
export type ManifestLedgerEntry = LedgerEntry & { files: EntryFiles };

/** One row of the ledger's `components`. */
export interface LedgerComponent {
  component: string;
  status: IntegrityCode;
  severity: Severity;
  entries: number;
  stories: number;
  counts: Partial<Record<IntegrityCode, number>>;
}

/** A setup problem in the ledger's `setup` (docs/integrity.md, "Setup problems"). */
export interface LedgerSetup {
  code: string;
  severity: Severity;
  reason: string;
  count?: number;
}

/** The ledger's `summary`. */
export interface LedgerSummary {
  status: 'attention' | 'warnings' | 'clean';
  headline: string;
  entries: number;
  components: number;
  componentsBySeverity: Record<Severity, number>;
  bySeverity: Record<Severity, number>;
  infoFindings: number;
  byStatus: Partial<Record<IntegrityCode, number>>;
  byCode: Partial<Record<IntegrityCode, number>>;
}

/** How staleness was decided. */
export interface Staleness {
  method: 'off' | 'none-edited' | 'import-graph' | 'folder';
  filesTraced: number;
}

/** The ledger's `sources`: what was read. */
export interface LedgerSources {
  storyIndex: {
    source: StoryIndex['source'];
    stories: number;
    inScope: number;
  } & StoryIndex['storybook'];
  manifest: {
    path: string;
    entries: number;
    skipped: number;
    updatedAt: string | null;
    siblings: string[];
  };
  config: {
    path: string;
    srcRoot: string;
    pixelsRoot: string | null;
    nonVisual: string[];
    integrity: { requireBaselineImages: boolean; staleAfterSourceChange: boolean };
  };
  /** check.json: its time and row count, or `missing`. */
  report: { path: string; generatedAt?: string; rows?: number; missing?: true };
  renders: { base: number; latest: number; diffs: number; reconstructed: number };
  signatures: number;
  approvals: { path: string; lines: number; entries: number };
  review: { decisions: number };
  a11yBaseline: { path: string; entries: number | null };
  staleness: Staleness;
}

/** `<store>/reports/integrity.json`. */
export interface Ledger {
  schemaVersion: number;
  generatedAt: string | null;
  tool: { name: string; component: string };
  sources: LedgerSources;
  setup: LedgerSetup[];
  summary: LedgerSummary;
  components: LedgerComponent[];
  entries: LedgerEntry[];
  elapsedMs: number;
}

/** `filterLedger`'s view. */
export interface LedgerFilter {
  component?: string | null;
  status?: string | null;
  severity?: Severity | null;
}

// --- repairs (lib/repair.mjs; docs/integrity.md, "Repairs") ---------------------------------------

export type RepairAction =
  | 'register'
  | 'recheck'
  | 'restore-baseline-image'
  | 'convert-legacy'
  | 'prune'
  | 'log-torn';

/** One step of a repair plan. */
export interface RepairStep {
  action: RepairAction;
  ids: string[];
  why: string;
  /** Why it cannot run here; null: it can. */
  blocked: string | null;
  /** register: render what it adds in the re-check step. */
  recheckAfter?: boolean;
  /** prune, log-torn: only a person at a terminal runs it. */
  needsPerson?: boolean;
  /** log-torn: how many lines. */
  count?: number;
}

/** A code with no safe repair, under "Needs a person". */
export interface ManualItem {
  code: string;
  count: number | undefined;
  what: string;
  sample: string[];
}

/** What `planRepairs` returns. */
export interface RepairPlan {
  schemaVersion: number;
  generatedAt: string;
  basedOn: string | null;
  steps: RepairStep[];
  manual: ManualItem[];
}

/** What `serverStatus` returns. */
/** `serverStatus`: `foreign` says why a server that answered counts as down (another workspace's). */
export type ServerStatus =
  | { up: true; running: boolean; queued: number }
  | { up: false; foreign?: string };

/** `planRepairs` options. */
export interface PlanOptions {
  only?: readonly string[] | null;
  prune?: boolean;
  server?: { up?: boolean } | null;
  stale?: boolean;
}

/** What a re-check hook returns. */
export interface RecheckResult {
  via: string;
  error?: string;
}

/** What `applyRepairs` calls out to. */
export interface RepairHooks {
  recheck: (ids: string[]) => Promise<RecheckResult>;
  harvest: Harvest;
  confirmPrune?: ((n: number) => boolean | Promise<boolean>) | null;
  confirmTorn?: ((n: number | undefined) => boolean | Promise<boolean>) | null;
}

/** Reads `parameters.pxsig` of stories from a running Storybook. */
export type Harvest = (ids: string[]) => Promise<Record<string, StoryParameters>>;

/** Who and through what a repair runs, for its log. */
export interface RepairActor {
  by?: string | null;
  via: string;
}

/** A line of `<store>/reports/repairs.ndjson`, before `logRepair` stamps it. */
export type RepairLogLine = RepairActor & { action: string; [key: string]: unknown };

/** What `registerNamed` reads of a `loadStoryIndex()` result. */
export interface NamedIndex {
  source: string;
  storybook?: { error?: string };
  stories?: IndexStory[];
}

/** A story `registerStories` adds. */
export interface StoryToRegister {
  id: string;
  importPath: string;
}

/** What `registerStories` returns. */
export interface RegisterResult {
  added: string[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; why: string }[];
  adoptedSignatures: string[];
  /** The manifest copy kept before the write, workspace-relative. */
  backup?: string;
}

/** One row of the engine's `check --json` output, as far as `gateLatest` reads it. */
export interface GateRow {
  id: string;
  pass?: boolean;
  metrics?: { ssim?: number; identical?: boolean } | null;
  reasons?: string[];
  error?: string | null;
}

/** One entry's result in `gateLatest`. */
export interface GateResult {
  pass: boolean;
  metrics: { ssim?: number; identical?: boolean } | null;
  reasons: string[];
  error: string | null;
  /** The signature reconstruction the check wrote, in the scratch folder. */
  reconstructed: string | null;
}

/** `gate.get(id)`, or the stand-in for an entry the engine did not answer for. */
export type GateOutcome =
  | GateResult
  | {
      pass: false;
      error: string;
      metrics?: undefined;
      reasons?: undefined;
      reconstructed?: undefined;
    };

/** One entry's result in `restoreBaselineImages` / `convertLegacy`. */
export interface EntryRepairResult {
  id: string;
  result: string;
  why: string | undefined;
  gate?: { pass: boolean; ssim: number | null; identical?: boolean | null };
  sha256?: string | null;
  fallback?: string | null;
  to?: string;
  trash?: string;
}

/** What `pruneOrphans` returns. */
export interface PruneResult {
  trash: string;
  moved: { id: string; from: string; to: string }[];
  droppedEntries: string[];
}

/** `applyRepairs` options. */
export interface ApplyOptions {
  /** Each step calls only its own hooks: a plan without a register step needs no `harvest`; none confirms nothing. */
  hooks?: Partial<RepairHooks>;
  via?: string;
  by?: string | null;
  reconcileOpts?: ReconcileOptions;
}

/** One done step in `applyRepairs`' result. */
export type DoneStep = { action: RepairAction; result: string; [key: string]: unknown };
