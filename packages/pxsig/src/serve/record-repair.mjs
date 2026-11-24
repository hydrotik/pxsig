/**
 * serve/record-repair.mjs — "Repair baseline records" through the server, for the dashboard's
 * action (lib/approvals/record-repair.mjs):
 *
 *   GET  /__pxsig/record-repair-plan?project=   the plan: every baseline whose record and image
 *                                               differ, eligible (with why) or not (with each reason).
 *                                               Reads only; writes nothing.
 *   POST /__pxsig/record-repair {items}         `items`: `[{ id, file }]`, the eligible entries the
 *                                               page showed, each with the file sha256 it showed.
 *                                               A decision (lib/guard.mjs DECISIONS): the dashboard
 *                                               link's cookie, never an assistant's token. Re-plans
 *                                               and writes only the items still eligible with the
 *                                               same bytes; refused while a check runs.
 *
 * Nothing else starts a repair: the safe repairs (serve/repair.mjs) never do.
 */
import { readJson } from '../lib/files.mjs';
import {
  applyRecordRepair,
  planRecordRepair,
  stillEligible,
} from '../lib/approvals/record-repair.mjs';
import { httpError, json } from './http.mjs';
import { runIntegrity } from './integrity.mjs';
import { needLock } from './projects.mjs';
/** @import { Manifest } from '../types.js' */
/** @import { Route } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

const ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;
const SHA = /^[0-9a-f]{64}$/;
/** At most this many entries in one repair. */
const MAX_ITEMS = 5000;

/**
 * The committed manifest, read now (the run manifest the server keeps may be older).
 * @param {ProjectState} S
 * @returns {Manifest}
 */
function manifestOf(S) {
  // pxsig's own file (`pxsig index` writes it).
  const m = /** @type {Manifest | null} */ (readJson(S.P.manifestPath(), null));
  if (!m?.stories) throw httpError(409, 'no readable manifest');
  return m;
}

/**
 * The planned items a request names, checked: `[{ id, file }]`, ids and sha256s only.
 * @param {unknown} v
 * @returns {{ id: string, file: string }[]}
 */
export function itemsOf(v) {
  if (!Array.isArray(v) || !v.length || v.length > MAX_ITEMS)
    throw httpError(400, `items is a list of 1 to ${MAX_ITEMS} { id, file }`);
  return v.map((x) => {
    const o = /** @type {{ id?: unknown, file?: unknown }} */ (x ?? {});
    if (typeof o.id !== 'string' || !ID.test(o.id)) throw httpError(400, 'bad id');
    if (typeof o.file !== 'string' || !SHA.test(o.file)) throw httpError(400, 'bad file sha256');
    return { id: o.id, file: o.file };
  });
}

/** @type {[string, Route][]} */
export const recordRepairRoutes = [
  [
    'record-repair-plan',
    {
      methods: 'GET',
      stage: 'open',
      project: 'query',
      run: ({ res, S }) => {
        try {
          return json(res, 200, { project: S.name, plan: planRecordRepair(S.P, manifestOf(S)) });
        } catch (e) {
          // The engine's refusal (not built, too old), its check failing, or no manifest.
          const err = /** @type {Error & { status?: number }} */ (e);
          return json(res, err.status ?? 500, { error: err.message });
        }
      },
    },
  ],
  [
    'record-repair',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      async run({ srv, res, body, S, auth }) {
        // A decision (lib/guard.mjs DECISIONS): only a person's link or the CLI's token gets here.
        const via = auth.via === 'cli' ? 'cli' : 'dashboard';
        const items = itemsOf(body.items);
        needLock(srv, S);
        if (S.running || S.queued.size || S.repairing)
          throw httpError(409, 'a check or a repair is running: wait for it, then list again');
        const manifest = manifestOf(S);
        const { go, dropped } = stillEligible(planRecordRepair(S.P, manifest), items);
        const r = applyRecordRepair(S.P, manifest, go, { via, check: () => needLock(srv, S) });
        console.log(
          `[serve] ${S.name}: record-repair ${r.repaired.length} of ${items.length} (via ${via})${r.batch ? ` · batch ${r.batch}` : ''}`
        );
        await runIntegrity(srv, S, 'record-repair');
        srv.broadcast('data', { project: S.name });
        return json(res, 200, {
          ok: true,
          project: S.name,
          batch: r.batch,
          repaired: r.repaired.map((l) => l.id),
          notWritten: [...dropped, ...r.failed.map((x) => ({ id: x.id, why: x.error }))],
        });
      },
    },
  ],
];
