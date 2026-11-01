/**
 * types/store.d.ts — what a store and its stories hold: .psig, the manifest, the run manifest, the
 * approval log and the story index (docs/spec.md). Types only; types.d.ts re-exports them.
 */
import type { Config, Gate, Mode, Size } from './config.js';
import type { EnvRecord } from './env.js';

// --- files (lib/files.mjs) -----------------------------------------------------------------------

/** A log line that is cut short or does not parse (integrity code `log-torn`). */
export interface TornLine {
  /** 1-based line number. */
  line: number;
  /** The line's text, cut at 80 characters. */
  text: string;
}

// --- psig (lib/psig.mjs; docs/spec.md section 5) -------------------------------------------------

/** One entry of a `.psig` header's `sections`. */
export interface PsigSection {
  name: string;
  length: number;
  sha256?: string;
  /** The image section: `image/png`. */
  type?: string;
  width?: number;
  height?: number;
}

/**
 * A `.psig` header, as read from the file. The keys a reader must tolerate missing (an older or a
 * foreign file) are optional.
 */
export interface PsigHeader {
  format?: string;
  container?: number;
  entry?: { id: string; story: string; mode: string; state: string | null };
  /** 0.5 and later: the render environment (lib/env.mjs). */
  env?: EnvRecord;
  /** The spec v1 record, without `sig`. */
  record?: Record<string, unknown>;
  encryption?: string;
  sections?: PsigSection[];
}

// --- manifest (lib/manifest.mjs; docs/spec.md section 6) -----------------------------------------

/** An interaction state from `parameters.pxsig.states`. */
export interface InteractionState {
  name: string;
  action: string;
  target?: string;
  key?: string | string[];
  waitFor?: string;
  fullPage?: boolean;
}

/** A story's `parameters.pxsig` (plain data: read through a JSON round-trip). */
export interface StoryPxsigParameters {
  disable?: boolean;
  modes?: string[];
  addModes?: string[];
  gate?: Partial<Gate>;
  grid?: number;
  detail?: boolean;
  ignore?: string[];
  states?: InteractionState[];
  delay?: number;
  target?: string;
  a11y?: boolean;
  viewport?: Size;
}

/** What `harvestParameters` reads for one story. */
export interface StoryParameters {
  pxsig: StoryPxsigParameters;
  tags: string[];
  play?: boolean;
  /** Loading the story failed: the error's message. */
  error?: string;
}

/** The part of Storybook's preview (`window.__STORYBOOK_PREVIEW__`) `harvestParameters` reads. */
export interface StorybookPreviewWindow {
  __STORYBOOK_PREVIEW__: {
    storeInitializationPromise: Promise<unknown>;
    storyStoreValue: {
      loadStory(options: { storyId: string }): Promise<{
        parameters?: { pxsig?: unknown };
        tags?: string[];
        playFunction?: unknown;
      }>;
    };
  };
}

/** A manifest entry (docs/spec.md, "Entry keys"). */
export interface ManifestEntry {
  id: string;
  story: string;
  mode: string;
  state: string | null;
  /** Baseline path, relative to the workspace root. */
  sig: string;
  /** The story file, relative to the workspace root. */
  importPath: string;
  globals: string;
  colorScheme: string;
  viewport: Size;
  browser: string;
  grid?: number;
  gate?: Partial<Gate>;
  detail?: false;
  ignore?: string[];
  interaction?: InteractionState;
  delay?: number;
  target?: string;
  play?: true;
  a11y: boolean;
}

/** A story the manifest leaves out, with the reason. */
export interface ManifestSkipped {
  id: string;
  reason: string;
}

/** A manifest file, version 2. */
export interface Manifest {
  version: number;
  project?: string;
  stories: ManifestEntry[];
  skipped?: ManifestSkipped[];
}

/** A story `expandEntries` turns into entries. */
export interface StoryRef {
  id: string;
  importPath: string;
  /** The baseline path for an entry key. */
  sigFor: (key: string) => string;
}

/**
 * The settings `expandEntries` reads: `entryConfig(P)` (lib/workspace.mjs), or the older shape with
 * one `globals` / `colorScheme` and no modes.
 */
export interface EntryConfig {
  modes?: Record<string, Mode>;
  defaultMode?: string | null;
  modesByDefault?: string[] | null;
  viewport?: Size;
  a11y?: boolean;
  globals?: string;
  colorScheme?: Mode['colorScheme'];
}

// --- run manifest (lib/workspace.mjs) ------------------------------------------------------------

/** What `runManifest` returns: the entries plus the resolved settings Rust and the renderer read. */
export interface RunManifest {
  version: 2;
  baseUrl: string;
  viewport: Size;
  colorScheme: string;
  globals: string;
  settleMs: number;
  target: string;
  waitFor: Config['capture']['waitFor'];
  grid: number;
  minCellPx: number;
  detail: boolean;
  trim: Config['trim'];
  gate: Gate;
  modes: Record<string, Mode>;
  defaultMode: string;
  srcRoot: string;
  affectsAll: string[];
  affectsIgnore: string[];
  affectsAliases: Record<string, string>;
  affectsUnresolved: string[];
  store: {
    dir: string;
    a11y: string;
    approvals: string;
    a11yDecisions: string;
    /** Suite name (`''` for the default manifest) → workspace-relative manifest path. */
    manifests: Record<string, string>;
    suite: string | null;
  };
  a11y: boolean;
  stories: ManifestEntry[];
  skipped: ManifestSkipped[];
}

// --- approvals (lib/approvals.mjs) ---------------------------------------------------------------

/**
 * One line of `<store>/approvals.ndjson`, as `record` (and `pxsig migrate`) write it. A line from an
 * older pxsig may lack the later keys.
 */
export interface ApprovalLine {
  at: string;
  id: string;
  /** Who, only with `approvals.identity: "git-email"`. */
  by?: string | null;
  via: string;
  batch: string;
  reason?: string | null;
  kind?: string | null;
  gitHead?: string | null;
  /** sha256 of the baseline before (null: a first baseline) and after. */
  before?: string | null;
  after?: string | null;
  /** The assistant's marker, when one started the process (lib/agents.mjs). */
  agent?: string;
  /** The pxsig version that wrote the line. */
  pxsig?: string;
  [key: string]: unknown;
}

// --- integrity (lib/integrity.mjs) ---------------------------------------------------------------

/** A story in the story index: Storybook's index.json, or the static scan of the story files. */
export interface IndexStory {
  id: string;
  title: string;
  name: string;
  /** The story file, relative to the workspace root. */
  importPath: string;
  tags?: string[];
  /** The static scan: the export the story comes from, and where its title came from. */
  exportName?: string;
  titleSource?: string;
}

/**
 * What `loadStoryIndex` returns: the live index when Storybook answers healthy, else the scan;
 * `dashboard-screens` (pxsig's own screens) has no stories.
 */
export interface StoryIndex {
  source: 'storybook' | 'static' | 'dashboard-screens';
  storybook: {
    url: string;
    reachable: boolean;
    healthy: boolean;
    version?: unknown;
    error?: string;
  };
  stories: IndexStory[];
}
