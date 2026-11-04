/**
 * serve/review.mjs — visual decisions through the server: approve (the latest render becomes the
 * baseline), reject, unreview (an approval's undo), and approving a whole story at once.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { newBatch, PERSON_VIA, paths, record, sha256, snapshot, undo } from '../lib/approvals.mjs';
import { BY_STORY_OFF, byStory, storySkip } from '../lib/approvals/story.mjs';
import { readJson, writeJson } from '../lib/files.mjs';
import { NEEDS_PERSON } from '../lib/guard.mjs';
import { httpError } from './http.mjs';
import { needLock } from './projects.mjs';
import { checkPatch, updateCheckRows } from './report-rows.mjs';
/**
 * @import { A11yBaseline, CheckReport, DecisionMeta, ReviewEntry, ReviewFile } from '../types/t5.js'
 */
/** @import { ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */
/** @import { Written } from './report-rows.mjs' */

/**
 * An agent clears its own kind of decision only: never a person's approval or accept.
 * @param {DecisionMeta} meta
 * @param {string | undefined} state
 */
export const agentMayClear = (meta, state) => {
  if (meta.via === 'mcp' && (state === 'approved' || state === 'accepted'))
    throw httpError(
      403,
      `clearing an ${state === 'approved' ? 'approval' : 'accept'} ${NEEDS_PERSON.slice('approving '.length)}`
    );
};

/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} id
 * @param {DecisionMeta} [meta]
 */
export async function approve(srv, S, id, meta = {}) {
  needLock(srv, S);
  const { P, manifest } = S;
  const e = manifest.stories.find((s) => s.id === id);
  if (!e) throw httpError(404, `unknown entry ${id}`);
  const latest = join(P.store.latest, `${id}.png`);
  if (!existsSync(latest)) throw httpError(409, `no latest render for ${id}; run a check`);
  // Mid-check, latest/ holds renders not yet trimmed or verified: approving one bakes in that.
  if (S.checking?.has(id) || S.queued.has(id))
    throw httpError(409, `${id} is being re-checked; approve it once the check finishes`);
  // A render that failed (an error page, a timeout) left the previous image behind, not this story.
  // check.json is pxsig's own file (the fallback has its `rows`).
  const current = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.find(
    (r) => r.id === id
  );
  if (current?.error)
    throw httpError(
      409,
      `${id} did not render (${current.error}); fix it and re-check before approving`
    );
  const batch = meta.batch ?? newBatch(meta.via ?? 'dashboard');
  // No baseline yet (a NEW entry): nothing to snapshot, `before` is null and undo removes the file.
  const { before } = snapshot(P, e, batch);
  // A .psig output carries the render itself as the baseline image, and the environment of that
  // render (the row's, from the check that made it), never this server's or the approver's.
  const report = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] }));
  const renderEnv = current?.env ? (report.envs?.[current.env] ?? null) : null;
  const res = await srv.rust('capture', {
    png: latest,
    out: resolve(P.workspaceRoot, e.sig),
    grid: e.grid ?? manifest.grid ?? 64,
    minCellPx: e.grid ? undefined : manifest.minCellPx,
    detail: e.detail !== false && manifest.detail !== false,
    entry: { id: e.id, story: e.story ?? null, mode: e.mode ?? null, state: e.state ?? null },
    ...(renderEnv ? { env: renderEnv } : {}),
  });
  // The a11y baseline follows the approved render; the old list is kept so an undo can put it back.
  const row = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.find(
    (r) => r.id === id
  );
  /** @type {string[] | null | undefined} */
  let a11yBefore;
  if (row?.a11y?.violations) {
    // a11y.json is pxsig's own file: entry id → accepted rule ids.
    const base = /** @type {A11yBaseline} */ (readJson(P.store.a11y, {}));
    a11yBefore = base[id] ?? null;
    base[id] = row.a11y.violations.map((v) => v.id).sort();
    writeJson(P.store.a11y, base, { pretty: true });
  }
  const logged = record(P, e, {
    batch,
    via: meta.via ?? 'dashboard',
    reason: meta.reason ?? null,
    kind: meta.kind ?? null,
    before,
  });
  return {
    ...res,
    batch,
    after: logged.after,
    ...(a11yBefore !== undefined ? { a11yBefore } : {}),
  };
}

/**
 * Undo one approval made through the server: restore that entry's previous baseline from the
 * batch snapshot (a first baseline goes to trash/), put its a11y baseline back, and log it like
 * `pxsig approve undo`. Refuses, changing nothing, when the baseline was rewritten since.
 * @param {ProjectState} S
 * @param {string} id
 * @param {ReviewEntry & { batch: string }} entry the approval's review.json entry
 * @param {string} [via]
 */
