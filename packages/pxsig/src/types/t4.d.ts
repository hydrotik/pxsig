/**
 * types/t4.d.ts — shapes for the check, capture, report, dashboard, browser and snapshot code, and
 * the globals the page-side functions (page.evaluate / addInitScript) read and write. Types only.
 */
import type axe from 'axe-core';
import type { Browser, ConnectOptions, LaunchOptions } from 'playwright';
import type {
  A11yViolation,
  CheckRow,
  Config,
  EngineResult,
  EnvRecord,
  InteractionState,
  PeerBase,
  RenderResult,
  Size,
  StorybookPreviewWindow,
} from '../types.js';

// --- capture (lib/capture.mjs) -------------------------------------------------------------------

/** A Playwright engine name (schema `$defs/mode` `browser`). */
export type BrowserName = 'chromium' | 'firefox' | 'webkit';

/** One Playwright engine, as far as pxsig uses it (tests pass a stand-in with only this). */
export interface PlaywrightEngine {
  launch(options?: LaunchOptions): Promise<Browser>;
  connect(endpoint: string, options?: ConnectOptions): Promise<Browser>;
}

/** The playwright module, as far as pxsig uses it: its three engines. */
export type PlaywrightLib = Record<BrowserName, PlaywrightEngine>;

/** A Browser with what pxsig records on it: the channel it launched with, the server it connected to. */
export type PxsigBrowser = Browser & { __pxsigChannel?: string | null; __pxsigRemote?: string };

/** What hands `renderStories` a browser per engine: `browserPool()`. */
export interface BrowserSource {
  get(type?: string): Promise<PxsigBrowser>;
}

/** `node_modules/.cache/pxsig/browser.json`, as `pxsig browser start` writes it (browser.mjs). */
export interface BrowserRecordFile {
  ws: string;
  image: string;
  digest: string | null;
  revision: string | null;
  playwright: string | null;
  pxsig: string | null;
  container: string;
  name?: string;
  port?: number;
  startedAt?: string;
}

/** A token override's value: a literal, or a transform of the current value (`applyTokenOverrides`). */
export type TokenValue = string | number | { scale?: number; mix?: string; amount?: number };

/** One entry `renderStories` renders: `{ id }`, or a manifest v2 entry (docs/spec.md section 6). */
export interface RenderEntry {
  id: string;
  story?: string;
  importPath?: string;
  globals?: string;
  colorScheme?: string;
  viewport?: Size;
  browser?: string;
  ignore?: string[];
  /** The state's own settle time may come with it. */
  interaction?: InteractionState & { settleMs?: number };
  delay?: number;
  target?: string;
  play?: boolean;
  a11y?: boolean;
}

/** `renderStories` options: the run manifest's settings plus the run's own. */
export interface RenderOptions {
  baseUrl?: string;
  globals?: string;
  viewport?: Size;
  colorScheme?: string;
  settleMs?: number;
  target?: string;
  concurrency?: number;
  css?: string;
  tokens?: Record<string, TokenValue> | null;
  a11y?: boolean;
  project?: PeerBase;
  fastSwitch?: boolean;
  waitFor?: Config['capture']['waitFor'];
}

/** What `renderStories` returns. */
export interface RenderOutput {
  results: RenderResult[];
  wallMs: number;
  reloads: number;
}

/** The violations the page-side axe run returns (`renderStories`). */
export type PageViolations = A11yViolation[];

/** The part of Storybook's preview (`window.__STORYBOOK_PREVIEW__`) the page-side code reads. */
export interface StorybookPreview {
  currentRender?: { id?: string; phase?: string } | null;
  /** Storybook's channel: `setCurrentStory` in, `storyRendered` out (lib/capture.mjs switchStory). */
  channel?: {
    on(event: string, listener: () => void): void;
    off(event: string, listener: () => void): void;
    emit(event: string, payload: unknown): void;
  };
  /** What lib/manifest.mjs `harvestParameters` reads (`StorybookPreviewWindow`). */
  storeInitializationPromise?: StorybookPreviewWindow['__STORYBOOK_PREVIEW__']['storeInitializationPromise'];
  storyStoreValue?: StorybookPreviewWindow['__STORYBOOK_PREVIEW__']['storyStoreValue'];
}

