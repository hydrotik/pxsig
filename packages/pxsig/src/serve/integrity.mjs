/**
 * serve/integrity.mjs — integrity, always on: the ledger recomputed (on start, on a file change,
 * after a check), its runs debounced, and each story's worst status for the addon.
 */
import { loadStoryIndex, oneLine, reconcile, writeLedger } from '../lib/integrity.mjs';
import { pruneStaleRows } from './report-rows.mjs';
import { REUSE } from './traces.mjs';
/** @import { StoryIntegrity } from '../types/t5.js' */
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} why
 */
export async function runIntegrity(srv, S, why) {
  if (S.integrityRunning || S.running) return scheduleIntegrity(srv, S, why, 1500);
  S.integrityRunning = true;
  /** @type {((value?: unknown) => void) | undefined} */
  let done;
  S.integrityDone = new Promise((r) => (done = r));
  try {
    S.reload();
    pruneStaleRows(srv, S);
    const idx = await loadStoryIndex(S.ctx);
    // A pass for a baseline or a render reuses the last pass's tracing (serve/traces.mjs).
    if (!REUSE.has(why)) S.traces.clear();
    const affected = S.traces.tracer(S, S.ctx.repoRoot);
    const ledger = await reconcile(S.ctx, { index: idx, affected });
    const before = S.integrity?.summary?.headline;
    S.integrity = ledger;
    // The ledger is the store's file: only the lock holder writes it (a second, read-only server
    // beside another process's keeps its ledger in memory).
    if (S.lock) {
      S.quietUntil = Date.now() + 800;
      writeLedger(S.ctx, ledger);
    }
    if (before !== ledger.summary.headline)
      console.log(`[serve] ${S.name}: ${oneLine(ledger)} (${why}, ${ledger.elapsedMs} ms)`);
    srv.broadcast('integrity', { project: S.name, summary: ledger.summary, setup: ledger.setup });
  } catch (e) {
    // reconcile throws Errors (no readable manifest, an engine error).
    console.error(`[serve] ${S.name}: integrity failed: ${/** @type {Error} */ (e).message}`);
  } finally {
    S.integrityRunning = false;
    // Set by the promise's executor, which runs at once.
    /** @type {(value?: unknown) => void} */ (done)();
  }
}
/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} why
 * @param {number} [ms]
 */
export function scheduleIntegrity(srv, S, why, ms = 1500) {
  // clearTimeout(null) does nothing, as clearTimeout(undefined) does.
  clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (S.integrityTimer));
  S.integrityTimer = setTimeout(() => runIntegrity(srv, S, why), ms);
}

/**
 * Per-story integrity for the addon: the worst status of the story's entries, with their codes.
 * @param {ServeContext} srv
 */
export function storyIntegrity(srv) {
  /** @type {Record<string, StoryIntegrity | undefined>} */
  const out = {};
  /** @type {Record<string, number>} */
  const sev = { error: 0, warn: 1, info: 2 };
  for (const S of srv.states.values()) {
    if (!S.integrity) continue;
    for (const x of S.integrity.entries) {
      const s = (out[x.story] ??= /** @type {StoryIntegrity} */ ({
        status: 'ok',
        severity: 'info',
        project: S.name,
        component: x.component,
        codes: {},
      }));
      for (const i of x.issues) s.codes[i.code] = (s.codes[i.code] ?? 0) + 1;
      if (sev[x.severity] < sev[s.severity] || (x.severity === s.severity && s.status === 'ok'))
        Object.assign(s, { status: x.status, severity: x.severity });
    }
  }
  return out;
}
