/**
 * types/react.d.ts — React features: the settings (lib/react/config.mjs), render counting
 * (lib/capture/react-hook.mjs; what a check row records in `renders`, docs/spec.md) and the
 * compiler analysis (lib/react/, cli/react.mjs; the engine's `react-plan` and `react-diff`).
 */

/** `react` in pxsig.config.json, as lib/react/config.mjs reads it. */
export interface ReactSettings {
  /** Why everything React is off (`react: false`, `--no-react`, `PXSIG_REACT=off`), else null. */
  off: string | null;
  /** Count React commits and renders in every render (`react.renders`). */
  renders: boolean;
}

/** One window's counts: commits, and the components that rendered (null: not walked). */
export interface RenderPhase {
  commits: number;
  rendered: number | null;
  mounted?: number | null;
}

/** A component in `top`: how often it rendered, and whether the React Compiler compiled it. */
export interface RenderTop {
  name: string;
  renders: number;
  compiled: boolean;
}

/** A check row's `renders` (docs/spec.md); null when no React renderer loaded. */
export interface RenderCounts {
  v: 1;
  build: 'development' | 'production';
  react: string | null;
  mount: RenderPhase;
  interaction?: RenderPhase;
  top: RenderTop[];
  /** React's own render time, development builds only. */
  ms?: number;
  /** React had stopped committing: no commit within 250 ms after its last one before the capture. */
  settled: boolean;
  /** When the render that measured these counts ran (a check that rendered the entry). */
  at?: string;
  /** The mount counts of the row this one replaced, for "since the last check in this store". */
  prev?: { commits: number; rendered: number | null; at: string | null };
}

/** One read of the page's counters (`readRenders`): a window, plus the totals so far. */
export interface RenderRead {
  build: RenderCounts['build'];
  react: string | null;
  phase: RenderPhase;
  top: RenderTop[];
  ms: number | null;
  settled: boolean;
}

/** A fiber, as far as the hook reads one. */
export interface HookFiber {
  tag: number;
  flags: number;
  type?: unknown;
  elementType?: unknown;
  alternate: HookFiber | null;
  child: HookFiber | null;
  sibling: HookFiber | null;
  updateQueue?: { memoCache?: unknown } | null;
  actualDuration?: number;
}

/** What React's renderer hands the hook (`inject`). */
export interface HookInternals {
  bundleType?: number;
  version?: string;
  reconcilerVersion?: string;
}

/** The DevTools hook React looks for: the part pxsig defines or wraps. */
export interface DevtoolsHook {
  supportsFiber?: boolean;
  isDisabled?: boolean;
  renderers?: Map<number, HookInternals>;
  inject?: (internals: HookInternals) => number;
  onCommitFiberRoot?: (id: number, root: { current: HookFiber }, ...rest: unknown[]) => void;
  [method: string]: unknown;
}

/** The counters the hook keeps on the page. */
export interface RenderState {
  injected: number;
  build: RenderCounts['build'];
  react: string | null;
  commits: number;
  rendered: number;
  mounted: number;
  visited: number;
  over: boolean;
  broken: boolean;
  last: number;
  ms: number;
  timed: boolean;
  names: Map<string, { renders: number; compiled: boolean }>;
}

/** The `react` config key, resolved (lib/react/config.mjs). */
export interface ReactConfig {
  /** Why everything React is off for this run (an off switch, or a `react` that is not an object); null: on. */
  off: string | null;
  /**
   * The bad values found, each a warning line naming what it turns off for this run: the part it
   * belongs to (`react.renders`: render counting; any other key: compiler analysis).
   */
  problems: string[];
  /** Compiler analysis (`react.compiler`: true / "auto" on; false / "off" off; off with a bad compiler-side value). */
  compiler: boolean;
  /** Also the validation-only findings eslint-plugin-react-hooks reports. */
  lint: boolean;
  compilationMode: 'infer' | 'annotation' | 'syntax' | 'all';
  target: '17' | '18' | '19' | 'auto';
  environment: Record<string, unknown>;
  exclude: string[];
  /** Count React commits and renders in every render (R4). */
  renders: boolean;
}

/** One package found in the project (lib/react/peers.mjs). The path never reaches an output. */
export interface ReactPeer {
  path: string;
  version: string;
}

/** What the project has installed for React analysis. */
export interface ReactPeers {
  compiler: ReactPeer | null;
  babel: ReactPeer | null;
  /** The `react` version that resolves from the project, for `target: "auto"`. */
  react: string | null;
}

/** One reason the compiler gave for a function. */
export interface ReactDiagnostic {
  /** The eslint-plugin-react-hooks rule name (the compiler's `LintRules`), else "". */
  rule: string;
  category: string;
  reason: string;
  line: number | null;
  severity: string | null;
  /** It made the compiler skip the function; false: a finding on a function that compiles. */
  stops: boolean;
}

/** One component or hook as the compiler saw it, in one file. */
export interface ReactFunction {
  name: string;
  kind: 'component' | 'hook';
  line: number;
  endLine: number;
  outcome: 'compiled' | 'bailout' | 'opted-out' | 'compiler-error';
  memoSlots?: number;
  diagnostics: ReactDiagnostic[];
}

/** A worker's answer for one file side: its functions, or why there are none. */
export type CompileResult =
  | { functions: ReactFunction[] }
  | { error: 'analysis-timeout' | 'compiler-error' };

/** One side of a planned file (the engine's `react-plan`). */
export interface PlanSide {
  sha: string;
  hit: boolean;
  /** The text to compile, on a miss. */
  text?: string;
}

