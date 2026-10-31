/**
 * types-release.d.ts — shapes for the release and example scripts (examples-test, product-shots,
 * make-platform-packages, compat-old). Types only: nothing here runs.
 */

/**
 * The part of Playwright product-shots.mjs and showcase-shots.mjs drive (https://playwright.dev/docs/api/class-browser).
 * The script loads pxsig's own Playwright with `createRequire`; its types are not resolvable from
 * scripts/ (pnpm keeps playwright-core beside it, not in the root node_modules), so this declares
 * just the calls made, as Playwright documents them.
 */
export interface ShotsPage {
  goto(url: string): Promise<unknown>;
  waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  waitForTimeout(ms: number): Promise<void>;
  mouse: { move(x: number, y: number): Promise<void> };
  screenshot(options?: {
    path?: string;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
  setContent(html: string): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  waitForFunction(fn: () => unknown): Promise<unknown>;
  keyboard: { press(key: string): Promise<void> };
  locator(selector: string): ShotsLocator;
  getByRole(role: string, options?: { name?: string | RegExp }): ShotsLocator;
  getByText(text: string, options?: { exact?: boolean }): ShotsLocator;
  close(): Promise<void>;
}
export interface ShotsLocator {
  first(): ShotsLocator;
  click(): Promise<void>;
  waitFor(): Promise<void>;
  count(): Promise<number>;
  screenshot(): Promise<Buffer>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
}
export interface ShotsContext {
  addInitScript<A>(script: (arg: A) => unknown, arg?: A): Promise<void>;
  newPage(): Promise<ShotsPage>;
  close(): Promise<void>;
}
export interface ShotsBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    colorScheme: 'dark' | 'light';
    reducedMotion: 'reduce' | 'no-preference';
  }): Promise<ShotsContext>;
  newPage(options?: { viewport: { width: number; height: number } }): Promise<ShotsPage>;
  close(): Promise<void>;
}
export interface ShotsPlaywright {
  chromium: { launch(): Promise<ShotsBrowser> };
}

// --- examples-test.mjs: what it reads of pxsig's JSON (docs/spec.md, docs/cli.md) ----------------

import type { CheckRow, CheckSummary } from '../packages/pxsig/src/types.js';

/** `<store>/reports/check.json`: the keys examples-test reads. */
export interface ExampleCheckJson {
  rows: CheckRow[];
  envs?: Record<string, unknown>;
  summary: CheckSummary & { envMismatch?: number };
  enforcement?: { wouldFail?: boolean; contexts: { advisory: string[] } };
  git?: { head?: string | null } | null;
}

/** The engine's `baseline --json` answer: its summary. */
export interface BaselineAnswer {
  summary: { failed: number; stories: number };
}

/** `pxsig doctor --json`: the keys read. */
export interface DoctorAnswer {
  summary: { bySeverity: Record<string, number>; headline: string };
  setup?: { code: string; severity: string }[];
}

/** `pxsig projects --json`. */
export interface ProjectsAnswer {
  projects: { name: string }[];
}

/** `pxsig dashboard gaps --json`: the keys read. */
export interface GapsAnswer {
  rows?: { status: string; required?: boolean }[];
  problems?: unknown[];
  contract?: { status: string };
}

/** `<build>/pxsig-build.json`, the stamp `pxsig dashboard build` writes. */
export interface BuildStamp {
  pxsig?: string;
  contract?: string;
  adapterContract?: string;
}

/** One screen of `pxsig dashboard check --json`. */
export type DashboardScreen = {
  feature: string;
  index: number;
  theme: string;
  /** How long the screen took, landmark wait included. */
  ms?: number;
  /** Page errors seen while it rendered. */
  errors?: string[];
} & ({ rendered: true; reason: null } | { rendered: false; reason: string });

/** `pxsig dashboard check --json`: the keys read. */
export interface DashboardCheckAnswer {
  summary?: { screens?: number; failed?: number; rendered?: number };
  screens?: DashboardScreen[];
}

/** One example project examples-test runs (its `examples` table). */
export interface Example {
  projects: string[];
  storybookDir: string;
  change: {
    file: string;
    from: string;
    to: string;
    affects: (project: string, id: string) => boolean;
  };
}
