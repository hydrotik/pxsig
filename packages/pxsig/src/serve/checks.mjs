/**
 * serve/checks.mjs — on-demand checks (dashboard, addon, watch): the queue, with names the manifest
 * lacks registered first, and the run that renders, checks and merges the rows into check.json.
 * A run reports its progress (`check` events, `progress`), can count React renders (Measure
 * renders) and can be cancelled (`check/cancel`): the entries rendered by then keep their new
 * results, the others their last ones.
 */
import { join } from 'node:path';
import { browserPool, renderStories, STORYBOOK_ERROR } from '../lib/capture.mjs';
import { annotateRow, byId, envConfig } from '../lib/env.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { fetchStoryIndex, loadStoryIndex } from '../lib/integrity.mjs';
import { defaultHooks, registerNamed } from '../lib/repair.mjs';
import { buildRow, stampRenders, storybookBroken } from '../lib/rows.mjs';
import { PXSIG_VERSION } from '../lib/workspace.mjs';
import { scheduleIntegrity } from './integrity.mjs';
import { needLock } from './projects.mjs';
import { rejectionsAfterCheck } from './rejections.mjs';
import { updateCheckRows } from './report-rows.mjs';
/**
 * @import { A11yBaseline, A11yReviewFile, CheckReport, Enqueued, RequestBody, ReviewFile, SetupError
 * } from '../types/t5.js'
 */
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/**
 * @param {ProjectState} S
 * @param {ServeContext} srv
 */