/** One file in the plan. */
export interface PlanFile {
  path: string;
  status: string;
  entries: string[];
  all: boolean;
  parser: string[];
  compare: boolean;
  head: PlanSide;
  base: PlanSide | null;
  from?: string;
}

/** The engine's `react-plan`. */
export interface ReactPlan {
  v: number;
  base: { since: string; commit: string } | null;
  files: PlanFile[];
  skipped: { path: string; why: string }[];
  notes: string[];
}

/** One alert in `react.json`. */
export interface ReactAlert {
  kind: 'compiler';
  id: string;
  name: string;
  path: string;
  change: string;
  level: 'warning' | 'note';
  rule: string | null;
  line: number | null;
  text: string;
}

/** `reports/react.json`'s summary. */
export interface ReactSummary {
  files: number;
  functions: number;
  compiled: number;
  bailouts: number;
  newBailouts: number;
  findings: number;
  newFindings: number;
  fixed: number;
  optedOut: number;
  alerts: number;
  ms: number | null;
  cached: number;
}

/** `reports/react.json` (the engine's `react-diff --out`). */
export interface ReactReport {
  v: number;
  generatedAt: string;
  project: string | null;
  mode: 'alert';
  backend: { name: string; compiler: string; babel: string; options: Record<string, unknown> };
  base: { since: string; commit: string } | null;
  /** `ids`: the entries the file reaches; null when it reaches every entry (`all`). */
  files: {
    path: string;
    entries: number;
    all: boolean;
    ids: string[] | null;
    head: string;
    base: string | null;
  }[];
  functions: Record<string, unknown>[];
  alerts: ReactAlert[];
  skipped: { path: string; why: string }[];
  notes: string[];
  summary: ReactSummary;
}

/** Where React is off, for the dashboard: the place and the key that turned it off. */
export interface ReactOff {
  where: 'config' | 'workspace' | 'flag' | 'env';
  key: 'react' | 'react.compiler';
}

/** What the server knows about a project's analysis (serve/react.mjs), for `data.react`. */
export interface ReactLive {
  running: boolean;
  /** The last run failed: why. */
  error: string | null;
  /** The last run was skipped (and none finished since). */
  skipped: boolean;
  /** The last run's results were not saved: the store's holder. */
  held: string | null;
  /** Source files changed since the last analysis. */
  stale: { files: number; since: string } | null;
  /** The packages the compiler analysis needs and the project lacks. */
  missing: string[];
  /** `generatedAt` of the react.json this server wrote last. */
  wrote: string | null;
  /** A run's results kept in memory, when they could not be saved. */
  report: ReactReport | null;
}

/** `data.react` (lib/react/data.mjs): the analysis' state, its last results and who wrote them. */
export interface ReactData {
  status: {
    compiler: 'ready' | 'off' | 'not-installed' | 'bad-config' | 'running' | 'skipped' | 'failed';
    renders: 'ready' | 'off';
    off: ReactOff | null;
    missing: string[];
    configWarning: string | null;
    error: string | null;
    held: string | null;
    stale: { files: number; since: string } | null;
  };
  report: ReactReport | null;
  source: 'check' | 'server' | 'react-cli' | null;
}

/** An analysis run's progress (`analyse`'s `onProgress`): files done of all, those from the cache. */
export interface ReactProgress {
  done: number;
  total: number;
  cached: number;
}

/** What one analysis run answers (lib/react/index.mjs `analyse`). */
export type ReactRun =
  | {
      ran: true;
      report: ReactReport;
      /** Where react.json went: `reports/react.json`, or null when another process held the store. */
      saved: string | null;
      /** Who holds the store when nothing was saved. */
      heldBy: string | null;
      /** Files compiled in this run (cache misses), and worker threads started. */
      compiled: number;
      workers: number;
    }
  | {
      ran: false;
      /** `off` (a switch), `config` (a bad value), `not-installed`, `failed`, `skipped` (its signal). */
      why: 'off' | 'config' | 'not-installed' | 'failed' | 'skipped';
      /** The line the CLI prints. */
      text: string;
    };

/** check.json's `react` (check/react.mjs): the analysis, or why it did not run. */
export type CheckReact =
  | Pick<ReactReport, 'summary' | 'alerts' | 'base' | 'backend'>
  | { skipped: Extract<ReactRun, { ran: false }>['why'] };

/** A rule in the React SARIF file (lib/sarif-react.mjs). */
export interface ReactSarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri?: string;
  properties: { tags: string[] };
}

/** One React alert as a SARIF result. */
export interface ReactSarifResult {
  ruleId: string;
  level: 'warning' | 'note';
  message: { text: string };
  locations: {
    physicalLocation?: {
      artifactLocation: { uri: string };
      region?: { startLine: number };
    };
    logicalLocations: { name: string; kind: string }[];
  }[];
  properties: { id: string; change: string };
}

/** What `reactSarifLog` returns. */
export interface ReactSarifLog {
  $schema: string;
  version: '2.1.0';
  runs: {
    tool: {
      driver: { name: string; version?: string; informationUri: string; rules: ReactSarifRule[] };
    };
    results: ReactSarifResult[];
  }[];
}

declare global {
  interface Window {
    /** React's DevTools hook: pxsig's own when `react.renders` is on (lib/capture/react-hook.mjs). */
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook;
    /** The render counters of the story on this page. */
    __pxsigRenders?: RenderState;
  }
}