export function unapprove(S, id, entry, via = 'dashboard') {
  const { P, manifest } = S;
  const e = manifest.stories.find((s) => s.id === id);
  if (!e) throw httpError(404, `unknown entry ${id}`);
  const before = sha256(paths(P, e).sig);
  const res = undo(P, manifest, entry.batch, {
    git: false,
    ids: [id],
  });
  if (res.refused.length) throw httpError(409, `cannot undo ${id}: ${res.refused[0].why}`);
  if (!res.restored.length && !res.removed.length)
    throw httpError(409, `cannot undo ${id}: nothing in batch ${entry.batch} to restore`);
  record(P, e, {
    batch: `${entry.batch}-undo`,
    via: 'undo',
    reason: `undo ${entry.batch} (dashboard)`,
    before,
    person: PERSON_VIA.has(via),
  });
  if ('a11yBefore' in entry) {
    const base = /** @type {A11yBaseline} */ (readJson(P.store.a11y, {}));
    if (entry.a11yBefore == null) delete base[id];
    else base[id] = entry.a11yBefore;
    writeJson(P.store.a11y, base, { pretty: true });
  }
}

/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} action `approve`, `reject` or `unreview`
 * @param {string} id
 * @param {DecisionMeta} [meta]
 */
export async function review(srv, S, action, id, meta = {}) {
  needLock(srv, S);
  // review.json is this server's own file.
  const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
  /** @type {Written | null} */
  let written = null;
  if (action === 'approve') {
    rv[id] = {
      state: 'approved',
      at: new Date().toISOString(),
      ...(await approve(srv, S, id, meta)),
    };
    // The report says so too, so its counts (failed, changed) agree with the review.
    written = updateCheckRows(S, (r) =>
      r.id === id
        ? // `approve` just above set the batch.
          { ...r, approved: { at: rv[id].at, batch: /** @type {string} */ (rv[id].batch) } }
        : null
    );
  } else if (action === 'reject')
    rv[id] = { state: 'rejected', at: new Date().toISOString(), via: meta.via ?? 'dashboard' };
  else if (action === 'unreview') {
    agentMayClear(meta, rv[id]?.state);
    if (rv[id]?.state === 'approved' && rv[id].batch)
      // An approval with its batch: checked just above.
      unapprove(
        S,
        id,
        /** @type {ReviewEntry & { batch: string }} */ (rv[id]),
        meta.via ?? 'dashboard'
      );
    delete rv[id];
    written = updateCheckRows(S, (r) =>
      r.id === id && r.approved ? (({ approved: _approved, ...rest }) => rest)(r) : null
    );
  } else throw httpError(404, 'unknown action');
  S.quietUntil = Date.now() + 800;
  writeJson(S.reviewPath, rv, { pretty: true });
  console.log(`[serve] ${S.name}: ${action} ${id} (via ${meta.via ?? 'dashboard'})`);
  srv.broadcast('review', {
    project: S.name,
    id,
    entry: rv[id] ?? null,
    ...checkPatch(written, id),
  });
  return rv[id] ?? null;
}

/**
 * Approve every entry of one story that waits for a decision (each mode and state), in one batch:
 * a person's single click in the dashboard, with `approvals.byStory` on. Entries that passed, did not render, were rejected or
 * are already approved are left out, with why. Each approval is logged and undone like any other.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} story
 * @param {DecisionMeta} [meta]
 */
export async function approveStory(srv, S, story, meta = {}) {
  if (!byStory(S.P.config)) throw httpError(403, BY_STORY_OFF);
  needLock(srv, S);
  if (!S.running) S.reload();
  const entries = S.manifest.stories.filter((e) => (e.story ?? e.id) === story);
  if (!entries.length) throw httpError(404, `unknown story ${story}`);
  const rows = new Map(
    /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] })).rows.map((r) => [r.id, r])
  );
  const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
  const batch = meta.batch ?? newBatch(meta.via ?? 'dashboard');
  /** @type {string[]} */
  const approved = [];
  /** @type {{ id: string, why: string }[]} */
  const skipped = [];
  for (const e of entries) {
    const why = storySkip(rv[e.id]?.state, rows.get(e.id));
    if (why) {
      skipped.push({ id: e.id, why });
      continue;
    }
    try {
      await review(srv, S, 'approve', e.id, { ...meta, batch });
      approved.push(e.id);
    } catch (err) {
      // review throws Errors (httpError, or the engine's).
      skipped.push({ id: e.id, why: /** @type {Error} */ (err).message });
    }
  }
  console.log(
    `[serve] ${S.name}: approve story ${story}: ${approved.length} approved, ${skipped.length} left (batch ${batch})`
  );
  return { story, batch, approved, skipped };
}
