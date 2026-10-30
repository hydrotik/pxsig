/**
 * Report data: inlined as `window.PXSIG` when the page is opened from disk, or
 * fetched from the pxsig server (`/__pxsig/data?project=`) and kept fresh over SSE when served.
 */
import React from 'react';
import { t } from './copy';
import { currentProject, type Refusal, scope, served, setCurrentProject } from './data/request';
import type { CheckReport, Data } from './data/types';

export type {
  Metrics,
  DetailResult,
  Region,
  A11yViolation,
  Row,
  CheckReport,
  ScenarioRow,
  Scenario,
  ScenarioReport,
  CalibrationRule,
  CalibrationReport,
  DetailCandidate,
  DetailCalibrationReport,
  BenchReport,
  HistoryRun,
  ReviewEntry,
  IntegrityIssue,
  IntegrityEntry,
  IntegrityComponent,
  IntegrityLedger,
  Data,
} from './data/types';
export { served } from './data/request';
export { reviewAction, a11yAction, recheck, approveStory, repairSafe } from './data/actions';
export {
  integrityOf,
  rowsWithPending,
  pathsFor,
  fmt,
  reviewQueue,
  decisionOf,
  componentOf,
  statusOf,
  type Queue,
} from './data/select';

/** Suite keys in display order: `default` first, the rest by name. */
export function suiteKeys(m: Record<string, unknown> | null | undefined): string[] {
  return Object.keys(m ?? {}).sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)
  );
}
/** A suite's display name: the report's own title, else the key (`default` → General sample). */
export function suiteTitle(
  key: string,
  rep?: { suite?: { title?: string } | null } | null
): string {
  return rep?.suite?.title ?? (key === 'default' ? t('diagnostics.scenario.defaultSuite') : key);
}

/** Counts a report's summary carries; a report missing one (written by an older or partial run) reads it as 0. */
const SUMMARY_COUNTS = [
  'entries',
  'checked',
  'skipped',
  'passed',
  'failed',
  'flaky',
  'errors',
  'cached',
  'a11yViolations',
  'a11yNew',
  'concurrency',
] as const;

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
  return {
    ...d,
    check: { ...d.check, summary, rows: Array.isArray(d.check.rows) ? d.check.rows : [] },
  };
}

async function fetchData(): Promise<Data> {
  const r = await fetch(`/__pxsig/data${scope()}`, { cache: 'no-store' });
  // The report data, or `error` on a refusal (server.md); a body that is not JSON reads as {}.
  const body = await (r.json() as Promise<Partial<Data> & Refusal>).catch(
    (): Partial<Data> & Refusal => ({})
  );
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  setCurrentProject(body.project ?? currentProject);
  // An ok answer is the report data; normalizeData fills in what an older or partial one lacks.
  return normalizeData(body as Data);
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
      .then((r) => r.json() as Promise<{ projects?: ProjectInfo[] }>)
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
  const [data, setData] = React.useState<Data | null>(
    window.PXSIG ? normalizeData(window.PXSIG) : null
  );
  const [error, setError] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(false);
  React.useEffect(() => {
    if (!served) return;
    let alive = true;
    const load = () =>
      fetchData()
        .then((d) => alive && (setData(d), setError(null)))
        .catch(
          // fetchData rejects with an Error (its own, fetch's or normalizeData's).
          (e: Error) => alive && !window.PXSIG && setError(String(e.message ?? e))
        );
    void load();
    let es: EventSource | null = null;
    // Events name their project; another project's results don't concern this page.
    // An event's data is the JSON object the server broadcast (serve.mjs), naming its project.
    const mine = (e: MessageEvent<string>) => {
      try {
        const p = (JSON.parse(e.data) as { project?: string } | null)?.project;
        if (!p || !currentProject || p === currentProject) void load();
      } catch {
        void load();
      }
    };
    try {
      es = new EventSource('/__pxsig/events');
      es.addEventListener('hello', () => setLive(true));
      es.addEventListener('data', mine);
      es.addEventListener('review', mine);
      es.addEventListener('integrity', mine);
      // Check runs: shown while they run, and their errors (Storybook down) reach the page.
      es.addEventListener('check', (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as CheckEvent;
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
/** A `check` event's data (serve.mjs broadcasts an object). */
type CheckEvent = {
  project?: string;
  state?: string;
  ids?: string[];
  error?: string;
  setup?: boolean;
};
function noteCheck(d: { state?: string; ids?: string[]; error?: string; setup?: boolean }) {
  if (d.state === 'running') setActivity({ ...activity, running: d.ids ?? [] });
  else if (d.state === 'done') setActivity({ running: null, error: null });
  else if (d.state === 'error')
    setActivity({ running: null, error: { message: d.error ?? '', setup: !!d.setup } });
}
export const dismissCheckError = () => setActivity({ ...activity, error: null });
export function useCheckActivity(): CheckActivity {
  return React.useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => activity,
    () => activity
  );
}
