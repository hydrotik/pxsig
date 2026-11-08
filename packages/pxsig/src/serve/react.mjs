/**
 * serve/react.mjs — the React analysis in the server: after the startup integrity pass, on save in
 * watch mode and on request (the dashboard's Analyse), one run at a time per project, with its
 * progress and Skip on `react` events; what the server adds to `data.react`; and the routes a
 * person uses from the dashboard's React view (react/analyse, react/skip, check/cancel).
 *
 * Alerts only: nothing here writes a baseline, an approval or an accepted list. The runs still
 * need the dashboard link (a page opened with it): they replace results or stop work a person
 * started. Only the store lock's holder saves `reports/react.json` (lib/react/index.mjs); a
 * read-only server keeps its run's results in memory and says who holds the store.
 */
import { hasLink, NEEDS_LINK_CODE, NEEDS_LINK_RUN } from '../lib/guard.mjs';
import { analyse } from '../lib/react/index.mjs';
import { configWarning, reactConfig } from '../lib/react/config.mjs';
import { missingPeers } from '../lib/react/data.mjs';
import { json } from './http.mjs';
/** @import { AddressInfo } from 'node:net' */
/** @import { ReactLive, ReactReport } from '../types/react.js' */
/** @import { Route, RouteContext, ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/** `react` progress events at most this often (ms); the last one always goes. */
const TICK = 250;

/**
 * One project's analysis state (ProjectState `react`).
 * @typedef {object} ReactState
 * @property {{ trigger: string, ctl: AbortController, done: number, total: number, cached: number } | null} run
 * @property {string | null} again a trigger that came while a run was going: one more run after it
 * @property {string | null} error the last run failed: why
 * @property {boolean} skipped the last run was skipped
 * @property {string | null} held the last run's results were not saved: the store's holder
 * @property {string | null} wrote `generatedAt` of the react.json this server wrote last
 * @property {ReactReport | null} report a run's results, when they could not be saved
 * @property {string[] | null} missing the packages the analysis needs and the project lacks
 * @property {{ files: Set<string>, since: string } | null} edits source edits since the last analysis
 */

/** @returns {ReactState} */
export const reactState = () => ({
  run: null,
  again: null,
  error: null,
  skipped: false,
  held: null,
  wrote: null,
  report: null,
  missing: null,
  edits: null,
});

/**
 * What the server knows, for `data.react` (lib/react/data.mjs).
 * @param {ProjectState} S
 * @returns {ReactLive}
 */
export function liveOf(S) {
  const R = S.react;
  return {
    running: !!R.run,
    error: R.error,
    skipped: R.skipped,
    held: R.held,
    stale: R.edits ? { files: R.edits.files.size, since: R.edits.since } : null,
    missing: (R.missing ??= missingPeers(S.P)),
    wrote: R.wrote,
    report: R.report,
  };
}

/**
 * A source file changed: the results are out of date until the next analysis.
 * @param {ProjectState} S
 * @param {string} file
 */
export function sourceEdited(S, file) {
  const R = S.react;
  (R.edits ??= { files: new Set(), since: new Date().toISOString() }).files.add(file);
}

/**
 * Why the analysis cannot run for this project now, or null.
 * @param {ProjectState} S
 */
function refusal(S) {
  const cfg = reactConfig(S.P);
  const bad = configWarning(cfg);
  if (bad) return bad.replace(/^\[pxsig\] /, '');
  if (cfg.off) return `React analysis is off (${cfg.off})`;
  if (!cfg.compiler) return 'compiler analysis is off (react.compiler: false)';
  // Looked up again for each run: the packages may have been installed since.
  const missing = (S.react.missing = missingPeers(S.P, cfg));
  if (missing.length) return `compiler analysis needs ${missing.join(' and ')} in this project`;
  if (!S.runPath) return `the manifest did not load: ${S.error}`;
  return null;
}

/**
 * Start an analysis (`trigger`: startup, watch, analyse); a run already going takes one more after
 * it. Compared with `main`, as `pxsig react` is by default.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {'startup' | 'watch' | 'analyse'} trigger
 * @returns {{ refused: string } | { queued: true } | { started: true }}
 */
