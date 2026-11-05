/**
 * types/react.d.ts — React analysis (lib/react/, cli/react.mjs; the engine's `react-plan` and
 * `react-diff`). Types only. The report's shape is `reports/react.json`, written by the engine.
 */

/** The `react` config key, resolved (lib/react/config.mjs). */
export interface ReactConfig {
  /** Why React analysis is off for this run (an off switch, or a bad value); null: on. */
  off: string | null;
  /** The bad values found: each is one warning line, and the feature is off for the run. */
  problems: string[];
  /** Compiler analysis (`react.compiler`: true / "auto" on; false / "off" off). */
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
  files: { path: string; entries: number; all: boolean; head: string; base: string | null }[];
  functions: Record<string, unknown>[];
  alerts: ReactAlert[];
  skipped: { path: string; why: string }[];
  notes: string[];
  summary: ReactSummary;
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
      /** `off` (a switch), `config` (a bad value), `not-installed`, `failed`. */
      why: 'off' | 'config' | 'not-installed' | 'failed';
      /** The line the CLI prints. */
      text: string;
    };
