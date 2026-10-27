/**
 * Report data: inlined as `window.PXSIG` when the page is opened from disk, or
 * fetched from the pxsig server (`/__pxsig/data?project=`) and kept fresh over SSE when served.
 */
import React from 'react';
import { t } from './copy';
import { decide } from './link';

export interface Metrics {
  ssim: number;
  changedCells: number;
  changedCellsPct: number;
  maxCellDiff: number;
  colorDiffPct: number;
  edgeDiffPct: number;
  psnr: number | 'inf';
  ahashHamming: number;
  dhashHamming: number;
  identical: boolean;
  grid: number;
  threshold: number;
}
export interface DetailResult {
  changedTiles: number;
  newEdgeTiles: number;
  maxBlockDelta: number;
  tripped: number[];
}
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
}
export interface A11yViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
}
export interface Row {
  id: string;
  story: string;
  mode: string;
  state: string | null;
  /** The entry's Storybook globals (`theme:light;colorway:default`), from the manifest entry. */
  globals?: string;
  browser?: string;
  pass: boolean;
  changed?: boolean;
  /** No signature yet: rendered, waiting for a person to approve its first render. */
  new?: boolean;
  /** Synthesised from the integrity ledger: a NEW entry with no render or verdict yet. */
  pending?: boolean;
  flaky?: boolean;
  skipped?: boolean;
  inherited?: boolean;
  cached?: boolean;
  error?: string | null;
  renderMs?: number;
  metrics: Metrics | null;
  reasons?: string[];
  detail?: DetailResult | null;
  gate?: Record<string, unknown>;
  pixels?: { width: number; height: number; changed: number; maxDelta: number; regions: Region[]; regionCount: number } | null;
  a11y?: { violations?: A11yViolation[]; new?: number; baseline?: string[] | null; error?: string } | null;
  retry?: { attempt: number; metrics: Metrics };
}
export interface CheckReport {
  generatedAt: string;
  manifest: { grid: number; gate: Record<string, number> | null; modes: Record<string, { globals: string; colorScheme: string; viewport?: number[]; browser?: string }> | null; defaultMode: string };
  summary: {
    entries: number;
    checked: number;
    skipped: number;
    passed: number;
    failed: number;
    flaky: number;
    errors: number;
    cached: number;
    a11yViolations: number;
    a11yNew: number;
    modes: string[];
    concurrency: number;
    renderWallMs: number;
    rustEngineMs: number;
    rustProcessMs: number;
    retryMs: number;
    affected: string | null;
    totalMs: number;
  };
  rows: Row[];
}
export interface ScenarioRow {
  id: string;
  error?: string | null;
  changed: boolean;
  pass: boolean | null;
  wholeImagePass: boolean | null;
  metrics: Metrics | null;
  detail: DetailResult | null;
  reasons: string[];
  renderMs?: number;
}
export interface Scenario {
  name: string;
  kind: 'regression' | 'noise';
  title: string;
  change: string;
  summary: {
    /** Renders that checked without error. */
    stories: number;
    /** Renders that errored (no verdict). */
    errors: number;
    changed: number;
    /** Renders the shipped gate failed, changed or not. */
    failed: number;
    detected: number;
    detectedWholeImage: number;
    falsePositives: number | null;
    renderWallMs: number;
    rustEngineMs: number;
  };
  rows: ScenarioRow[];
}
export interface ScenarioReport {
  generatedAt: string;
  project?: string;
  gate: Record<string, unknown>;
  suite: { name: string; title: string; pattern?: string } | null;
  sample: { every: number; stories: number; concurrency?: number };
  renders?: string;
  scenarios: Scenario[];
}
/** One candidate whole-image rule at one grid (tools/calibrate.mjs). */
export interface CalibrationRule {
  name: string;
  label: string;
  threshold: number;
  falsePositives: number;
  caught: number;
  changed: number;
  recall: number;
  per: Record<string, { caught?: number; falsePositives?: number; of: number }>;
}
export interface CalibrationReport {
  generatedAt: string;
  project?: string;
  suite: { name: string; title: string; pattern?: string } | null;
  minCellPx: number | null;
  renders: number;
  grids: { grid: number; signatureBytes: number; msPerCompare: number; rules: CalibrationRule[]; best: string | null }[];
}
/** tools/bench.mjs. Every section is optional: a partial or older run may lack any of them. */
export interface BenchReport {
  generatedAt: string;
  project?: string;
  stories: number;
  cpus: number;
  cpu: string | null;
  runs: number;
  /** Batch check by thread count (median of `runs`). */
  check?: { rust?: Record<string, { internalMs: number; wallMs: number }> };
  capture?: { rustWallMs: number; rustInternalMs: number };
  /** One compare: a CLI process per call vs a request to the stdio daemon. */
  perCall?: { rustMs: number; serveMs: number; samples: number };
  memory?: { rustPeakRssBytes: number | null };
  footprint?: { rustBinaryBytes: number };
  render?: { stories: number; byConcurrency: Record<string, { wallMs: number; msPerStory: number; errors: number; reloads?: number }> };
}
export interface HistoryRun {
  at: string;
  summary: { stories: number; failed: number; cached: number; elapsedMs: number };
  failedIds: string[];
}
export interface ReviewEntry {
  state: 'approved' | 'rejected';
  at: string;
  sha256?: string;
}
/** One issue on an entry (lib/integrity.mjs; codes and severities in INTEGRITY.md). */
export interface IntegrityIssue {
  code: string;
  severity: 'error' | 'warn' | 'info';
  reason: string;
}
export interface IntegrityEntry {
  id: string;
  story: string;
  component: string;
  mode: string | null;
  state: string | null;
  status: string;
  severity: 'error' | 'warn' | 'info';
  issues: IntegrityIssue[];
  files: { sig: string; sigExists: boolean; baseImage: boolean; latestRender: boolean } | null;
}
export interface IntegrityComponent {
  component: string;
  status: string;
  severity: 'error' | 'warn' | 'info';
  entries: number;
  stories: number;
  counts: Record<string, number>;
}
export interface IntegrityLedger {
  schemaVersion: number;
  generatedAt: string;
  sources: { storyIndex: { source: 'storybook' | 'static'; reachable?: boolean; healthy?: boolean; error?: string; inScope: number }; report: { generatedAt?: string; rows?: number; missing?: boolean } };
  setup: { code: string; severity: string; reason: string }[];
  summary: {
    status: 'clean' | 'warnings' | 'attention';
    headline: string;
    entries: number;
    components: number;
    componentsBySeverity: Record<'error' | 'warn' | 'info', number>;
    bySeverity: Record<'error' | 'warn' | 'info', number>;
    byCode: Record<string, number>;
  };
  components: IntegrityComponent[];
  entries: IntegrityEntry[];
}

