/**
 * serve/a11y.mjs — accessibility decisions through the server: accept, reject, unaccept and
 * unreview an entry's axe violations, and `pxsig a11y --prune` for the store the server holds.
 */
import { dirname, join } from 'node:path';
import { decisionRef, newBatch, ownBatch, stamp } from '../lib/approvals.mjs';
import { appendLine, readJson, writeJson } from '../lib/files.mjs';
import { keepReason, reportsIgnoredAsync } from '../lib/decisions.mjs';
import { applyPrune } from '../lib/prune.mjs';
import { httpError } from './http.mjs';
import { needLock } from './projects.mjs';
import { checkPatch, updateCheckRows } from './report-rows.mjs';
import { agentMayClearRejection, closeAfter, rejectWithNote } from './rejections.mjs';
import { agentMayClear } from './review.mjs';
/** @import { Project } from '../types.js' */
/**
 * @import { A11yBaseline, A11yReviewFile, CheckReport, DecisionMeta, RequestBody } from '../types/t5.js'
 */
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */
/** @import { Written } from './report-rows.mjs' */

// Separate from the visual verdict: accepting puts an entry's current axe violations on its
// accepted list (<store>/a11y.json); rejecting marks them for a fix, with an optional reason that
// stays open past the check (serve/rejections.mjs). Both decisions last until the next check of
// the entry, like review.json. Every accept and undo is logged beside a11y.json, with the
// decision's opaque reference; an accept's reason stays in the git-ignored reports/
// (lib/decisions.mjs), never on the line.

/**
 * @param {Project} P
 * @param {Record<string, unknown> & { via: string }} line
 */
export const a11yLog = (P, line) =>
  appendLine(join(dirname(P.store.a11y), 'a11y-decisions.ndjson'), stamp(line));
/**
 * @param {Project} P
 * @param {A11yBaseline} base
 */
export const writeA11y = (P, base) => writeJson(P.store.a11y, base, { pretty: true });

/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} action `a11y-accept`, `a11y-reject`, `a11y-unaccept` or `a11y-unreview`
 * @param {string} id
 * @param {DecisionMeta} [meta]
 */
export async function a11yReview(srv, S, action, id, meta = {}) {
  needLock(srv, S);
  const { P, manifest } = S;
  if (!manifest.stories.some((e) => e.id === id)) throw httpError(404, `unknown entry ${id}`);
  // Asked before anything is read, and only for an accept with a reason: no spawn otherwise.
  const ignored = action === 'a11y-accept' && meta.reason ? await reportsIgnoredAsync(P) : false;
  // a11y-review.json and a11y.json are pxsig's own files.
  const av = /** @type {A11yReviewFile} */ (readJson(S.a11yReviewPath, {}));
  const base = /** @type {A11yBaseline} */ (readJson(P.store.a11y, {}));
  const at = new Date().toISOString();
  const via = meta.via ?? 'dashboard';
  const ref = decisionRef();
  /** @type {Written | null} */
  let written = null;
  if (action === 'a11y-accept') {
    const row = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.find(
      (r) => r.id === id
    );
    if (!row?.a11y?.violations)
      throw httpError(409, `no accessibility results for ${id}; run a check`);
    const before = base[id] ?? null;
    const after = row.a11y.violations.map((v) => v.id).sort();
    base[id] = after;
    writeA11y(P, base);
    a11yLog(P, { at, via, ref, action: 'accept', id, before, after });
    if (meta.reason) keepReason(P, { ref, log: 'a11y', id, via, reason: meta.reason }, ignored);
    av[id] = { state: 'accepted', at, ref, before };
    closeAfter(srv, S, 'a11y', id, 'accepted', { via, ref });
  } else if (action === 'a11y-reject') av[id] = rejectWithNote(srv, S, 'a11y', id, meta);
  else if (action === 'a11y-unaccept') {
    // Take a rule (or every rule) off the accepted list: the report shows it as new at once.
    const current = base[id] ?? [];
    const after = current.filter((r) => meta.rule && r !== meta.rule);
    if (after.length === current.length)
      throw httpError(409, `${meta.rule ?? 'nothing'} is not on the accepted list of ${id}`);
    base[id] = after;
    writeA11y(P, base);
    a11yLog(P, {
      at,
      via,
      ref,
      action: 'unaccept',
      id,
      before: current,
      after,
      rule: meta.rule ?? null,
    });
    delete av[id];
    written = updateCheckRows(S, (r) =>
      r.id === id && r.a11y?.violations
        ? {
            ...r,
            a11y: {
              ...r.a11y,
              baseline: after,
              new: r.a11y.violations.filter((v) => !after.includes(v.id)).length,
            },
          }
        : null
    );
  } else if (action === 'a11y-unreview') {
    const prev = av[id];
    agentMayClear(meta, prev?.state);
    agentMayClearRejection(S, meta, 'a11y', id, prev);
    if (prev?.state === 'accepted') {
      const current = base[id] ?? null;
      if (prev.before == null) delete base[id];
      else base[id] = prev.before;
      writeA11y(P, base);
      a11yLog(P, { at, via, ref, action: 'undo', id, before: current, after: prev.before });
    }
    delete av[id];
    closeAfter(srv, S, 'a11y', id, 'undone', { via, ref });
  } else throw httpError(404, 'unknown action');
  S.quietUntil = Date.now() + 800;
  writeJson(S.a11yReviewPath, av, { pretty: true });
  console.log(`[serve] ${S.name}: ${action} ${id} (via ${via})`);
  srv.broadcast('review', {
    project: S.name,
    id,
    a11y: av[id] ?? null,
    ...checkPatch(written, id),
  });
  return av[id] ?? null;
}

/**
 * `pxsig a11y --prune` through the server that holds the store (lib/prune.mjs): the person
 * confirmed the plan at the terminal; the plan is pinned to a11y.json, so a decision made since
 * refuses it whole. The dashboard reloads its data.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {RequestBody} body `{ plan, batch, reason? }`
 * @param {string} via how it reached the server (lib/guard.mjs `authorize`)
 */
export async function a11yPrune(srv, S, body, via) {
  needLock(srv, S);
  /**
   * @param {unknown} v
   * @param {number} max
   */
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  // pxsig's own batch name (`pxsig a11y --prune` sends one), else the server's.
  const batch = ownBatch(body.batch) ?? newBatch('prune');
  // Asked only with a reason: the reason stays beside each line's ref (lib/decisions.mjs).
  const reason = s(body.reason, 500);
  const ignored = reason ? await reportsIgnoredAsync(S.P) : false;
  // Errors carry their status (400 a bad plan, 409 a11y.json changed since it was made).
  // `applyPrune` checks the plan (`checkPlan`).
  const r = applyPrune(S.P, /** @type {import('../types/t2.js').PlanInput} */ (body.plan), {
    batch,
    reason,
    ignored,
    via,
    lockCheck: () => needLock(srv, S),
  });
  S.quietUntil = Date.now() + 800;
  console.log(
    `[serve] ${S.name}: pruned ${r.rules} accepted a11y rules from ${r.entries} entries (batch ${batch}, via ${via})`
  );
  srv.broadcast('data', { project: S.name });
  return { batch, entries: r.entries, rules: r.rules };
}
