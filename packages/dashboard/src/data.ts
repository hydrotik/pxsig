/**
 * Report data: inlined as `window.PXSIG` when the page is opened from disk, or
 * fetched from the pxsig server (`/__pxsig/data?project=`) and kept fresh over SSE when served.
 */
import React from 'react';

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
  return rep?.suite?.title ?? (key === 'default' ? 'General sample' : key);
}

export const served = typeof location !== 'undefined' && location.protocol.startsWith('http') && !window.PXSIG?.static;

/** The project in view: `?project=` in the URL, else the one owning `?story=` (the Storybook panel). */
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
let currentProject: string | null = query.get('project');
const scope = () => (currentProject ? `?project=${encodeURIComponent(currentProject)}` : query.get('story') ? `?story=${encodeURIComponent(query.get('story')!)}` : '');
const withProject = (body: object) => JSON.stringify(currentProject ? { project: currentProject, ...body } : body);

async function fetchData(): Promise<Data> {
  const r = await fetch(`/__pxsig/data${scope()}`, { cache: 'no-store' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  currentProject = body.project ?? currentProject;
  return body;
}

export interface ProjectInfo {
  name: string;
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
  const [data, setData] = React.useState<Data | null>(window.PXSIG ?? null);
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

export async function reviewAction(action: 'approve' | 'reject' | 'unreview', id: string): Promise<void> {
  const r = await fetch(`/__pxsig/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: withProject({ id }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
}

export async function recheck(ids: string[]): Promise<void> {
  const r = await fetch('/__pxsig/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: withProject({ ids }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
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
    .map((x): Row => ({ id: x.id, story: x.story, mode: x.mode ?? '', state: x.state, pass: false, new: true, pending: true, metrics: null, reasons: ['new: not rendered yet — run Check, then approve its first render'] }));
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
      beforeLabel: 'control render',
      afterLabel: `${scenario.name} render`,
    };
  return {
    before: `${P.renders}base/${id}.png`,
    after: `${P.renders}latest/${id}.png`,
    baseSig: `${P.diffRoot}latest/${id}.baseline.png`,
    curSig: `${P.diffRoot}latest/${id}.current.png`,
    heat: `${P.diffRoot}latest/${id}.diff.png`,
    page: `${P.diffRoot}latest/${id}.diff.html`,
    record: d.sigs[id] ?? null,
    beforeLabel: 'baseline render',
    afterLabel: 'latest render',
  };
}

export const fmt = {
  ms: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`),
  pct: (v: number, d = 0) => `${(v * 100).toFixed(d)}%`,
  num: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
  kb: (b: number) => `${(b / 1024).toFixed(1)} KB`,
  x: (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}×`,
};

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