export async function runChecks(srv, S) {
  if (S.running || !S.queued.size) return S.running;
  let ids = [...S.queued];
  S.queued = new Set();
  S.checking = new Set(ids);
  // Measure renders asked for this run; a check queued after it waits for the next run.
  const renders = S.measure;
  S.measure = false;
  const cancel = new AbortController();
  S.cancel = cancel;
  const { P } = S;
  const seq = ++S.runs;
  S.running = (async () => {
    const t0 = performance.now();
    srv.broadcast('check', {
      project: S.name,
      state: 'running',
      ids,
      ...(renders ? { renders: true } : {}),
    });
    try {
      S.reload();
      // The manifest stopped loading since these ids were queued: say why, render nothing.
      // Rejected rather than thrown: it lands after `S.running` is set, so `finally` clears it.
      if (!S.runPath)
        await Promise.reject(
          Object.assign(
            new Error(`setup error: the manifest did not load — ${S.error}. Nothing was rendered.`),
            { setup: true }
          )
        );
      const manifest = S.manifest;
      const entries = manifest.stories.filter((e) => ids.includes(e.id));
      // Guard: a broken Storybook index makes every render its error page. Refuse, record nothing.
      const idx = await fetchStoryIndex(manifest.baseUrl);
      if (!idx.healthy)
        throw Object.assign(
          new Error(
            `setup error: ${idx.reachable ? "Storybook's story index is broken" : 'Storybook is not reachable'} — ${idx.error}. Nothing was rendered.`
          ),
          { setup: true }
        );
      srv.pool ??= browserPool(P);
      const concurrency = Math.min(8, entries.length);
      const envCfg = envConfig(P.config);
      const engineVersion = await srv
        .rust('ping', {})
        .then((p) => p.version ?? null)
        .catch(() => null);
      const current = await srv.pool.envs(
        entries.map((e) => e.browser ?? 'chromium'),
        { fontProbe: envCfg.fontProbe, pxsig: PXSIG_VERSION, engine: engineVersion }
      );
      let tick = 0;
      const rendered = await renderStories(srv.pool, entries, P.store.latest, {
        ...manifest,
        concurrency,
        project: P,
        a11y: true,
        // Measure renders counts them also when `react.renders` is off (never when React is).
        ...(renders ? { renders: true } : {}),
        signal: cancel.signal,
        // At most four progress events a second, and the last one.
        onEntry(done) {
          if (done < entries.length && Date.now() - tick < 250) return;
          tick = Date.now();
          srv.broadcast('check', {
            project: S.name,
            state: 'progress',
            done,
            total: entries.length,
          });
        },
      });
      const { wallMs, reloads } = rendered;
      // Cancelled: only the entries rendered by then are checked and recorded.
      const results = rendered.results.filter(Boolean);
      const cancelled = cancel.signal.aborted;
      if (cancelled) {
        const done = new Set(results.map((r) => r.id));
        ids = ids.filter((id) => done.has(id));
      }
      if (cancelled && !ids.length) {
        console.log(`[serve] ${S.name}: check cancelled before any entry was rendered`);
        srv.broadcast('check', {
          project: S.name,
          state: 'cancelled',
          ids,
          done: 0,
          total: entries.length,
        });
        return;
      }
      const sbErrors = results.filter((r) => r.error?.startsWith(STORYBOOK_ERROR));
      if (storybookBroken(sbErrors.length, results.length))
        throw Object.assign(
          new Error(
            `setup error: ${sbErrors.length} of ${results.length} renders hit Storybook's error page (${/** @type {string} */ (sbErrors[0].error).slice(STORYBOOK_ERROR.length).trim()}). Nothing was recorded.`
          ),
          { setup: true }
        );
      if (manifest.trim)
        await srv.rust('trim', {
          dir: P.store.latest,
          only: ids,
          pad: manifest.trim.pad ?? 16,
          tolerance: manifest.trim.tolerance ?? 8,
        });
      const res = await srv.rust('check', {
        manifest: S.runPath,
        pngDir: P.store.latest,
        root: P.workspaceRoot,
        only: ids,
        outDir: P.store.diffLatest,
        cache: join(P.store.cache, 'check'),
        // Re-checks are runs too: the History tab and pxsig_history read this.
        history: join(P.store.reports, 'history.ndjson'),
      });
      for (const g of res.summary.identicalRenders ?? [])
        console.error(
          `[serve] ${S.name}: ${g.count} failing entries rendered the same image (${g.ids.slice(0, 3).join(', ')}…): marked as errors, nothing to approve`
        );
      const rustRows = new Map(res.results.map((r) => [r.id, r]));
      // Render counts: when, and the counts of the row each one replaces.
      const before = new Map(
        /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.map((r) => [r.id, r])
      );
      const at = new Date().toISOString();
      const byRender = new Map(results.map((r) => [r.id, r]));
      const a11yBase = /** @type {A11yBaseline | null} */ (readJson(P.store.a11y, null));
      const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
      for (const id of ids) delete rv[id]; // a fresh verdict replaces a decision on the old one
      writeJson(S.reviewPath, rv, { pretty: true });
      const av = /** @type {A11yReviewFile} */ (readJson(S.a11yReviewPath, {}));
      for (const id of ids) delete av[id];
      writeJson(S.a11yReviewPath, av, { pretty: true });
      const envs = { ...res.baselineEnvs, ...byId(current) };
      const fresh = new Map(
        entries
          .filter((e) => byRender.has(e.id))
          .map((e) => [
            e.id,
            stampRenders(
              annotateRow(buildRow(e, rustRows.get(e.id), byRender.get(e.id), a11yBase, manifest), {
                current,
                envs,
                ignore: envCfg.ignore,
              }),
              before.get(e.id),
              at
            ),
          ])
      );
      const full = !cancelled && entries.length === manifest.stories.length;
      const timing = full
        ? {
            concurrency,
            renderWallMs: wallMs,
            pageLoads: reloads,
            rustEngineMs: res.summary.elapsedMs,
            totalMs: performance.now() - t0,
          }
        : null;
      updateCheckRows(S, (r) => fresh.get(r.id), fresh, timing, envs);
      // Open rejections outlive the decisions cleared above: a pass closes one, else it gains the check.
      rejectionsAfterCheck(srv, S, fresh.values());
      const failed = [...fresh.values()].filter((r) => !r.pass).length;
      console.log(
        `[serve] ${S.name}: re-checked ${ids.length} entries · ${failed} changed · ${((performance.now() - t0) / 1000).toFixed(1)} s (Rust ${res.summary.elapsedMs.toFixed(0)} ms)`
      );
      srv.broadcast('check', {
        project: S.name,
        state: cancelled ? 'cancelled' : 'done',
        ids,
        failed,
        ms: performance.now() - t0,
        ...(cancelled ? { done: ids.length, total: entries.length } : {}),
      });
      srv.broadcast('data', { project: S.name });
    } catch (e) {
      // What a check throws is an Error: a setup error carries `setup`.
      console.error(`[serve] ${S.name}: check failed: ${/** @type {SetupError} */ (e).message}`);
      S.lastFailure = {
        seq,
        error: /** @type {SetupError} */ (e).message,
        setup: !!(/** @type {SetupError} */ (e).setup),
        ids: ids.length,
        at: new Date().toISOString(),
      };
      srv.broadcast('check', {
        project: S.name,
        state: 'error',
        ids,
        error: /** @type {SetupError} */ (e).message,
        setup: !!(/** @type {SetupError} */ (e).setup),
      });
    } finally {
      S.running = null;
      S.checking = null;
      S.cancel = null;
      if (S.queued.size) void runChecks(srv, S);
      else scheduleIntegrity(srv, S, 'check', 0);
    }
  })();
  return S.running;
}

