/**
 * Shapes the Storybook addon reads and writes: the preset's options, the pxsig server's
 * `GET /__pxsig/status` answer (docs/server.md), the snapshot `pxsig snapshot` writes
 * (`pxsig-snapshot.json`), and the theme fields the panel reads. Types only: nothing here runs.
 */

declare global {
  interface Window {
    /**
     * Written by the preset's `managerHead`: the pxsig servers found for this workspace, in order,
     * and the workspace's id (what its server's status answer names it by).
     */
    __PXSIG__?: { servers?: string[]; workspaceId?: string | null };
  }
}

// --- preset ---------------------------------------------------------------------------------------

/** The options Storybook hands a preset function, with this addon's own (`server`, `snapshot`). */
export interface PresetOptions {
  /** The pxsig server's URL (docs/storybook.md). */
  server?: string;
  configDir?: string;
  configType?: string;
  snapshot?: boolean;
}

/** `node_modules/.cache/pxsig/server.json` and `pxsig.workspace.json`: the fields the preset reads. */
export interface ServerFile {
  url?: string;
}
export interface WorkspaceFile {
  server?: { port?: number };
}

/** What `spawnSync(…, { encoding: 'utf8' })` returns, as far as the preset reads it. */
export interface RunResult {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: Error;
}

/** The preset's seams for tests: how pxsig is run and where a warning goes. */
export interface SnapshotDeps {
  run?: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      encoding: 'utf8';
      timeout: number;
      env: NodeJS.ProcessEnv;
    }
  ) => RunResult;
  warn?: (line: string) => void;
}

/** A Storybook static dir: a path, or a folder served at `to`. */
export type StaticDir = string | { from: string; to: string };

// --- the server's status (GET /__pxsig/status) -----------------------------------------------------

/** One entry of a story in `stories`. */
export interface StatusEntry {
  id: string;
  mode?: string;
  state: string;
  ssim: number | null;
  reasons?: string[];
}

/** A story's check status in `stories`. */
export interface StoryStatus {
  status: string;
  project?: string;
  entries: StatusEntry[];
}

/** A story's integrity in `integrity`: the worst status of its entries, with their codes. */
export interface StoryIntegrity {
  status: string;
  severity: string;
  project?: string;
  component?: string;
  codes?: Record<string, number>;
}

/** The fields of `GET /__pxsig/status` the addon reads. */
export interface ServerStatus {
  /** The workspace the server serves; pxsig 0.6 and earlier send none. */
  workspaceId?: string;
  running: boolean;
  stories: Record<string, StoryStatus>;
  integrity?: Record<string, StoryIntegrity>;
  integritySummary?: Record<string, unknown> | null;
}

/** The `check` event's data (`state` is `running` while a check runs). */
export interface CheckEvent {
  state?: string;
  [key: string]: unknown;
}

/** A status dot's level (Storybook's `status-value:<level>`). */
export type StatusLevel = 'success' | 'warning' | 'error' | 'unknown';

/** The panel's shared state. */
export interface PanelState {
  up: boolean;
  running: boolean;
  stories: Record<string, StoryStatus>;
  integrity: Record<string, StoryIntegrity>;
  integritySummary: Record<string, unknown> | null;
  last?: CheckEvent;
}

// --- the snapshot (pxsig-snapshot.json) ------------------------------------------------------------

/** The last approval of an entry, or one history row (both carry a PR and a commit). */
export interface SnapshotApproval {
  at: string | null;
  event: string;
  pr: number | null;
  commit: string | null;
  kind: string | null;
  reason: string | null;
}

/** The environment a baseline was rendered in, as `pxsig snapshot` reduces it. */
export interface SnapshotEnv {
  browser?: string | null;
  os?: string | null;
  container?: string | null;
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

export interface SnapshotHistoryRow extends SnapshotApproval {
  entries: number;
}

export interface SnapshotStory {
  entries: SnapshotEntry[];
  history: SnapshotHistoryRow[];
}

export interface SnapshotProject {
  label?: string | null;
  stories?: Record<string, SnapshotStory>;
}

export interface Snapshot {
  format: 'pxsig-snapshot';
  version: 1;
  pxsig?: string;
  generatedAt: string;
  commit: string | null;
  shallow: boolean;
  uncommitted: boolean;
  projects: Record<string, SnapshotProject>;
}

/** A row of the panel's Coverage table (a type, not an interface: the table reads it by key). */
export type CoverageRow = {
  mode: string;
  baseline: string;
  last: string;
  pr: string;
  change: string;
  env: string;
  a11y: string;
};

/** A row of the panel's History table (a type, not an interface: the table reads it by key). */
export type HistoryRow = {
  at: string;
  event: string;
  pr: string;
  change: string;
  reason: string;
  entries: number;
};

export interface StoryView {
  entries: CoverageRow[];
  history: HistoryRow[];
}

// --- Storybook's theme -----------------------------------------------------------------------------

/** The fields of Storybook's theme (`useTheme()`) the panel reads; any may be missing. */
export interface PanelTheme {
  base?: string;
  background?: { content?: string };
  appContentBg?: string;
  color?: { defaultText?: string };
  textColor?: string;
  barTextColor?: string;
  textMutedColor?: string;
  appBorderColor?: string;
  appBorderRadius?: number;
  input?: { borderRadius?: number; border?: string; background?: string; color?: string };
}