export function startReact(srv, S, trigger) {
  const R = S.react;
  const no = refusal(S);
  if (no) return { refused: no };
  if (R.run) {
    R.again = trigger;
    return { queued: true };
  }
  const run = { trigger, ctl: new AbortController(), done: 0, total: 0, cached: 0 };
  R.run = run;
  // The edits this run covers; an edit while it runs keeps the results out of date.
  const covered = R.edits;
  R.edits = null;
  let last = 0;
  /** @param {boolean} [now] */
  const tell = (now = false) => {
    if (!now && Date.now() - last < TICK) return;
    last = Date.now();
    srv.broadcast('react', {
      project: S.name,
      state: 'running',
      trigger,
      files: { done: run.done, total: run.total },
      cached: run.cached,
    });
  };
  tell(true);
  void analyse(S.P, {
    manifest: /** @type {string} */ (S.runPath),
    // Two workers: the browsers of a check may be rendering beside it.
    workers: 2,
    signal: run.ctl.signal,
    onProgress(p) {
      Object.assign(run, p);
      tell(p.done === p.total);
    },
  })
    .catch((/** @type {Error} */ e) => ({
      ran: /** @type {const} */ (false),
      why: /** @type {const} */ ('failed'),
      text: `react: analysis failed (${e.message}): nothing compared`,
    }))
    .then((r) => {
      if (r.ran) {
        Object.assign(R, {
          error: null,
          skipped: false,
          held: r.heldBy,
          report: r.heldBy ? r.report : null,
          wrote: r.heldBy ? R.wrote : r.report.generatedAt,
        });
        const s = r.report.summary;
        console.log(
          `[serve] ${S.name}: react: ${s.files} files, ${s.functions} functions · ${s.alerts} alerts${r.heldBy ? ` · not saved: ${r.heldBy}` : ''}`
        );
        srv.broadcast('react', { project: S.name, state: 'done', summary: s, ms: s.ms });
        srv.broadcast('data', { project: S.name });
        return;
      }
      // Not analysed: the edits it was to cover still are not.
      if (covered) for (const f of covered.files) sourceEdited(S, f);
      if (R.edits && covered) R.edits.since = covered.since;
      if (r.why === 'failed') {
        R.error = r.text.replace(/^react: analysis failed \((.*)\): nothing compared$/, '$1');
        console.error(`[serve] ${S.name}: ${r.text}`);
        srv.broadcast('react', { project: S.name, state: 'error', error: R.error });
      } else if (r.why === 'skipped') {
        R.skipped = true;
        srv.broadcast('react', { project: S.name, state: 'skipped' });
      }
      // Otherwise switched off (or uninstalled) since it was asked for: `data` says so.
      srv.broadcast('data', { project: S.name });
    })
    .finally(() => {
      R.run = null;
      const again = R.again;
      R.again = null;
      if (again) startReact(srv, S, /** @type {'startup' | 'watch' | 'analyse'} */ (again));
    });
  return { started: true };
}

/**
 * The runs a person starts from the dashboard need a page opened with its link.
 * @param {RouteContext} cx
 */
export const linked = ({ srv, req }) =>
  hasLink(req.headers, srv.links, /** @type {AddressInfo} */ (srv.server.address()).port);

/** @param {RouteContext} cx */
const noLink = ({ res }) => json(res, 403, { error: NEEDS_LINK_RUN, code: NEEDS_LINK_CODE });

/** @type {[string, Route][]} */
export const reactRoutes = [
  // POST /__pxsig/react/analyse {project}: the compiler analysis now (link only); 202, 409 when it cannot run
  [
    'react/analyse',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      run(cx) {
        if (!linked(cx)) return noLink(cx);
        const r = startReact(cx.srv, cx.S, 'analyse');
        if ('refused' in r) return json(cx.res, 409, { error: r.refused });
        return json(cx.res, 202, { ok: true, project: cx.S.name, queued: 'queued' in r });
      },
    },
  ],
  // POST /__pxsig/react/skip {project}: stop the running analysis; nothing is written (link only)
  [
    'react/skip',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      run(cx) {
        if (!linked(cx)) return noLink(cx);
        const R = cx.S.react;
        R.again = null;
        R.run?.ctl.abort();
        return json(cx.res, 200, { ok: true, project: cx.S.name, skipped: !!R.run });
      },
    },
  ],
  // POST /__pxsig/check/cancel {project}: stop the running check; finished entries keep their results
  [
    'check/cancel',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      run(cx) {
        if (!linked(cx)) return noLink(cx);
        const { S } = cx;
        if (!S.running || !S.cancel) return json(cx.res, 409, { error: 'no check is running' });
        S.cancel.abort();
        return json(cx.res, 200, { ok: true, project: S.name, cancelling: true });
      },
    },
  ],
];
