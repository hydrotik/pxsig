/**
 * serve/gate-report.mjs — the inspector's Report to pxsig (lib/gate-report.mjs) through the server:
 *
 *   GET  /__pxsig/gate-report?project=&id=&full=1&keepId=1&noImage=1
 *        the report of one entry: { text, url, trimmed, facts, image } (`image` a PNG data URL, or
 *        null for an image-free report). Writes nothing; answers 409 when there is nothing to
 *        report (no check, no baseline, a render error).
 *   POST /__pxsig/gate-report/self-check {id}
 *        the report's self-check: the entry re-rendered and checked on this machine (the server's
 *        re-check, as Re-check queues it: never a baseline), answered once its run has ended with
 *        `state`: `differs` (it still fails the gate), `passes`, `error` or `not-checked`.
 *
 * Neither decides anything, so neither needs the dashboard link: a read-only page may prepare a
 * report. No answer holds a path or a user name; nothing is sent anywhere: the person posts.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson } from '../lib/files.mjs';
import { gateReport, GateReportError, scrub } from '../lib/gate-report.mjs';
import { enqueue } from './checks.mjs';
import { json } from './http.mjs';
/** @import { CheckReport } from '../types/t5.js' */
/** @import { Route, ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/** The entry id pattern (docs/spec.md#entry-id). */
const ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;
/** @param {string | null} v */
const on = (v) => v === '1' || v === 'true';

/**
 * The entry's row in check.json (the server's own file), or null.
 * @param {ProjectState} S
 * @param {string} id
 */
const rowOf = (S, id) =>
  /** @type {CheckReport | null} */ (
    readJson(join(S.P.store.reports, 'check.json'), null)
  )?.rows?.find((r) => r.id === id) ?? null;

/**
 * A message for the page: an error from the check may name a file.
 * @param {ProjectState} S
 * @param {string} id
 * @param {string} s
 */
const safe = (S, id, s) =>
  scrub(s, { id, keepId: true, roots: [S.P.workspaceRoot, homedir()] }).slice(0, 400);

/**
 * Wait until `id` is neither queued nor being checked: its run (and any it waited for) has ended.
 * @param {ProjectState} S
 * @param {string} id
 */
async function settled(S, id) {
  while (S.queued.has(id) || S.checking?.has(id))
    await (S.running ?? new Promise((ok) => setTimeout(ok, 100)));
}

/**
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} id
 */
async function selfCheck(srv, S, id) {
  const before = rowOf(S, id)?.checkedAt ?? null;
  const q = await enqueue(srv, S, { ids: [id] });
  if (!q.queued.includes(id))
    return {
      state: 'not-checked',
      error: safe(S, id, q.skipped[0]?.why ?? 'not in the manifest'),
    };
  await settled(S, id);
  const row = rowOf(S, id);
  if (!row || (row.checkedAt ?? null) === before)
    return {
      state: 'error',
      error: safe(S, id, S.lastFailure?.error ?? 'the re-check did not finish'),
    };
  if (row.error) return { state: 'error', error: safe(S, id, String(row.error)) };
  return { state: row.pass ? 'passes' : 'differs', reasons: row.reasons ?? [] };
}

/** @type {[string, Route][]} */
export const gateReportRoutes = [
  [
    'gate-report',
    {
      methods: 'GET',
      stage: 'open',
      project: 'query',
      async run({ srv, res, q, S }) {
        const id = q.get('id') ?? '';
        if (!ID.test(id)) return json(res, 400, { error: 'bad id' });
        try {
          const r = await gateReport(S.P, id, {
            full: on(q.get('full')),
            keepId: on(q.get('keepId')),
            noImage: on(q.get('noImage')),
            diff: (a, b, mask) => srv.rust('diff', { a, b, mask }),
          });
          return json(res, 200, {
            project: S.name,
            text: r.text,
            url: r.url,
            trimmed: r.trimmed,
            facts: r.facts,
            image: r.image ? `data:image/png;base64,${r.image.toString('base64')}` : null,
          });
        } catch (e) {
          if (e instanceof GateReportError) return json(res, 409, { error: e.message });
          throw e;
        }
      },
    },
  ],
  [
    'gate-report/self-check',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      async run({ srv, res, body, S }) {
        const { id } = body;
        if (typeof id !== 'string' || !ID.test(id)) return json(res, 400, { error: 'bad id' });
        return json(res, 200, { project: S.name, id, ...(await selfCheck(srv, S, id)) });
      },
    },
  ],
];
