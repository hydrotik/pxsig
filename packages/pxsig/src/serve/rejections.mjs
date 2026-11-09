/**
 * serve/rejections.mjs — open rejections through the server (lib/rejections.mjs): a reject's
 * reason, the rule that an assistant (the MCP's token) may not clear a person's rejection, the
 * closes that decisions and checks make, and `POST /__pxsig/rejection-dismiss`. Each change is a
 * `rejection` event `{ project, id, kind, record | null }`.
 */
import { decisionRef } from '../lib/approvals.mjs';
import { notKept } from '../lib/decisions.mjs';
import { NEEDS_PERSON } from '../lib/guard.mjs';
import { readJson } from '../lib/files.mjs';
import {
  afterCheck,
  byPerson,
  closeRejection,
  lead,
  openRejection,
  readRejections,
  sanitizeNote,
} from '../lib/rejections.mjs';
import { httpError, json } from './http.mjs';
import { needLock } from './projects.mjs';
/** @import { CheckRow } from '../types.js' */
/** @import { DecisionMeta, ReviewFile } from '../types/t5.js' */
/** @import { Rejection, RejectionClose, RejectionKind } from '../types/rejections.js' */
/** @import { Route, ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {Rejection | null} record
 */
const tell = (srv, S, kind, id, record) =>
  srv.broadcast('rejection', { project: S.name, id, kind, record });

/**
 * Whether a reject carries a note: only then is git asked whether it may be kept
 * (lib/decisions.mjs `reportsIgnoredAsync`), before the caller reads its files. A reject without
 * one spawns nothing and awaits nothing.
 * @param {DecisionMeta} meta
 */
export const hasNote = (meta) => sanitizeNote(meta.note) != null;

/**
 * A reject: its reason (sanitized) opens the rejection, or is added to the open one; while the
 * store's reports/ is not git-ignored the rejection opens with no note and the decision says so
 * (`noteKept: false`, and one line in the server's log). Answers the decision the review file
 * keeps: the leading reason's, so an assistant's note on a person's rejection leaves the person's
 * decision in place.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {DecisionMeta} meta
 * @param {boolean} ignored `reportsIgnoredAsync(S.P)`, asked when `hasNote(meta)`
 * @returns {{ state: 'rejected', at: string, via: string, ref: string, note?: string, noteKept?: false }}
 */
export function rejectWithNote(srv, S, kind, id, meta, ignored) {
  const note = sanitizeNote(meta.note);
  const r = openRejection(S.P, kind, id, { via: meta.via ?? 'dashboard', note, ignored });
  tell(srv, S, kind, id, r);
  if (note && !ignored) console.error(`[serve] ${S.name}: ${notKept(S.P, 'Note')}`);
  const n = lead(r.notes);
  return {
    state: 'rejected',
    at: n.at,
    via: n.via,
    ref: n.ref,
    ...(n.note ? { note: n.note } : {}),
    ...(note && !ignored ? { noteKept: /** @type {const} */ (false) } : {}),
  };
}

/**
 * Refuses (403) an assistant's (`via: mcp`) clearing of a rejection a person made: the decision
 * on file, or the open rejection, when a person gave its reason.
 * @param {ProjectState} S
 * @param {DecisionMeta} meta
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {{ state: string, via?: string } | undefined} decision
 */
export function agentMayClearRejection(S, meta, kind, id, decision) {
  if (meta.via !== 'mcp') return;
  const person =
    (decision?.state === 'rejected' && decision.via !== 'mcp') ||
    byPerson(readRejections(S.P)[kind][id]);
  if (person)
    throw httpError(
      403,
      `clearing a person's rejection ${NEEDS_PERSON.slice('approving '.length)}`
    );
}

/**
 * Close `id`'s open rejection of `kind` after a decision; tells the dashboard when one closed.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {RejectionClose} as
 * @param {{ via?: string | null, ref?: string | null }} [by]
 */
export function closeAfter(srv, S, kind, id, as, by = {}) {
  if (closeRejection(S.P, kind, id, as, by)) tell(srv, S, kind, id, null);
}

/**
 * After the server's re-check: the checks of the open rejections, and the closes.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {Iterable<CheckRow>} rows
 */
export function rejectionsAfterCheck(srv, S, rows) {
  const r = afterCheck(S.P, rows, { known: new Set(S.manifest.stories.map((e) => e.id)) });
  for (const c of r.closed) tell(srv, S, c.kind, c.id, null);
  for (const c of r.checked) tell(srv, S, c.kind, c.id, c.record);
}

/** The entry id pattern (docs/spec.md#entry-id), as `decide` checks it. */
const ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;

/**
 * POST /__pxsig/rejection-dismiss {id, kind}: a person closes an open rejection after a re-check,
 * with no decision on the entry. A decision (lib/guard.mjs DECISIONS), never an assistant's.
 * @type {[string, Route][]}
 */
export const rejectionRoutes = [
  [
    'rejection-dismiss',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      run({ srv, res, body, S, auth }) {
        const { id, kind } = body;
        if (typeof id !== 'string' || !ID.test(id)) return json(res, 400, { error: 'bad id' });
        if (kind !== 'visual' && kind !== 'a11y')
          return json(res, 400, { error: 'kind is visual or a11y' });
        needLock(srv, S);
        if (!readRejections(S.P)[kind][id])
          return json(res, 404, { error: `no open rejection of ${id}` });
        // review.json and a11y-review.json are this server's own files.
        const decisions = /** @type {ReviewFile} */ (
          readJson(kind === 'visual' ? S.reviewPath : S.a11yReviewPath, {})
        );
        if (decisions[id]?.state === 'rejected')
          return json(res, 409, { error: `${id} is rejected now: undo the rejection instead` });
        // A decision (lib/guard.mjs DECISIONS): `authorize` let it through only with its `via` set.
        const via = /** @type {string} */ (auth.via);
        closeAfter(srv, S, kind, id, 'dismissed', { via, ref: decisionRef() });
        console.log(`[serve] ${S.name}: rejection-dismiss ${id} (via ${via})`);
        return json(res, 200, { ok: true, project: S.name, id, kind });
      },
    },
  ],
];
