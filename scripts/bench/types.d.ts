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
}

/** One step's verdict (`judge`). */
export interface Verdict {
  step: Step;
  ms: number;
  budget: number | null;
  was: number | null;
  limit: number | null;
  fail: boolean;
  why: string[];
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
