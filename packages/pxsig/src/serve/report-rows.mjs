/**
 * serve/report-rows.mjs — check.json as the server rewrites it: a decision's or a re-check's rows
 * merged in and recounted, and rows of entries no longer in the manifest dropped.
 */
import { readJson, writeJson } from '../lib/files.mjs';
import { dropStaleRows, summarize } from '../lib/rows.mjs';
import { envSummary } from '../lib/env.mjs';
/** @import { CheckRow, EnvRecord } from '../types.js' */
/** @import { CheckReport, CheckTiming } from '../types/t5.js' */
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */
/** @typedef {{ check: CheckReport, dropped: string[] }} Written */

/**
 * Rewrite check.json's rows with `mut` (null keeps a row), add `fresh` rows it lacks, recount.
 * @param {ProjectState} S
 * @param {(row: CheckRow) => CheckRow | null | undefined} mut
 * @param {Map<string, CheckRow>} [fresh]
 * @param {CheckTiming | null} [timing]
 * @param {Record<string, EnvRecord> | null} [envs]
 * @returns {Written} the report as written, and the ids of the rows it dropped
 */
export function updateCheckRows(S, mut, fresh = new Map(), timing = null, envs = null) {
  // check.json is this server's (or a CLI check's) own file.
  const check = /** @type {CheckReport | null} */ (readJson(S.checkPath, null)) ?? {
    generatedAt: new Date().toISOString(),
    project: S.name,
    summary: {},
    rows: [],
  };
  // Every environment a row names (lib/env.mjs), by id: the fresh rows' and their baselines'.
  if (envs) check.envs = { ...check.envs, ...envs };
  const seen = new Set(check.rows.map((r) => r.id));
  check.rows = check.rows.map((r) => mut(r) ?? r);
  // Entries added after the last full check have no row yet: append them, or their verdicts are
  // computed and silently dropped.
  const add = [...fresh.values()].filter((r) => !seen.has(r.id));
  if (add.length) {
    const order = new Map(S.manifest.stories.map((e, i) => [e.id, i]));
    check.rows = [...check.rows, ...add].sort(
      (a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)
    );
  }
  const dropped = S.runPath ? dropStaleRows(check, S.manifest) : [];
  if (dropped.length)
    console.log(`[serve] ${S.name}: dropped ${dropped.length} rows no longer in the manifest`);
  // Timings describe one run: a full re-check replaces them; a partial one leaves the last full
  // run's (the Duration card and Diagnostics read them against `checked`).
  check.summary = {
    ...check.summary,
    ...summarize(check.rows),
    ...envSummary(check.rows, check.envs ?? {}),
    ...timing,
  };
  if (!check.summary.envMismatch) delete check.summary.envFields;
  // New verdicts move the report's time ("Last check"); `fullCheckAt` keeps when every entry was
  // last checked together, which is what integrity's "absent from the last full check" means.
  if (fresh.size) {
    const now = new Date().toISOString();
    check.fullCheckAt = timing ? now : (check.fullCheckAt ?? check.generatedAt);
    check.generatedAt = now;
  }
  S.quietUntil = Date.now() + 800;
  writeJson(S.checkPath, check);
  return { check, dropped };
}

/**
 * What a decision's `review` event carries about check.json, so an open page patches its data
 * instead of fetching all of it again: the entry's rewritten row and the recounted summary. Empty
 * when check.json was not rewritten; `refetch` when rows were dropped too (the page reloads).
 * @param {Written | null} written
 * @param {string} id
 * @returns {{ row?: CheckRow | null, summary?: CheckReport['summary'], refetch?: true }}
 */
export const checkPatch = (written, id) =>
  !written
    ? {}
    : written.dropped.length
      ? { refetch: true }
      : {
          row: written.check.rows.find((r) => r.id === id) ?? null,
          summary: written.check.summary,
        };

/**
 * Drops check rows for entries no longer in the manifest (a story removed on another branch), on
 * start and whenever the manifest is reloaded. Only with the store lock and a manifest that loaded.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 */
export function pruneStaleRows(srv, S) {
  if (!S.lock || !S.runPath) return;
  const check = /** @type {CheckReport | null} */ (readJson(S.checkPath, null));
  if (!check) return;
  const dropped = dropStaleRows(check, S.manifest);
  if (!dropped.length) return;
  S.quietUntil = Date.now() + 800;
  writeJson(S.checkPath, check);
  console.log(
    `[serve] ${S.name}: dropped ${dropped.length} rows no longer in the manifest (${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? ', …' : ''})`
  );
  srv.broadcast('data', { project: S.name });
}
