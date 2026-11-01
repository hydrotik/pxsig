/** The report data's shape (data.ts re-exports every type), from the server or a static report. */
export interface Metrics {
  ssim: number;
  changedCells: number;
  changedCellsPct: number;
  maxCellDiff: number;
  colorDiffPct: number;
  edgeDiffPct: number;
  psnr: number | 'inf';
  ahashHamming: number;
  dhashHamming: number;
  identical: boolean;
  grid: number;
  threshold: number;
}
export interface DetailResult {
  changedTiles: number;
  newEdgeTiles: number;
  maxBlockDelta: number;
  tripped: number[];
}
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
}
export interface A11yViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
}
export interface Row {
  id: string;
  story: string;
  mode: string;
  state: string | null;
  /** The entry's Storybook globals (`theme:light;colorway:default`), from the manifest entry. */
  globals?: string;
  browser?: string;
  pass: boolean;
  changed?: boolean;
  /** No signature yet: rendered, waiting for a person to approve its first render. */
  new?: boolean;
  /** Synthesised from the integrity ledger: a NEW entry with no render or verdict yet. */
  pending?: boolean;
  flaky?: boolean;
  skipped?: boolean;
  inherited?: boolean;
  cached?: boolean;
  error?: string | null;
  renderMs?: number;
  metrics: Metrics | null;
  reasons?: string[];
  detail?: DetailResult | null;
  gate?: Record<string, unknown>;
  pixels?: {
    width: number;
    height: number;
    changed: number;
    maxDelta: number;
    regions: Region[];
    regionCount: number;
  } | null;
  a11y?: {
    violations?: A11yViolation[];
    new?: number;
    baseline?: string[] | null;
    error?: string;
  } | null;
  retry?: { attempt: number; metrics: Metrics };
}
export interface CheckReport {
  generatedAt: string;
  manifest: {
    grid: number;
    gate: Record<string, number> | null;
    modes: Record<
      string,
      { globals: string; colorScheme: string; viewport?: number[]; browser?: string }
    > | null;
    defaultMode: string;
  };
  summary: {
    entries: number;
    checked: number;
    skipped: number;
    passed: number;
    failed: number;
    flaky: number;
    errors: number;
    cached: number;
    a11yViolations: number;
    a11yNew: number;
    modes: string[];
    concurrency: number;
    renderWallMs: number;
    rustEngineMs: number;
    rustProcessMs: number;
    retryMs: number;
    affected: string | null;
    totalMs: number;
  };
  rows: Row[];
}
export interface ScenarioRow {
  id: string;
  error?: string | null;
  changed: boolean;
  pass: boolean | null;
  wholeImagePass: boolean | null;
  metrics: Metrics | null;
  detail: DetailResult | null;
  reasons: string[];
  renderMs?: number;
}
export interface Scenario {
  name: string;
  kind: 'regression' | 'noise';
  title: string;
  change: string;
  summary: {
    /** Renders that checked without error. */
    stories: number;
    /** Renders that errored (no verdict). */
    errors: number;
    changed: number;
    /** Renders the shipped gate failed, changed or not. */
    failed: number;
    detected: number;
    detectedWholeImage: number;
    falsePositives: number | null;
    renderWallMs: number;
    rustEngineMs: number;
  };
  rows: ScenarioRow[];
}
export interface ScenarioReport {
  generatedAt: string;
  project?: string;
  gate: Record<string, unknown>;
  suite: { name: string; title: string; pattern?: string } | null;
  sample: { every: number; stories: number; concurrency?: number };
  renders?: string;
  scenarios: Scenario[];
}
/** One candidate whole-image rule at one grid (tools/calibrate.mjs). */
export interface CalibrationRule {
  name: string;
  label: string;
  threshold: number;
  falsePositives: number;
  caught: number;
  changed: number;
  recall: number;
  per: Record<string, { caught?: number; falsePositives?: number; of: number }>;
}
export interface CalibrationReport {
  generatedAt: string;
  project?: string;
  suite: { name: string; title: string; pattern?: string } | null;
  minCellPx: number | null;
  renders: number;
  grids: {
    grid: number;
    signatureBytes: number;
    msPerCompare: number;
    rules: CalibrationRule[];
    best: string | null;
  }[];
}
/** One detail-gate rule at one detail build (tools/calibrate-detail.mjs, without its `per`). */
export interface DetailCandidate {
  build: { tile: number; block: number; selEnergy: number };
  k: number;
  T: number;
  /** null: no rise limit (Infinity in the sweep). */
  E: number | null;
  fp: number;
  caught: number;
  changed: number;
  detailOnly: number;
  avgRecordBytes: number;
}
/** calibration-detail.json (tools/calibrate-detail.mjs): the fields the dashboard reads. */
export interface DetailCalibrationReport {
  generatedAt: string;
  project?: string;
  renders: number;
  sweepMs: number;
  sigOnly: { caught: number; changed: number; fp: number };
  best: DetailCandidate | null;
  topAdmissible: DetailCandidate[];
}
/** tools/bench.mjs. Every section is optional: a partial or older run may lack any of them. */
export interface BenchReport {
  generatedAt: string;
  project?: string;
  stories: number;
  cpus: number;
  cpu: string | null;
  runs: number;
  /** Batch check by thread count (median of `runs`). */
  check?: { rust?: Record<string, { internalMs: number; wallMs: number }> };
  capture?: { rustWallMs: number; rustInternalMs: number };
  /** One compare: a CLI process per call vs a request to the stdio daemon. */
  perCall?: { rustMs: number; serveMs: number; samples: number };
  memory?: { rustPeakRssBytes: number | null };
  footprint?: { rustBinaryBytes: number };
  render?: {
    stories: number;
    byConcurrency: Record<
      string,
      { wallMs: number; msPerStory: number; errors: number; reloads?: number }
    >;
  };
}
export interface HistoryRun {
  at: string;
  summary: { stories: number; failed: number; cached: number; elapsedMs: number };
  failedIds: string[];
}
export interface ReviewEntry {
  state: 'approved' | 'rejected';
  at: string;
  sha256?: string;
}
/** One issue on an entry (lib/integrity.mjs; codes and severities in INTEGRITY.md). */
export interface IntegrityIssue {
  code: string;
  severity: 'error' | 'warn' | 'info';
  reason: string;
}
export interface IntegrityEntry {
  id: string;
  story: string;
  component: string;
  mode: string | null;
  state: string | null;
  status: string;
  severity: 'error' | 'warn' | 'info';
  issues: IntegrityIssue[];
  files: { sig: string; sigExists: boolean; baseImage: boolean; latestRender: boolean } | null;
}
export interface IntegrityComponent {
  component: string;
  status: string;
  severity: 'error' | 'warn' | 'info';
  entries: number;
  stories: number;
  counts: Record<string, number>;
}
export interface IntegrityLedger {
  schemaVersion: number;
  generatedAt: string;
  sources: {
    storyIndex: {
      source: 'storybook' | 'static' | 'dashboard-screens';
      reachable?: boolean;
      healthy?: boolean;
      error?: string;
      inScope: number;
    };
    report: { generatedAt?: string; rows?: number; missing?: boolean };
  };
  setup: { code: string; severity: string; reason: string }[];
  summary: {
    status: 'clean' | 'warnings' | 'attention';
    headline: string;
    entries: number;
    components: number;
    componentsBySeverity: Record<'error' | 'warn' | 'info', number>;
    bySeverity: Record<'error' | 'warn' | 'info', number>;
    byCode: Record<string, number>;
  };
  components: IntegrityComponent[];
  entries: IntegrityEntry[];
}

