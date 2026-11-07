/**
 * The server's React analysis as its `react` events report it (serve/react.mjs), and the runs a
 * person starts from the React view. The runs need the dashboard link (the page's cookie, sent
 * with every request to the server): without it the server refuses them, and the page shows them
 * disabled while it is read only.
 */
import React from 'react';
import { type Refusal, withProject } from './request';
import type { ReactSummary } from './react-types';

/** A run's progress, or how the last one ended (until the next one starts). */
export interface ReactActivity {
  /** The run going on now: what started it and how far it is. */
  running: { trigger: string; done: number; total: number; cached: number } | null;
  /** How the last run ended, while no other has started. */
  ended:
    | { state: 'done'; summary: ReactSummary }
    | { state: 'skipped'; at: string }
    | { state: 'error'; error: string }
    | null;
}

let activity: ReactActivity = { running: null, ended: null };
const listeners = new Set<() => void>();
const set = (next: ReactActivity) => {
  activity = next;
  for (const l of listeners) l();
};

/** A `react` event's data (serve/react.mjs). */
export type ReactEvent = {
  project?: string;
  state?: string;
  trigger?: string;
  files?: { done: number; total: number };
  cached?: number;
  summary?: ReactSummary;
  error?: string;
};

/** One `react` event, already known to be this page's project. */
export function noteReact(d: ReactEvent) {
  if (d.state === 'running')
    set({
      running: {
        trigger: d.trigger ?? 'analyse',
        done: d.files?.done ?? 0,
        total: d.files?.total ?? 0,
        cached: d.cached ?? 0,
      },
      ended: null,
    });
  else if (d.state === 'done' && d.summary)
    set({ running: null, ended: { state: 'done', summary: d.summary } });
  else if (d.state === 'skipped')
    set({ running: null, ended: { state: 'skipped', at: new Date().toISOString() } });
  else if (d.state === 'error')
    set({ running: null, ended: { state: 'error', error: d.error ?? '' } });
}

/** Forget how the last run ended (Dismiss). */
export const dismissReact = () => set({ ...activity, ended: null });

export function useReactActivity(): ReactActivity {
  return React.useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => activity,
    () => activity
  );
}

/** A run a person starts: posted with the page's cookie; a refusal's `error` is thrown. */
async function run(path: string, body: object): Promise<Record<string, unknown>> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: withProject(body),
  });
  // The server's answer (server.md); a body that is not JSON reads as {}.
  const answer = await (r.json() as Promise<Record<string, unknown> & Refusal>).catch(
    (): Refusal => ({})
  );
  if (!r.ok) throw new Error(answer.error || r.statusText);
  return answer;
}

/** Run the React Compiler analysis now (Diagnostics › React › Compiler, Analyse). */
export const analyseReact = () => run('/__pxsig/react/analyse', {});
/** Stop the running analysis; nothing is written (Skip). */
export const skipReact = () => run('/__pxsig/react/skip', {});
/** Render `ids` again with React render counting on: a visual check (Measure renders). */
export const measureRenders = (ids: string[]) => run('/__pxsig/check', { ids, renders: true });
/** Stop the running check; the entries rendered by then keep their new results (Cancel). */
export const cancelCheck = () => run('/__pxsig/check/cancel', {});
