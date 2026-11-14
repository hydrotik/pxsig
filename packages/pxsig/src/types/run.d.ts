/**
 * types/run.d.ts — a run's rows and the process around it: a11y, the engine's result, machine
 * folders, assistants, the server, locks, SARIF. Types only; types.d.ts re-exports them.
 */
import type { EnvMatch } from './env.js';

// --- rows (lib/rows.mjs; docs/spec.md section 7) -------------------------------------------------

/** One axe violation as a render reports it. */
export interface A11yViolation {
  id: string;
  impact?: string | null;
  help?: string;
  /** How many elements. */
  nodes?: number;
  /** The first few elements' selectors. */
  targets?: string[];
}

/** A row's `a11y`: the render's axe result, with what is new against the entry's accepted list. */
export interface A11yResult {
  violations?: A11yViolation[];
  error?: string;
  /** Violations not on the entry's accepted list. */
  new?: number;
  /** The entry's accepted rule ids, or null when the store has no a11y.json. */
  baseline?: string[] | null;
}

/** A mask that applied to a render, as the engine records it (crates/pxsig-cli/src/batch/masks.rs). */
export interface MaskRecord {
  selector: string;
  source: 'attribute' | 'story' | 'project' | 'workspace';
  /** The `data-volatile` attribute's value, when it has one. */
  reason?: string;
  /** The masked pixels' share of the capture, 0..1. */
  area: number;
  /** The elements the mask matched (absent in a header written before 0.7.7 was released). */
  count?: number;
  /** The masked pixels, and the boxes they come from (`[x0, y0, x1, y1]`, inside the capture). */
  px?: number;
  rects?: [number, number, number, number][];
  /** The capture found the mask on the story root: no approval passes the entry. */
  root?: boolean;
}

/** What changed from the baseline's masks to the render's: selectors. */
export interface MasksChanged {
  added: string[];
  removed: string[];
  /** Covers any pixel more. */
  grew: string[];
  /** A box differs by more than a pixel on a side. */
  moved: string[];
  /** Matches another number of elements. */
  count: string[];
}

/**
 * Masks no approval passes: all of them over half the capture (`coverage`), one on the story root
 * (`root`), or one the capture may not apply as asked (`problems`: a `data-volatile` container, one
 * with no reason, an element matched and not measured).
 */
export interface MasksBlocked {
  coverage?: number;
  root?: string[];
  problems?: { kind: 'container' | 'reason' | 'unmeasured'; element: string }[];
}

/** The engine's result for one entry (check.json metrics and verdict, section 4). */
export interface EngineResult {
  pass?: boolean;
  flaky?: boolean;
  error?: string | null;
  /** The text labels (crates/pxsig-cli/src/batch/text.rs): beside the verdict, never changing it. */
  textDiff?: import('./text.js').TextDiff;
  /** Why the row failed, as the engine words it. */
  reasons?: string[];
  /** The masks that applied to the render, when any, and the share they cover together. */
  masks?: MaskRecord[];
  masksCoverage?: number;
  /** Masks over a quarter of the capture each (together: `masksCoverage`): a warning. */
  masksLarge?: Omit<MaskRecord, 'reason'>[];
  /** Masks no approval passes: the row fails until the masks are smaller. */
  masksBlocked?: MasksBlocked;
  /** Set when the masks differ from the baseline's: the row fails with `masks changed: …`. */
  masksChanged?: MasksChanged;
  /** The baseline's masks, set with `masksChanged`: before and after, for the reviewer. */
  masksBaseline?: MaskRecord[];
  [metric: string]: unknown;
}

/** One render, as the renderer (lib/capture.mjs) reports it. */
export interface RenderResult {
  id?: string;
  png?: string | null;
  ms?: number;
  error?: string;
  a11y?: { violations?: A11yViolation[]; error?: string } | null;
  /** React commits and renders (`react.renders`); null when no React renderer loaded. */
  renders?: import('./react.js').RenderCounts | null;
  /** The text record this render wrote beside its PNG (`text` on); never in check.json. */
  text?: import('./text.js').TextCapture;
}

/** One row of check.json: the engine's result, the render and the review state of an entry. */
export interface CheckRow {
  id: string;
  story?: string;
  mode?: string;
  state?: string | null;
  browser?: string;
  globals?: string;
  pass?: boolean;
  changed?: boolean;
  error?: string | null;
  new?: boolean;
  reasons?: string[];
  note?: string;
  renderMs?: number;
  checkedAt?: string;
  a11y?: A11yResult | null;
  /** React commits and renders at capture (`react.renders`); null when no React renderer loaded. */
  renders?: import('./react.js').RenderCounts | null;
  js?: unknown;
  skipped?: boolean;
  /** Approved in review since this verdict (the server marks the row; the next check clears it). */
  approved?: { at: string; batch: string };
  flaky?: boolean;
  cached?: boolean;
  /** The engine's text labels, as it gave them (labels only). */
  textDiff?: import('./text.js').TextDiff;
  /** The render's masks, the large ones and a change from the baseline's (EngineResult). */
  masks?: MaskRecord[];
  masksCoverage?: number;
  masksLarge?: Omit<MaskRecord, 'reason'>[];
  masksBlocked?: MasksBlocked;
  masksChanged?: MasksChanged;
  masksBaseline?: MaskRecord[];
  /** The render's env id (lib/env.mjs `annotateRow`). */
  env?: string | null;
  baselineEnv?: string | null;
  envMatch?: EnvMatch;
  envDiff?: string[];
  envFonts?: string[];
  /**
   * On a passing row: whether any pixel of the render is not the baseline image's (the engine,
   * 0.7.7 and later). null when a rule failed the entry or the baseline holds no image.
   */
  differs?: boolean | null;
  [key: string]: unknown;
}