declare global {
  /**
   * The DOM lib types `Response.json()` (from `Body`) as `Promise<any>`; Node's own typings say
   * `Promise<unknown>`. Declared here, it replaces the inherited one, so a fetched body stays
   * `unknown` and is narrowed where it is read, as it was before the DOM lib was added.
   */
  interface Response {
    json(): Promise<unknown>;
  }

  /** What pxsig's page-side code reads from and keeps on the page's window. */
  interface Window {
    /** Storybook's preview, once its bundle has run (absent on any other page). */
    __STORYBOOK_PREVIEW__?: StorybookPreview;
    /** axe-core, once `injectAxe` added its bundle. */
    axe?: typeof axe;
    /** `waitLayoutStable`'s last geometry signature, and since when it held. */
    __pxStableSig?: string | null;
    __pxStableSince?: number;
    /** `waitMarkupStable`'s last markup, and how many polls it held. */
    __pxsigMarkup?: string | null;
    __pxsigStable?: number;
  }
}

// --- blocks (lib/term.mjs; the same shapes as T2's types/t2.d.ts, reconciled on merge) ----------

/** A styled cell: coloured in pretty mode, a link when it has a URL. */
export interface StyledCell {
  text: string | number;
  color?: string;
  url?: string | null;
  /** Markdown prints the text alone. */
  noLinkInPlain?: boolean;
}

/** A value in a kv, table or list block. */
export type Cell = string | number | boolean | null | undefined | StyledCell | Cell[];

/** One block of a document `emit` prints. The first key it has, in this order, says what it is. */
export interface Block {
  h?: string;
  sub?: string | null;
  kv?: [string, Cell][];
  table?: {
    cols: { key: string; label: string; right?: boolean }[];
    rows: Record<string, Cell>[];
    more?: number;
    moreHint?: string;
  };
  list?: Cell[];
  note?: string;
  tone?: 'ok' | 'warn' | 'bad';
  next?: [string, string][];
  title?: string;
  images?: { label: string; path: string; data?: Buffer | null; missing?: boolean }[];
  text?: string;
}

// --- browser (browser.mjs) -----------------------------------------------------------------------

/** What a docker call returns (`dockerRunner`, or a stand-in). */
export interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  missing?: boolean;
  error?: Error | null;
}

/** `docker <args>`: `dockerRunner`, or a test's stand-in. */
export type Docker = (args: string[], opts?: object) => DockerResult;

// --- snapshot (snapshot.mjs; the file the Storybook addon reads) ---------------------------------

/** A row of `traceLog` (lib/approvals.mjs): where a log line came in. */
export interface TraceRow {
  line: number;
  id: string;
  batch: string;
  at: string;
  via: string;
  commit: string | null;
  pr: number | null;
}

/** The environment a baseline was rendered in, reduced to what a reader recognises. */
export interface SnapshotEnv {
  browser: string | null;
  os: string | null;
  container: string | null;
}

/** An env record (lib/env.mjs), or as much of one as an older `.psig` header has. */
export type PartialEnv = Partial<Record<keyof EnvRecord, unknown>> & {
  browser?: Partial<EnvRecord['browser']>;
  os?: Partial<EnvRecord['os']>;
  container?: Partial<NonNullable<EnvRecord['container']>> | null;
};

/** An entry's last log line, without who or how. */
export interface SnapshotApproval {
  at: string | null;
  event: string;
  pr: number | null;
  commit: string | null;
  kind: string | null;
  reason: string | null;
}

/** One history row: a batch of one story. */
export interface SnapshotHistoryRow extends SnapshotApproval {
  entries: number;
}

export interface SnapshotEntry {
  id: string;
  mode: string | null;
  state: string | null;
  baseline: boolean;
  approved: SnapshotApproval | null;
  env: SnapshotEnv | null;
  a11y: string[];
}

export interface SnapshotStory {
  entries: SnapshotEntry[];
  history: SnapshotHistoryRow[];
}

/** What `projectSnapshot` returns. */
export interface ProjectSnapshot {
  label: string | null;
  stories: Record<string, SnapshotStory>;
  uncommitted: boolean;
}

