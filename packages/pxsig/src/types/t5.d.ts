/**
 * types/t5.d.ts — the shapes the pxsig server (serve.mjs) passes around: the engine's stdio
 * JSON-RPC (crates/pxsig-cli/src/serve.rs), the review files it writes, check.json as it merges
 * it, and its answers (docs/server.md). Types only: nothing here runs.
 */
import type {
  A11yViolation,
  CheckRow,
  CheckSummary,
  EngineResult,
  EnvRecord,
  EnvSummary,
} from '../types.js';

// --- the engine (`pxsig serve` in Rust: one JSON request per line, one answer per line) ----------

/** `ping`. */
export interface EnginePing {
  pong: boolean;
  version: string;
  threads: number;
}

/** A file `affected` could not trace (`failSafe`): a gate would check every entry for it. */
export interface EngineFailSafe {
  file?: string | null;
  class?: string;
  why: string;
  [key: string]: unknown;
}

/** `affected` (the keys the server reads; `affected --json` has the rest). */
export interface EngineAffected {
  ids: string[];
  /** What the edits trace to (no fail-safe); an older engine has only `ids`. */
  traced?: string[];
  reason: string;
  failSafe?: EngineFailSafe[];
  [key: string]: unknown;
}

/** `capture`: the `.psig` written. */
export interface EngineCapture {
  sha256: string;
  grid: number;
  detail: boolean;
}

/** Failing entries that rendered the same image (`summary.identicalRenders`). */
export interface IdenticalRenders {
  render: string;
  count: number;
  ids: string[];
}

/** `check`. */
export interface EngineCheck {
  summary: {
    stories: number;
    failed: number;
    cached: number;
    threads: number;
    elapsedMs: number;
    identicalRenders?: IdenticalRenders[];
  };
  results: (EngineResult & { id: string })[];
  /** `baselineEnv` id → the baseline header's `env`. */
  baselineEnvs?: Record<string, EnvRecord>;
}

/** Each method the server calls: what it sends and what comes back. */
export interface EngineMethods {
  ping: { params: Record<string, never>; result: EnginePing };
  affected: {
    params: { manifest: string; root: string; files: string[] };
    result: EngineAffected;
  };
  capture: {
    params: {
      png: string;
      out: string;
      grid: number;
      minCellPx: number | undefined;
      detail: boolean;
      entry: { id: string; story: string | null; mode: string | null; state: string | null };
      env?: EnvRecord;
    };
    result: EngineCapture;
  };
  trim: {
    params: { dir: string; only: string[]; pad: number; tolerance: number };
    result: unknown;
  };
  check: {
    params: {
      /** Null only when the run manifest could not be written: the engine answers an error. */
      manifest: string | null;
      pngDir: string;
      root: string;
      only: string[];
      outDir: string;
      cache: string;
      history: string;
    };
    result: EngineCheck;
  };
}

export type EngineMethod = keyof EngineMethods;

/** One line the engine writes: `{ id, result }` or `{ id, error }` (`id` null for a bad request). */
export interface EngineReply {
  id: number | null;
  result?: unknown;
  error?: string;
  ms?: number;
}

/** A request waiting for its answer. */
export interface EnginePending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** The running engine process. */
export interface Engine {
  call: (method: string, params: unknown) => Promise<unknown>;
  kill: () => boolean;
}

// --- review files (`<store>/reports/review.json`, `a11y-review.json`, `<store>/a11y.json`) -------

/** One entry's visual decision (review.json, entry id → this). */
export interface ReviewEntry extends Partial<EngineCapture> {
  state: 'approved' | 'rejected';
  at: string;
  /** How a rejection reached the server (`dashboard`, `cli`, `mcp`). */
  via?: string;
  /** An approval: its batch, the baseline's sha256 after, the a11y baseline before. */
  batch?: string;
  after?: string | null;
  a11yBefore?: string[] | null;
}

export type ReviewFile = Record<string, ReviewEntry>;

/** One entry's accessibility decision (a11y-review.json, entry id → this). */
export interface A11yReviewEntry {
  state: 'accepted' | 'rejected';
  at: string;
  /** An accept: the accepted list before it. */
  before?: string[] | null;
  via?: string;
}

export type A11yReviewFile = Record<string, A11yReviewEntry>;

/** `<store>/a11y.json`: entry id → its accepted axe rule ids. */
export type A11yBaseline = Record<string, string[]>;

/** What a decision carries (`approve`, `reject`, `unreview`, `a11y-*`), from the request. */
export interface DecisionMeta {
  batch?: string;
  /** How it reached the server (lib/guard.mjs `authorize`), never the body's word. */
  via?: string | null;
  reason?: string;
  kind?: string;
  rule?: string;
}

// --- check.json, as the server merges it -------------------------------------------------------

/** check.json (docs/spec.md section 7). */
export interface CheckReport {
  generatedAt: string;
  fullCheckAt?: string;
  project?: string;
  summary: Record<string, unknown> & Partial<CheckSummary> & Partial<EnvSummary>;
  rows: CheckRow[];
  envs?: Record<string, EnvRecord>;
  [key: string]: unknown;
}

/** A full run's timings (`summary`): only a re-check of every entry writes them. */
export interface CheckTiming {
  concurrency: number;
  renderWallMs: number;
  pageLoads: number;
  rustEngineMs: number;
  totalMs: number;
}

/** A row with its axe result, as `a11y-accept` reads it. */
export type A11yRow = CheckRow & { a11y?: { violations?: A11yViolation[] } | null };

// --- answers -------------------------------------------------------------------------------------

/** `GET /__pxsig/status` `stories`: one story's entries for the addon's sidebar. */
export interface StoryStatus {
  status: string;
  project: string;
  entries: {
    id: string;
    mode: string | undefined;
    state: string;
    ssim: number | null;
    reasons: string[];
  }[];
}

/** `GET /__pxsig/status` `integrity`: one story's worst status, with its issue codes. */
export interface StoryIntegrity {
  status: string;
  severity: 'error' | 'warn' | 'info';
  project: string;
  component: unknown;
  codes: Record<string, number>;
}

/** What `POST /__pxsig/check` answers for one project (`enqueue`). */
export interface Enqueued {
  queued: string[];
  registered: string[];
  skipped: { name: string; why: string }[];
}

/** `<workspace>/node_modules/.cache/pxsig/server.json`. */
export interface ServerRecord {
  url: string;
  pid: number;
  startedAt: string;
  projects: string[];
}

/** An error the request handler answers with its `status` (else 500). */
export type HttpError = Error & { status?: number };

/** A check that failed on its setup (Storybook down, a broken index): nothing was recorded. */
export type SetupError = Error & { setup?: boolean };

/** A JSON request body: whatever the client sent, checked key by key. */
export type RequestBody = Record<string, unknown>;

/** An entry the request names, for `stateFor`. */
export interface ProjectQuery {
  project?: unknown;
  id?: unknown;
  story?: unknown;
}
