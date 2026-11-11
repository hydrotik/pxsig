/**
 * Report data: inlined as `window.PXSIG` when the page is opened from disk, or
 * fetched from the pxsig server (`/__pxsig/data?project=`) and kept fresh over SSE when served.
 */
import React from 'react';
import { t } from './copy';
import {
  currentProject,
  query,
  type Refusal,
  scope,
  served,
  setCurrentProject,
} from './data/request';
import { nameFirstProject } from './data/projects';
import { applyReviewEvent, type ReviewEvent } from './data/live';
import { noteReact, type ReactEvent } from './data/react';
import type { CheckReport, Data } from './data/types';

export type {
  Metrics,
  DetailResult,
  Region,
  A11yViolation,
  MaskRecord,
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
  A11yDecision,
  Rejection,
  IntegrityIssue,
  IntegrityEntry,
  IntegrityComponent,
  IntegrityLedger,
  Data,
} from './data/types';
export type {
  ReactAlert,
  ReactData,
  ReactDiagnostic,
  ReactFunction,
  ReactReport,
  ReactSide,
  ReactSummary,
  RenderCounts,
} from './data/react-types';
export {
  analyseReact,
  cancelCheck,
  dismissReact,
  measureRenders,
  skipReact,
  useReactActivity,
  type ReactActivity,
} from './data/react';
export { served } from './data/request';
export { useProjects, type ProjectInfo } from './data/projects';
export {
  reviewAction,
  a11yAction,
  dismissRejection,
  recheck,
  approveStory,
  repairSafe,
  type DecisionAnswer,
} from './data/actions';
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
  // Neither a project nor a story named: with several projects, the first one (data/projects.ts).
  if (!currentProject && !query.get('story')) await nameFirstProject();
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
    // One fetch in flight and at most one waiting: a burst of events costs two fetches, not one each.
    let fetching = false;
    let again = false;
    // The data on the page, which a decision's event is applied to.
    let latest: Data | null = window.PXSIG ? normalizeData(window.PXSIG) : null;
    const show = (d: Data) => {
      latest = d;
      setData(d);
    };
    const load = (): void => {
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      fetchData()
        .then((d) => alive && (show(d), setError(null)))
        .catch(
          // fetchData rejects with an Error (its own, fetch's or normalizeData's).
          (e: Error) => alive && !window.PXSIG && setError(String(e.message ?? e))
        )
        .finally(() => {
          fetching = false;
          if (again && alive) {
            again = false;
            load();
          }
        });
    };
    load();
    let es: EventSource | null = null;
    // Events name their project; another project's results don't concern this page.
    // An event's data is the JSON object the server broadcast (serve.mjs), naming its project.
    const parse = (e: MessageEvent<string>): ReviewEvent | null => {
      try {
        return JSON.parse(e.data) as ReviewEvent | null;
      } catch {
        return null;
      }
    };
    const ours = (ev: ReviewEvent | null) =>
      !ev?.project || !currentProject || ev.project === currentProject;
    const mine = (e: MessageEvent<string>) => {
      if (ours(parse(e))) load();
    };
    // A decision carries what it changed: applied in place, unless a fetch is under way (its
    // answer may predate the decision, so another follows it) or the page cannot apply it.
    const decided = (e: MessageEvent<string>) => {
      const ev = parse(e);
      if (!ours(ev)) return;
      const next = ev && !fetching && latest ? applyReviewEvent(latest, ev) : null;
      if (next) show(normalizeData(next));
      else load();
    };
    try {
      es = new EventSource('/__pxsig/events');
      es.addEventListener('hello', () => setLive(true));
      es.addEventListener('data', mine);
      es.addEventListener('review', decided);
      es.addEventListener('integrity', mine);
      // An open rejection opened, changed (its packet written, a check since) or closed.
      es.addEventListener('rejection', mine);
      // Check runs: shown while they run, and their errors (Storybook down) reach the page.
      es.addEventListener('check', (e: MessageEvent<string>) => {
        try {
          const d = JSON.parse(e.data) as CheckEvent;
          if (!d?.project || !currentProject || d.project === currentProject) noteCheck(d);
        } catch {
          /* not ours */
        }
      });
      // The React analysis' progress and end (serve/react.mjs).
      es.addEventListener('react', (e: MessageEvent<string>) => {
        const d = parse(e) as ReactEvent | null;
        if (d && (!d.project || !currentProject || d.project === currentProject)) noteReact(d);
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
  /** The run going on counts React renders (Measure renders). */
  renders: boolean;
  /** How far the run going on is (entries rendered of all), once it reports it. */
  progress: { done: number; total: number } | null;
  /** How the last Measure renders run ended, until dismissed or the next run starts. */
  measured: { cancelled: boolean; done: number; total: number; ids: string[] } | null;
  /** The last run's error (Storybook down, a broken index), until dismissed or a run succeeds. */
  error: { message: string; setup: boolean } | null;
}
let activity: CheckActivity = {
  running: null,
  renders: false,
  progress: null,
  measured: null,
  error: null,
};
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
  renders?: boolean;
  done?: number;
  total?: number;
};
const idle = { running: null, renders: false, progress: null } as const;
function noteCheck(d: CheckEvent) {
  const total = d.total ?? activity.progress?.total ?? activity.running?.length ?? 0;
  if (d.state === 'running')
    setActivity({
      ...activity,
      running: d.ids ?? [],
      renders: !!d.renders,
      progress: null,
      ...(d.renders ? { measured: null } : {}),
    });
  else if (d.state === 'progress')
    setActivity({ ...activity, progress: { done: d.done ?? 0, total: d.total ?? 0 } });
  else if (d.state === 'done' || d.state === 'cancelled')
    setActivity({
      ...idle,
      measured: activity.renders
        ? {
            cancelled: d.state === 'cancelled',
            done: d.done ?? d.ids?.length ?? 0,
            total,
            ids: d.ids ?? activity.running ?? [],
          }
        : activity.measured,
      error: null,
    });
  else if (d.state === 'error')
    setActivity({
      ...idle,
      measured: activity.measured,
      error: { message: d.error ?? '', setup: !!d.setup },
    });
}
export const dismissCheckError = () => setActivity({ ...activity, error: null });
/** Forget how the last Measure renders run ended (Dismiss). */
export const dismissMeasured = () => setActivity({ ...activity, measured: null });
export function useCheckActivity(): CheckActivity {
  return React.useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => activity,
    () => activity
  );
}