export interface Data {
  generatedAt: string;
  /** The project this data belongs to (one server can serve several). */
  project?: string;
  /** The title after "pxsig ·": the project's `label`, else its name. Older servers omit it. */
  label?: string;
  /** What drew the page: pxsig, its engine and the UI contract (null when unknown). Older servers omit it. */
  versions?: { pxsig: string | null; engine: string | null; contract: string | null };
  /** The project's store, relative to the workspace root (for copyable paths). */
  store?: string;
  check: CheckReport | null;
  /** scenarios.json → `default`, scenarios-<suite>.json → `<suite>`. */
  scenarioSuites?: Record<string, ScenarioReport>;
  /** calibration[-<suite>].json, keyed the same way (the gate and detail calibrations excluded). */
  calibrationSuites?: Record<string, CalibrationReport>;
  gateCalibration?: any;
  detailCalibration: any;
  bench: BenchReport | null;
  history: HistoryRun[];
  review: Record<string, ReviewEntry>;
  /** Decisions on entries' accessibility violations (a11y-review.json); separate from the visual review. */
  a11yReview?: Record<string, { state: 'accepted' | 'rejected'; at: string }>;
  storybook: { baseUrl: string };
  paths: { diffRoot: string; renders: string; baselines: string };
  sigs: Record<string, string>;
  integrity?: IntegrityLedger | null;
  /** Set when the data was inlined into a static report. */
  static?: boolean;
}