/**
 * Queue a check. Names (ids or stories) the manifest does not have are registered first when
 * Storybook is healthy (NEW entries, no signature), so checking a new story is one request;
 * anything that cannot be registered comes back in `skipped`, with why.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {RequestBody} body `{ ids?, story?, stories?, all?, via? }`
 * @returns {Promise<Enqueued>}
 */
export async function enqueue(srv, S, body) {
  needLock(srv, S);
  // Select against the manifest on disk: entries added since the server started (or since the
  // last check) would otherwise be dropped as unknown. A running check keeps the one it started with.
  if (!S.running) S.reload();
  /** @param {unknown} v */
  const asked = (v) =>
    Array.isArray(v) ? v.filter((/** @type {unknown} */ x) => typeof x === 'string') : [];
  const ids = new Set(asked(body.ids));
  const stories = new Set([
    ...asked(body.stories),
    ...(typeof body.story === 'string' ? [body.story] : []),
  ]);
  /** @param {string} name */
  const known = (name) =>
    S.manifest.stories.some((e) => e.id === name || (e.story ?? e.id) === name);
  const unknown = [...new Set([...ids, ...stories])].filter((n) => !known(n));
  /** @type {Awaited<ReturnType<typeof registerNamed>>} */
  let registered = { added: [], stories: [], skipped: [] };
  if (unknown.length && !body.all) {
    const index = await loadStoryIndex(S.ctx);
    registered = await registerNamed(S.ctx, unknown, {
      index,
      harvest: defaultHooks(S.ctx).harvest,
      via:
        typeof body.via === 'string'
          ? body.via.replace(/[^\w-]/g, '').slice(0, 20) || 'server'
          : 'server',
    });
    if (registered.added.length) {
      S.reload();
      console.log(
        `[serve] ${S.name}: registered ${registered.stories.join(', ')} (${registered.added.length} NEW entries) to check them`
      );
    }
    for (const story of registered.stories) stories.add(story);
  }
  for (const e of S.manifest.stories) if (body.all || stories.has(e.story ?? e.id)) ids.add(e.id);
  const queued = [...ids].filter((id) => S.manifest.stories.some((e) => e.id === id));
  queued.forEach((id) => S.queued.add(id));
  // Measure renders: the run that takes these counts React renders.
  if (body.renders === true && queued.length) S.measure = true;
  void runChecks(srv, S);
  if (registered.added.length) scheduleIntegrity(srv, S, 'registered', 0);
  return { queued, registered: registered.added, skipped: registered.skipped };
}