/** `drift.warnAt` (lib/drift.mjs): `drift-high` when both are reached. */
export interface DriftWarnAt {
  count: number;
  share: number;
}

/** check.json's `summary.drift` (lib/drift.mjs `driftSummary`). */
export interface DriftSummary {
  /** Checked entries that pass while their render differs from the baseline, same environment. */
  count: number;
  /** Checked entries that pass, rendered in their baseline's environment (or an unknown one). */
  of: number;
  /** `count / of`, to 3 decimals. */
  share: number;
  /** Passing, differing renders from a different environment than their baseline, not in `count`. */
  otherEnv: number;
  warnAt: DriftWarnAt;
  /** `count` and `share` reach `warnAt`. */
  warn: boolean;
}

/** check.json's `summary`, as `summarize` counts it (plus what the caller adds). */
export interface CheckSummary {
  entries: number;
  checked: number;
  skipped: number;
  passed: number;
  failed: number;
  changed: number;
  approved: number;
  flaky: number;
  new: number;
  errors: number;
  cached: number;
  a11yViolations: number;
  a11yNew: number;
  modes: (string | undefined)[];
  /** Entries React was still committing at capture; present when renders were counted. */
  renderAlerts?: number;
  /** Passing entries whose render differs from the baseline (0.7.7 and later). */
  drift?: DriftSummary;
}

// --- machine (lib/machine.mjs) -------------------------------------------------------------------

/** Which machine's folders: the defaults are this process's. */
export interface MachineOptions {
  /** `process.platform`'s values (`darwin`, `linux`, `win32`, …). */
  platform?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

// --- agents (lib/agents.mjs) ---------------------------------------------------------------------

/** One row of `MARKERS`: variables an assistant sets, and the name they give. */
export interface AgentMarker {
  vars: string[];
  /** Only a value this accepts counts. */
  when?: (value: string) => boolean;
  name: string | ((value: string) => string);
}

/** What `detectAgent` returns. */
export interface DetectedAgent {
  name: string;
  variable: string;
  /** Cleaned like a name: safe to print and to log. */
  value: string;
}

// --- assistants (lib/assistants.mjs) -------------------------------------------------------------

/** How an assistant starts pxsig's MCP server. */
export interface McpRecipe {
  file: string;
  scope: 'project' | 'user';
  lang: string;
  text: string;
}

/** One row of `ASSISTANTS`. */
export interface Assistant {
  id: string;
  label: string;
  mcp: (repo: string) => McpRecipe | null;
  instructions: { file: string; text: string } | null;
  policy: string | null;
  notes: string[];
}

// --- static (lib/static.mjs) ---------------------------------------------------------------------

/** A Storybook build served by `serveStaticDir`. */
export interface StaticServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

// --- lock (lib/lock.mjs) -------------------------------------------------------------------------

/** `<store>/reports/.lock`, as `acquireLock` writes it. */
export interface LockBody {
  pid: number;
  startedAt: string;
  host: string;
  /** Which command holds it (`check`, `serve`, …); a caller that names none writes no key. */
  holder?: string;
  command: string;
  url?: string;
  nonce: string;
  generation: number;
  heartbeatAt: string;
}

/**
 * The lock as `readLock` judges it. The file's keys may be missing (an unreadable file, a lock
 * from before the heartbeat), so all of them are optional here.
 */
export interface LockState extends Partial<LockBody> {
  stale: boolean;
  why?: string;
  foreign?: boolean;
  quiet?: boolean;
  heartbeatAgeMs?: number;
}

/** What `acquireLock` returns. */
export interface LockHandle {
  release: () => void;
  /** Rewrite the lock's body (the server adds its URL once it listens). */
  update: (extra: Partial<LockBody>) => void;
  /** Before a batch of store writes: throws when another process has taken the lock over. */
  check: () => void;
  /** This process already held it. */
  reentrant?: true;
}

/** `acquireLock` / `takeLock` options. */
export interface LockOptions {
  holder?: string;
  command?: string;
  url?: string | null;
  /** The nonce `takeLock` showed a person: replaces a quiet lock that still has it. */
  takeOver?: string | null;
}

// --- guard (lib/guard.mjs) -----------------------------------------------------------------------

// --- sarif (lib/sarif.mjs; SARIF 2.1.0) ---------------------------------------------------------

/** One SARIF rule: an axe rule. */
export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri: string;
  properties: { tags: string[] };
}

/** One SARIF result: a new violation of one rule on one entry, a mask finding on one entry, or the run's drift note. */
export interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: {
    physicalLocation?: { artifactLocation: { uri: string } };
    logicalLocations: { name: string; kind: string }[];
  }[];
  properties:
    | { entry: string; mode: string | null; impact: string | null }
    | { entry: string; mode: string | null; selector: string; source: string; area: number }
    | { entry: string; mode: string | null; coverage?: number; masks?: Partial<MasksChanged> }
    | (Omit<DriftSummary, 'warnAt'> & { warnAt: DriftWarnAt });
}

/** What `sarifLog` returns. */
export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: {
    tool: {
      driver: { name: string; version?: string; informationUri: string; rules: SarifRule[] };
    };
    results: SarifResult[];
  }[];
}

/** The server's two file tokens. */
export interface Tokens {
  cli?: string | null;
  mcp?: string | null;
}

/** What `authorize` returns. */
export type Authorization =
  | { ok: true; via: 'dashboard' | 'cli' | 'mcp' | null }
  | { ok: false; via?: undefined; status: number; error: string; code?: string };