declare global {
  interface Window {
    PXSIG?: Data;
  }
}

/** Suite keys in display order: `default` first, the rest by name. */
export function suiteKeys(m: Record<string, unknown> | null | undefined): string[] {
  return Object.keys(m ?? {}).sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)));
}
/** A suite's display name: the report's own title, else the key (`default` → General sample). */
export function suiteTitle(key: string, rep?: { suite?: { title?: string } | null } | null): string {
  return rep?.suite?.title ?? (key === 'default' ? t('diagnostics.scenario.defaultSuite') : key);
}

export const served = typeof location !== 'undefined' && location.protocol.startsWith('http') && !window.PXSIG?.static;

/** The project in view: `?project=` in the URL, else the one owning `?story=` (the Storybook panel). */
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
let currentProject: string | null = query.get('project');
const scope = () => (currentProject ? `?project=${encodeURIComponent(currentProject)}` : query.get('story') ? `?story=${encodeURIComponent(query.get('story')!)}` : '');
const withProject = (body: object) => JSON.stringify(currentProject ? { project: currentProject, ...body } : body);

/** Counts a report's summary carries; a report missing one (written by an older or partial run) reads it as 0. */
const SUMMARY_COUNTS = ['entries', 'checked', 'skipped', 'passed', 'failed', 'flaky', 'errors', 'cached', 'a11yViolations', 'a11yNew', 'concurrency'] as const;

/**
 * The report as the views read it: a summary with every count and its modes, and a rows list, even
 * when the file has less (a sparse or hand-written check.json). Timings stay as they are: `fmt.ms`
 * shows a dash for a missing one.
 */
export function normalizeData(d: Data): Data {
  if (!d?.check) return d;
  const sm = (d.check.summary ?? {}) as Partial<CheckReport['summary']>;
  const summary = { ...sm } as CheckReport['summary'];
  for (const k of SUMMARY_COUNTS) if (typeof summary[k] !== 'number') summary[k] = 0;
  if (!Array.isArray(summary.modes)) summary.modes = [];
  if (summary.affected === undefined) summary.affected = null;
  return { ...d, check: { ...d.check, summary, rows: Array.isArray(d.check.rows) ? d.check.rows : [] } };
}

async function fetchData(): Promise<Data> {
  const r = await fetch(`/__pxsig/data${scope()}`, { cache: 'no-store' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  currentProject = body.project ?? currentProject;
  return normalizeData(body);
}

export interface ProjectInfo {
  name: string;
  /** The project's `label`, when it has one. */
  label?: string | null;
  root: string;
  entries: number;
  integrity: { status: string; headline: string } | null;
}

/** The server's projects (empty for a static report). */
export function useProjects(): ProjectInfo[] {
  const [list, setList] = React.useState<ProjectInfo[]>([]);
  React.useEffect(() => {
    if (!served) return;
    fetch('/__pxsig/projects', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => setList(b.projects ?? []))
      .catch(() => {});
  }, []);
  return list;
}

/** Show another project: the URL carries it, so a reload or a shared link keeps it. */
export function switchProject(name: string) {
  const q = new URLSearchParams(location.search);
  q.set('project', name);
  q.delete('story');
  location.search = q.toString();
}

/** The report data, refetched whenever the server says a producer wrote new results. */
export function useData(): { data: Data | null; error: string | null; live: boolean } {
  const [data, setData] = React.useState<Data | null>(window.PXSIG ? normalizeData(window.PXSIG) : null);
  const [error, setError] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(false);
  React.useEffect(() => {
    if (!served) return;
    let alive = true;
    const load = () =>
      fetchData()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && !window.PXSIG && setError(String(e.message ?? e)));
    load();
    let es: EventSource | null = null;
    // Events name their project; another project's results don't concern this page.
    const mine = (e: MessageEvent) => {
      try {
        const p = JSON.parse(e.data)?.project;
        if (!p || !currentProject || p === currentProject) load();
      } catch {
        load();
      }
    };
    try {
      es = new EventSource('/__pxsig/events');
      es.addEventListener('hello', () => setLive(true));
      es.addEventListener('data', mine);
      es.addEventListener('review', mine);
      es.addEventListener('integrity', mine);
      // Check runs: shown while they run, and their errors (Storybook down) reach the page.
      es.addEventListener('check', (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          if (!d?.project || !currentProject || d.project === currentProject) noteCheck(d);
        } catch {
          /* not ours */
        }
      });
      es.addEventListener('reload', () => location.reload());
      es.onerror = () => setLive(false);
    } catch {
      /* no live updates */
    }
    return () => {
      alive = false;
      es?.close();
    };
  }, []);
  return { data, error, live };
}