/** What `buildSnapshot` returns. */
export interface Snapshot {
  format: string;
  version: number;
  pxsig: string;
  generatedAt: string;
  commit: string | null;
  shallow: boolean;
  uncommitted: boolean;
  projects: Record<string, Omit<ProjectSnapshot, 'uncommitted'>>;
}

// --- dashboard (dashboard.mjs; the dashboard source's build modules, packages/dashboard) --------

/** What build-config.mjs `resolveAdapter` returns. */
export interface UiAdapter {
  name: string;
  file: string;
  dir: string;
  from: string;
}

/** What ui-tools.mjs `contractStatus` returns. */
export interface ContractStatus {
  adapter: string;
  current: string;
  status: 'same' | 'newer' | 'older-major' | 'older-minor';
  line: string;
  notes?: string[];
}

/** What ui-tools.mjs `gapsOf` returns. */
export interface GapsReport {
  adapter: string;
  contract: ContractStatus;
  rows: {
    name: string;
    group: string;
    required: boolean;
    status: string;
    note: string;
    usedBy: string[];
  }[];
  problems: string[];
}

/** build-config.mjs, as far as dashboard.mjs uses it. */
export interface DashboardBuildConfig {
  adapterSpec: (opts?: { adapter?: string; cwd?: string }) => {
    spec: string;
    base: string;
    from: string;
  };
  resolveAdapter: (opts?: { adapter?: string; cwd?: string }) => UiAdapter;
  packageDir: (name: string, fromDirs: string[]) => string | null;
  dashboardConfig: (o: {
    adapter?: string;
    cwd?: string;
    outDir: string;
    resolveFrom: string[];
    react: unknown;
    vanillaExtractPlugin: unknown;
    root?: string;
    viteVersion?: string;
  }) => Promise<Record<string, unknown>>;
}

/** ui-tools.mjs, as far as dashboard.mjs uses it. */
export interface DashboardUiTools {
  buildManifest: () => unknown;
  gapsOf: (o: { adapterFile: string; manifest?: unknown }) => GapsReport;
  gapsText: (report: GapsReport) => string;
  contractStatus: (adapterVersion?: string) => ContractStatus;
  /** The adapter's conformance.json, or null. */
  readConformance: (adapterDir: string) => { contract?: string } | null;
}

/** postbuild.mjs. */
export interface DashboardPostbuild {
  classicScript: (outDir: string) => void;
}

/** A package.json `exports` value, as far as `build` reads it. */
export type PackageExports =
  | string
  | null
  | undefined
  | { import?: PackageExports; default?: PackageExports; node?: PackageExports };

// --- dashboard check (dashboard-check.mjs; fixtures/screens.json, fixtures/scenarios.mjs) --------

/** What a screen clicks or waits for: `{ role, name?, exact? }` or `{ text, exact? }`. */
export interface ScreenTarget {
  role?: string;
  name?: string;
  text?: string;
  exact?: boolean;
}

/** One screen of a feature (fixtures/screens.json). */
export interface Screen {
  scenario: string;
  state?: string;
  query?: string;
  hash?: string;
  actions?: { click?: ScreenTarget; press?: string }[];
  wait: ScreenTarget;
}

/** One feature of fixtures/screens.json. */
export interface ScreenFeature {
  id: string;
  section?: string;
  title: string;
  purpose: string;
  states?: unknown;
  components: string[];
  screens: Screen[];
}

/** fixtures/screens.json, generated from src/ui/features.ts. */
export interface ScreenCatalogue {
  features: ScreenFeature[];
}

/** fixtures/scenarios.mjs, as far as the check's server uses it. */
export interface DashboardFixtures {
  LOAD_ERROR: string;
  SERVER_STATES: string[];
  SCENARIOS: Record<string, () => unknown>;
  scenarioData: (name: string) => Record<string, unknown>;
  projectsOf: (name: string) => unknown[];
  approvingOf: (name: string) => { allowed: boolean; cwd: string; command: string };
}

/** The sample PNGs the check's server answers with. */
export interface SampleImages {
  baseline: Buffer;
  render: Buffer;
  diff: Buffer;
}

/** What `scenarioServer` resolves to. */
export interface ScenarioServer {
  base: string;
  close: () => void;
}

/** A POST the check's server answered and recorded. */
export interface CheckPost {
  scenario: string;
  name: string;
  body: unknown;
}

