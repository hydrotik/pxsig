/**
 * types.d.ts — the shapes the research tools (tools/*.mjs) pass around, for their JSDoc
 * (`checkJs`) and `oxlint --type-aware`. Types only: nothing here runs.
 *
 * The engine's JSON is what the Rust binary prints (docs/cli.md, docs/spec.md section 4); only the
 * keys the tools read are listed. The reports are the tools' own (<store>/reports/*.json).
 */
import type { ManifestEntry, Project } from '../packages/pxsig/src/types.js';

// --- the engine (pxsig's Rust binary) ------------------------------------------------------------

/** The whole-image metrics of one comparison (docs/spec.md section 4): what the tools read. */
export interface EngineMetrics {
  ssim: number;
  changedCells: number;
  changedCellsPct: number;
}

/** One entry of `check --json` / the daemon's `check`. */
export interface EngineCheckResult {
  id: string;
  pass?: boolean;
  error?: string | null;
  metrics?: EngineMetrics;
  detail?: unknown;
  reasons?: unknown[];
}

/** `check --json`, `baseline --json` and the daemon's `check`. */
export interface EngineCheck {
  results: EngineCheckResult[];
  summary?: { elapsedMs: number };
}

/** `baseline --json`: the tools read its timing only. */
export interface EngineBaseline {
  summary: { elapsedMs: number };
}

/** The daemon's `diff`: changed pixels at a tolerance. */
export interface EngineDiff {
  changed: number;
  width: number;
}

/** A tile that moved: `[blockDelta, energyRise]`. */
export type MovedTile = [number, number];

/** `detail-sweep --input pairs.json`: per pair, per detail build. */
export interface DetailSweep {
  rows: { key: string; builds: { recordBytes: number; moved: MovedTile[] }[] }[];
}

/** What a daemon request resolves to: the method's result plus the engine's time. */
export type EngineAnswer<T> = T & { _ms: number };

/** The daemon's methods the tools call, and what each answers. */
export interface EngineMethods {
  ping: Record<string, unknown>;
  check: EngineCheck;
  compare: Record<string, unknown>;
  diff: EngineDiff;
}

/** The Rust daemon (`pxsig serve`), as `engine(P)` returns it. */
export interface Engine {
  call<M extends keyof EngineMethods>(
    method: M,
    params?: Record<string, unknown>
  ): Promise<EngineAnswer<EngineMethods[M]>>;
  close(): void;
}

/** A request waiting for the daemon's answer. */
export interface Waiting {
  resolve: (value: EngineAnswer<Record<string, unknown>>) => void;
  reject: (err: Error) => void;
}

/** One line the daemon prints. */
export interface EngineLine {
  id: number;
  error?: string;
  result?: Record<string, unknown>;
  ms?: number;
}

/** What `rust()` returns. */
export interface RustCall<T> {
  out: T;
  status: number | null;
  wallMs: number;
  stderr: string;
}

// --- capture (packages/pxsig/src/lib/capture.mjs, as far as the tools use it) -------------------

/** One render, as `renderStories` returns it. */
export interface RenderResult {
  id: string;
  png: string | null;
  ms: number;
  error?: string;
  a11y?: unknown;
}

/** A shared pool of browsers (`browserPool`); the tools only close it. */
export interface BrowserPool {
  close(): Promise<void>;
}

/** The parts of lib/capture.mjs the tools import. */
export interface CaptureLib {
  browserPool: (project: Project | null) => BrowserPool;
  renderStories: (
    browser: BrowserPool | null,
    stories: ManifestEntry[],
    outDir: string,
    opts?: Record<string, unknown>
  ) => Promise<{ results: RenderResult[]; wallMs: number; reloads: number }>;
  STORYBOOK_ERROR: string;
}

// --- scenarios (tools/scenarios.mjs, <store>/reports/scenarios[-<suite>].json) ------------------

/** A token override (lib/capture.mjs `applyTokenOverrides`). */
export type TokenOverride = string | { scale: number } | { mix: string; amount: number };

/** A scenario: built in, or from a `--scenarios` file. */
export interface Scenario {
  name: string;
  kind: 'regression' | 'noise';
  title: string;
  change: string;
  css?: string;
  tokens?: Record<string, TokenOverride>;
  globals?: string;
  colorScheme?: string;
  modeSwap?: boolean;
}

/** A suite in a `--scenarios` file. */
export interface ScenarioSuite {
  title?: string;
  /** A regex over story ids. */
  stories: string;
  scenarios?: Scenario[];
}

/** A `--scenarios` file. */
export interface ScenariosFile {
  scenarios?: Scenario[];
  replace?: boolean;
  suites?: Record<string, ScenarioSuite>;
}

/** One render's row in a scenarios report. */
export interface ScenarioRow {
  id: string;
  error: string | null;
  changed: boolean;
  renderMs: number;
  pass: boolean | null;
  metrics: EngineMetrics | null;
  detail: unknown;
  reasons: unknown[];
  wholeImagePass: boolean | null;
}

/** One scenario's part of a scenarios report. */
export type ScenarioOut = Omit<Scenario, 'modeSwap'> & {
  summary: Record<string, number | null>;
  rows: ScenarioRow[];
};

/** <store>/reports/scenarios[-<suite>].json, as far as the calibration tools read it. */
export interface ScenariosReport {
  suite?: { name: string; title: string; pattern: string } | null;
  scenarios: ScenarioOut[];
}

// --- calibration ---------------------------------------------------------------------------------

/** A detail build `detail-sweep` measures. */
export interface DetailBuild {
  tile: number;
  block: number;
  selEnergy: number;
}

// --- bench (tools/bench.mjs, <store>/reports/bench.json) ----------------------------------------

/** <store>/reports/bench.json; each section is added as it is measured. */
export interface BenchReport {
  generatedAt: string;
  project: string;
  stories: number;
  cpus: number;
  cpu: string | null;
  runs: number;
  check?: { rust: Record<number, { internalMs: number; wallMs: number }> };
  capture?: { rustWallMs: number; rustInternalMs: number };
  perCall?: { rustMs: number; serveMs: number; samples: number };
  memory?: { rustPeakRssBytes: number | null };
  footprint?: { rustBinaryBytes: number };
  render?: {
    stories: number;
    byConcurrency: Record<
      number,
      { wallMs: number; msPerStory: number; errors: number; reloads: number }
    >;
  };
}