// Decisions carry the dashboard link's cookie (link.ts); without it the server refuses them, so an
// agent or a script posting to the server, or reading the page, cannot approve.
export async function reviewAction(action: 'approve' | 'reject' | 'unreview', id: string): Promise<void> {
  await decide(`/__pxsig/${action}`, withProject({ id }));
}

/** `unaccept` takes `rule` (or every rule) off the entry's accepted list. */
export async function a11yAction(action: 'accept' | 'reject' | 'unreview' | 'unaccept', id: string, rule?: string): Promise<void> {
  await decide(`/__pxsig/a11y-${action}`, withProject(rule ? { id, rule } : { id }));
}

/** Queue entries (or stories) for a re-check on the server. Never writes a baseline. */
export async function recheck(ids: string[]): Promise<{ queued: string[]; registered?: string[]; skipped?: { name: string; why: string }[] }> {
  const r = await fetch('/__pxsig/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: withProject({ ids }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return { queued: body.queued ?? [], registered: body.registered, skipped: body.skipped };
}

/**
 * Approve every entry of a story that waits for a decision, in one batch (a person's click; the
 * server leaves out entries that pass, did not render, or were rejected, and says why).
 */
export async function approveStory(story: string): Promise<{ approved: string[]; skipped: { id: string; why: string }[]; batch: string }> {
  return (await decide('/__pxsig/approve-story', withProject({ story }))) as { approved: string[]; skipped: { id: string; why: string }[]; batch: string };
}

/** The server's check runs, as its `check` events report them. */
export interface CheckActivity {
  /** Entries in the run going on now, or null. */
  running: string[] | null;
  /** The last run's error (Storybook down, a broken index), until dismissed or a run succeeds. */
  error: { message: string; setup: boolean } | null;
}
let activity: CheckActivity = { running: null, error: null };
const listeners = new Set<() => void>();
const setActivity = (next: CheckActivity) => {
  activity = next;
  for (const l of listeners) l();
};
function noteCheck(d: { state?: string; ids?: string[]; error?: string; setup?: boolean }) {
  if (d.state === 'running') setActivity({ ...activity, running: d.ids ?? [] });
  else if (d.state === 'done') setActivity({ running: null, error: null });
  else if (d.state === 'error') setActivity({ running: null, error: { message: d.error ?? '', setup: !!d.setup } });
}
export const dismissCheckError = () => setActivity({ ...activity, error: null });
export function useCheckActivity(): CheckActivity {
  return React.useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => activity,
    () => activity
  );
}