export interface Data {
  generatedAt: string;
  /** The project this data belongs to (one server can serve several). */
  project?: string;
  /** The project switcher's name for it: the project's `label`, else its name. Older servers omit it. */
  label?: string;
  /**
   * The application under review, after "pxsig •" in the title: the workspace's `label`, else the
   * project's `label`, else its name. Older servers omit it.
   */
  scope?: string;
  /** What drew the page: pxsig, its engine and the UI contract (null when unknown). Older servers omit it. */
  versions?: { pxsig: string | null; engine: string | null; contract: string | null };
  /** The project's store, relative to the workspace root (for copyable paths). */
  store?: string;
  check: CheckReport | null;
  /** scenarios.json → `default`, scenarios-<suite>.json → `<suite>`. */
  scenarioSuites?: Record<string, ScenarioReport>;
  /** calibration[-<suite>].json, keyed the same way (the gate and detail calibrations excluded). */
  calibrationSuites?: Record<string, CalibrationReport>;
  /** calibration-gate.json (tools/calibrate-gate.mjs); the dashboard does not read it. */
  gateCalibration?: unknown;
  /** null when the report has no calibration-detail.json. */
  detailCalibration: DetailCalibrationReport | null;
  bench: BenchReport | null;
  history: HistoryRun[];
  review: Record<string, ReviewEntry>;
  /** The project's approval settings; `byStory` offers Approve story (off, or absent: one entry, one decision). */
  approvals?: { byStory?: boolean };
  /** Decisions on entries' accessibility violations (a11y-review.json); separate from the visual review. */
  a11yReview?: Record<string, { state: 'accepted' | 'rejected'; at: string }>;
  storybook: { baseUrl: string };
  /** `dashboard-screens`: pxsig's own screens (no Storybook to open, nothing to re-check here). */
  source?: 'storybook' | 'dashboard-screens';
  paths: { diffRoot: string; renders: string; baselines: string };
  sigs: Record<string, string>;
  integrity?: IntegrityLedger | null;
  /** Set when the data was inlined into a static report. */
  static?: boolean;
}

declare global {
  interface Window {
    PXSIG?: Data;
  }
}
