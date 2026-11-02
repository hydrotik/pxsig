/**
 * types.d.ts — shapes for the scale benchmark (run.mjs, generate-store.mjs). Types only: nothing
 * here runs.
 */
import type { PsigHeader } from '../../packages/pxsig/src/types.js';

/** A timed step (run.mjs STEPS). */
export type Step = 'affected' | 'list' | 'doctor' | 'plan' | 'data';

/** Median milliseconds per step. */
export type StepTimes = Partial<Record<Step, number>>;

/** scripts/bench/baseline.json, and what --out writes. */
export interface BenchBaseline {
  pxsig: string;
  measuredAt?: string;
  node?: string;
  runs?: number;
  note?: string;
  /** Per OS (`os.platform()`). */
  times?: Record<string, StepTimes>;
  /** With --against: the last release's times from the same run (not read back). */
  release?: { pxsig: string | null; os: string; times: StepTimes };
}

/** One step's verdict (`judge`). */
export interface Verdict {
  step: Step;
  ms: number;
  budget: number | null;
  was: number | null;
  limit: number | null;
  /** The last release's median in the same run (--against), or null. */
  rel: number | null;
  /** Over this fails: RELEASE_RATIO × rel, and at least rel + RELEASE_FLOOR_MS. */
  relLimit: number | null;
  /** Over its budget, or slower than the release in the same run beyond relLimit. */
  fail: boolean;
  /** Why it fails. */
  why: string[];
  /** Over baseline.json's time by more than 50%: reported, not failed. */
  warn: string[];
}

/** The engine's template `.psig`, split at its header. */
export interface PsigTemplate {
  header: PsigHeader;
  body: Buffer;
}

/** A synthetic manifest entry (generate-store.mjs `entry`). */
export interface BenchEntry {
  id: string;
  story: string;
  mode: string;
  state: null;
  sig: string;
  importPath: string;
  globals: string;
  colorScheme: string;
  viewport: number[];
  browser: string;
  a11y: boolean;
}

/** What `generateStore` returns. */
export interface GeneratedStore {
  dir: string;
  entries: number;
  matrix: number;
  renders: number;
  storyFiles: number;
  changed: string[];
  edited: string;
}