/** Run the safe repairs on the server (never writes signatures, never approves, never prunes). */
export async function repairSafe(): Promise<{ applied?: { action: string; result: string }[]; plan: { steps: { action: string; ids: string[] }[] } }> {
  const r = await fetch('/__pxsig/repair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: withProject({ apply: true }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}

/** Integrity entries by id (memoised per ledger). */
const byIdCache = new WeakMap<IntegrityLedger, Map<string, IntegrityEntry>>();
export function integrityOf(d: Data, id: string): IntegrityEntry | null {
  const L = d.integrity;
  if (!L) return null;
  let m = byIdCache.get(L);
  if (!m) byIdCache.set(L, (m = new Map(L.entries.map((x) => [x.id, x]))));
  return m.get(id) ?? null;
}

/**
 * Report rows plus a placeholder for every NEW manifest entry (no signature) the report has not
 * seen, so a registered story shows up in the approval list before its first render.
 */
export function rowsWithPending(d: Data): Row[] {
  const rows = d.check?.rows ?? [];
  if (!d.integrity) return rows;
  const have = new Set(rows.map((r) => r.id));
  const pending = d.integrity.entries
    .filter((x) => x.files && !have.has(x.id) && x.issues.some((i) => i.code === 'unbaselined'))
    .map((x): Row => ({ id: x.id, story: x.story, mode: x.mode ?? '', state: x.state, pass: false, new: true, pending: true, metrics: null, reasons: [t('review.pendingReason')] }));
  return pending.length ? [...rows, ...pending] : rows;
}

/** Files behind one verdict. `scenario` = { tag, name } for scenario renders. */
export function pathsFor(d: Data, id: string, scenario?: { tag: string; name: string } | null) {
  const P = d.paths;
  if (scenario)
    return {
      before: `${P.renders}${scenario.tag}/control/${id}.png`,
      after: `${P.renders}${scenario.tag}/${scenario.name}/${id}.png`,
      baseSig: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.baseline.png`,
      curSig: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.current.png`,
      heat: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.diff.png`,
      page: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.diff.html`,
      record: null as string | null,
      beforeLabel: t('inspector.renders.control'),
      afterLabel: t('inspector.renders.scenario', { name: scenario.name }),
    };
  return {
    before: `${P.renders}base/${id}.png`,
    after: `${P.renders}latest/${id}.png`,
    baseSig: `${P.diffRoot}latest/${id}.baseline.png`,
    curSig: `${P.diffRoot}latest/${id}.current.png`,
    heat: `${P.diffRoot}latest/${id}.diff.png`,
    page: `${P.diffRoot}latest/${id}.diff.html`,
    record: d.sigs[id] ?? null,
    beforeLabel: t('inspector.renders.baseline'),
    afterLabel: t('inspector.renders.latest'),
  };
}

export const fmt = {
  // A report without a timing (written by an older server) shows a dash, not NaN.
  ms: (v: number | null | undefined) => (typeof v !== 'number' || !Number.isFinite(v) ? '—' : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`),
  pct: (v: number, d = 0) => `${(v * 100).toFixed(d)}%`,
  num: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
  kb: (b: number) => `${(b / 1024).toFixed(1)} KB`,
  x: (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}×`,
};

export type Queue = 'changed' | 'new' | 'a11y';

/** An entry with new axe violations whose visual verdict needs no review: the accessibility queue. */
const a11yOnly = (r: Row) => (r.a11y?.new ?? 0) > 0 && !['changed', 'new'].includes(statusOf(r, {}));

/**
 * The entries a review session walks: every changed (or new, rendered, or a11y-only) entry of the
 * last check, decided or not, largest change first. Progress is how many of them have a decision.
 */
export function reviewQueue(d: Data, kind: Queue): Row[] {
  const size = (r: Row) => (r.metrics?.ssim ?? 2) - (r.detail ? (r.detail.changedTiles + r.detail.newEdgeTiles) / 1000 : 0);
  return rowsWithPending(d)
    .filter((r) => !r.pending && (kind === 'a11y' ? a11yOnly(r) : statusOf(r, {}) === kind))
    .sort((a, b) => size(a) - size(b) || a.id.localeCompare(b.id));
}

/** The decision on an entry within a queue: the visual review, or the accessibility one. */
export function decisionOf(d: Data, kind: Queue | null | undefined, id: string): { state: string } | undefined {
  return kind === 'a11y' ? d.a11yReview?.[id] : d.review[id];
}

/** The component an entry belongs to: the integrity ledger's, else the story title's first part. */
export function componentOf(d: Data, r: Row): string {
  return integrityOf(d, r.id)?.component ?? (r.story ?? r.id).split('--')[0];
}

/** A review decision (made on this run's results; a new check clears them) wins over the verdict. */
export function statusOf(r: Row, review: Record<string, ReviewEntry>): 'approved' | 'rejected' | 'changed' | 'new' | 'flaky' | 'skipped' | 'error' | 'pass' {
  const rv = review[r.id];
  if (rv) return rv.state;
  if (r.skipped) return 'skipped';
  if (r.new) return 'new';
  if (r.error) return 'error';
  if (r.flaky) return 'flaky';
  return r.pass ? 'pass' : 'changed';
}