/** One axe violation on a screen. */
export interface ScreenViolation {
  id: string;
  impact: string | null;
  count: number;
}

/** One layout finding on a screen (dashboard-check/layout.mjs). */
export interface LayoutFinding {
  rule: 'overflow' | 'clipped' | 'controls' | 'edge' | 'overlap';
  text: string;
}

/** What `capture` returns for one screen in one theme. */
export interface ScreenCapture {
  rendered: boolean;
  reason: string | null;
  errors: string[];
  axe: ScreenViolation[];
  /** Empty when the screen did not render, or for the reference build (not measured). */
  layout: LayoutFinding[];
  ms: number;
  /** Present only when the layout was still moving after SETTLE_MS: the screenshot was taken anyway. */
  settled?: false;
  /** Present only when the page load failed with this error and was retried once. */
  retried?: 'ERR_NO_BUFFER_SPACE';
}

/** One screen in one theme, as report.json lists it. */
export interface ScreenResult extends ScreenCapture {
  feature: string;
  title: string;
  purpose: string;
  components: string[];
  index: number;
  scenario: string;
  theme: string;
  fallbacks: string[] | null;
  shot: string | null;
  referenceShot: string | null;
}

/** report.json of `pxsig dashboard check`. */
export interface DashboardCheckReport {
  pxsig: string;
  build: string;
  adapter: string | null;
  contract: Pick<ContractStatus, 'current' | 'adapter' | 'status'>;
  reference: { dir: string; used: boolean; note: string | null };
  themes: string[];
  strict: boolean;
  summary: {
    screens: number;
    rendered: number;
    failed: number;
    withAxe: number;
    withLayout: number;
    posts: number;
  };
  screens: ScreenResult[];
}

// --- check (check.mjs; the engine's --json output, docs/cli.md; check.json, docs/spec.md section 7)

/** `pxsig affected --json`, as far as check.mjs reads it (docs/cli.md, `affected`). */
export interface AffectedResult {
  ids: string[];
  changed: string[];
  reason: string;
  mergeBase?: string | null;
  /** The paths nothing traces: each selects every entry. */
  failSafe: { path: string; class: string; why: string }[];
  /** Suite name → how many changed entries it holds. */
  otherSuites: Record<string, number>;
  unresolved: {
    file: string;
    spec?: string;
    line?: number;
    why?: string;
    accepted?: boolean;
    selects?: string;
  }[];
  [key: string]: unknown;
}

/** `pxsig trim --json`. */
export interface TrimResult {
  trimmed: number;
  files: number;
  pixelsBefore: number;
  pixelsAfter: number;
  elapsedMs: number;
}

/** `pxsig baseline --json`. */
export interface BaselineResult {
  summary: { stories: number; failed: number; elapsedMs: number };
  errors: string[];
}

/** One entry of `pxsig check --json` `results`. */
export type EngineCheckRow = EngineResult & { id: string; metrics?: unknown; retry?: unknown };

/** `pxsig check --json`. */
export interface EngineCheckOutput {
  results: EngineCheckRow[];
  summary: {
    elapsedMs: number;
    failed?: number;
    cached?: number;
    /** Failing entries that rendered the same image: the environment, not a change. */
    identicalRenders?: { count: number; ids: string[] }[];
  };
  /** The environments of the baselines checked, by id. */
  baselineEnvs?: Record<string, EnvRecord>;
}

/** `<store>/reports/check.json` (docs/spec.md section 7), as far as check.mjs reads it back. */
export interface CheckReport {
  generatedAt: string;
  fullCheckAt?: string | null;
  project: string;
  suite?: string | null;
  summary?: unknown;
  affected?: AffectedResult | null;
  envs?: Record<string, EnvRecord>;
  rows: CheckRow[];
  [key: string]: unknown;
}

/** `<store>/a11y.json`: entry id → its accepted axe rule ids. */
export type A11yBaseline = Record<string, string[]>;

/** The answer to `POST /__pxsig/check` (docs/server.md). */
export interface QueuedCheck {
  queued?: string[];
  registered?: string[];
  skipped?: { name: string; why: string }[];
}

/** `GET /__pxsig/status`, as far as check.mjs reads it. */
export interface ServerStatus {
  running?: boolean;
  queued?: number;
}
