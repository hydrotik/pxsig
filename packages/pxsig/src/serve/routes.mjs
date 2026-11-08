/**
 * serve/routes.mjs — `/__pxsig/<action>`: the route table, one line per route, and `dispatch`,
 * which walks it in the server's order. docs/server.md is the reference for every answer.
 *
 * GET takes `?project=`, POST a `project` field; either may be left out when the workspace has one
 * project, or when the id / story names its project unambiguously (the Storybook addon sends only
 * ids). Writes are same-origin, or (checks and repairs only) a project's Storybook. Decisions
 * (approve, approve-story, reject, unreview, a11y-*, rejection-dismiss) also need the dashboard link's cookie (a page
 * opened with the link this server prints) or the CLI's token (`x-pxsig-token`, `pxsig approve
 * apply`): an agent or a script posting to the server, or reading the page, is refused with 403
 * (lib/guard.mjs). A decision's `via` in the log is what it carried (`dashboard` or `cli`); a
 * `via` in the body is ignored. An approve works for an entry with no baseline yet (a NEW entry):
 * the first render becomes its baseline, logged with `before: null`.
 */
import { ownBatch } from '../lib/approvals.mjs';
import { readJson } from '../lib/files.mjs';
import { filterLedger } from '../lib/integrity.mjs';
import { withoutNotes } from '../lib/rejections.mjs';
import {
  authorize,
  linkSetCookie,
  mayMintTicket,
  NEEDS_LINK_CODE,
  NEEDS_LINK_RUN,
  NEEDS_PERSON,
  sameOriginPage,
} from '../lib/guard.mjs';
import { approving, LINK_EXPIRED } from '../lib/dashboard-link.mjs';
import { buildData } from '../report.mjs';
import { a11yPrune, a11yReview } from './a11y.mjs';
import { enqueue } from './checks.mjs';
import { json, readBody } from './http.mjs';
import { runIntegrity, storyIntegrity } from './integrity.mjs';
import { projectsList, stateFor } from './projects.mjs';
import { linked, liveOf, reactRoutes } from './react.mjs';
import { rejectionRoutes } from './rejections.mjs';
import { repair } from './repair.mjs';
import { approveStory, review } from './review.mjs';
/** @import { IncomingMessage, ServerResponse } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */
/** @import { CheckReport, ReviewFile, StoryIntegrity, StoryStatus } from '../types/t5.js' */
/** @import { Route, RouteContext, ServeContext } from '../types/serve.js' */
/** @import { IntegrityLedger } from './projects.mjs' */

/**
 * The dashboard link: the dashboard (on `tab`) with a fresh one-time ticket in its fragment.
 * @param {ServeContext} srv
 * @param {string} base
 * @param {string | boolean | null} [tab]
 */
export const dashboardLink = (srv, base, tab = null) =>
  `${base}#${tab ? `tab=${encodeURIComponent(tab)}&` : ''}ticket=${srv.links.mint()}`;

/**
 * Per-story status for the addon's sidebar, across every project (story ids are per Storybook).
 * @param {ServeContext} srv
 */
export function statuses(srv) {
  /** @type {Record<string, StoryStatus>} */
  const out = {};
  /** @type {Record<string, number>} */
  const rank = {
    error: 5,
    changed: 4,
    rejected: 4,
    flaky: 3,
    drift: 2,
    approved: 1,
    pass: 0,
    skipped: 0,
  };
  for (const S of srv.states.values()) {
    const check = /** @type {CheckReport} */ (readJson(S.checkPath, { rows: [] }));
    const rv = /** @type {ReviewFile} */ (readJson(S.reviewPath, {}));
    for (const r of check.rows) {
      // Every row buildRow writes names its story (lib/rows.mjs).
      const s = (out[/** @type {string} */ (r.story)] ??= {
        status: 'pass',
        project: S.name,
        entries: [],
      });
      const st =
        rv[r.id]?.state ??
        (r.skipped
          ? 'skipped'
          : r.error
            ? 'error'
            : r.flaky
              ? 'flaky'
              : r.pass
                ? // check.json's `metrics` (docs/spec.md section 4): the engine's numbers.
                  /** @type {{ ssim: number } | undefined} */ (r.metrics) &&
                  /** @type {{ ssim: number }} */ (r.metrics).ssim < 1
                  ? 'drift'
                  : 'pass'
                : 'changed');
      s.entries.push({
        id: r.id,
        mode: r.mode,
        state: st,
        ssim: /** @type {{ ssim?: number } | undefined} */ (r.metrics)?.ssim ?? null,
        reasons: r.reasons ?? [],
      });
      if ((rank[st] ?? 0) > (rank[s.status] ?? 0)) s.status = st;
    }
  }
  return out;
}

/** @type {[string, Route][]} */
const table = [
  // GET /__pxsig/events: server-sent events (`hello`, `data`, `review`, `check`, `integrity`, `watch`)
  [
    'events',
    {
      methods: 'any',
      stage: 'open',
      project: 'none',
      run({ srv, req, res }) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write('event: hello\ndata: {}\n\n');
        srv.clients.add(res);
        req.on('close', () => srv.clients.delete(res));
      },
    },
  ],
  // GET /__pxsig/projects: the workspace id and each project (name, label, root, entries, lock)
  [
    'projects',
    {
      methods: 'any',
      stage: 'open',
      project: 'none',
      run: ({ srv, res }) =>
        json(res, 200, { workspaceId: srv.ws.id, projects: projectsList(srv) }),
    },
  ],
  // GET /__pxsig/status: queue, decisions, per-story status and integrity, `approving`
  [
    'status',
    {
      methods: 'any',
      stage: 'open',
      project: 'none',
      run: ({ srv, req, res }) =>
        json(res, 200, {
          served: true,
          workspaceId: srv.ws.id,
          projects: projectsList(srv),
          // Truthiness only: is a check (a promise) running. The parameter's type says so.
          running: [...srv.states.values()].some(
            (/** @type {{ running: unknown }} */ S) => S.running
          ),
          queued: [...srv.states.values()].reduce((n, S) => n + S.queued.size, 0),
          repairing: [...srv.states.values()].some(
            (/** @type {{ repairing: unknown }} */ S) => S.repairing
          ),
          // Every project's review.json (this server's own files), merged. Without the reasons:
          // Storybook's origins read this answer; /__pxsig/data (same-origin) carries them.
          review: withoutNotes(
            /** @type {ReviewFile} */ (
              Object.assign(
                {},
                ...[...srv.states.values()].map(
                  (S) => /** @type {ReviewFile} */ (readJson(S.reviewPath, {}))
                )
              )
            )
          ),
          stories: statuses(srv),
          integrity: storyIntegrity(srv),
          integritySummary: Object.fromEntries(
            [...srv.states.values()]
              .filter((S) => S.integrity)
              // Filtered just above to the projects with a ledger.
              .map((S) => {
                const L = /** @type {IntegrityLedger} */ (S.integrity);
                return [S.name, { ...L.summary, setup: L.setup, generatedAt: L.generatedAt }];
              })
          ),
          dashboard: `${srv.url}/report/`,
          // Listening, so `url` is set.
          approving: approving(
            req.headers,
            srv.links,
            /** @type {string} */ (srv.url),
            srv.ws.root
          ),
        }),
    },
  ],
  // GET /__pxsig/data?project=: one project's live report
  [
    'data',
    {
      methods: 'GET',
      stage: 'open',
      project: 'query',
      run: ({ res, S }) => json(res, 200, buildData(S.P, { live: liveOf(S) })),
    },
  ],
  // GET /__pxsig/integrity?project= (also /api/integrity): the ledger; story, component, status, fresh
  [
    'integrity',
    {
      methods: 'GET',
      stage: 'open',
      project: 'query',
      async run({ srv, res, q, S }) {
        if (!S.integrity || q.get('fresh')) {
          // A run already going (startup, a file change) answers this request too: wait for it.
          if (S.integrityRunning) await S.integrityDone;
          else await runIntegrity(srv, S, 'request');
        }
        if (!S.integrity) return json(res, 503, { error: 'integrity not computed yet' });
        const story = q.get('story');
        if (story)
          return json(res, 200, {
            story,
            // The story's status across projects. Its `project` (the first project with an entry of
            // that story) is overridden: the answer is about the project asked about.
            .../** @type {Partial<StoryIntegrity>} */ (
              storyIntegrity(srv)[story] ?? { status: 'unknown' }
            ),
            project: S.name,
            entries: S.integrity.entries.filter((x) => x.story === story),
          });
        const f =
          q.get('component') || q.get('status')
            ? filterLedger(S.integrity, { component: q.get('component'), status: q.get('status') })
            : null;
        return json(res, 200, f ? { ...S.integrity, ...f } : S.integrity);
      },
    },
  ],
  // POST /__pxsig/session {ticket}: the dashboard page trades the link's ticket once for the cookie
  [
    'session',
    {
      methods: 'POST',
      stage: 'pre-auth',
      project: 'none',
      async run({ srv, req, res }) {
        if (!sameOriginPage(req.headers, `http://${req.headers.host}`))
          return json(res, 403, {
            error: 'the dashboard link is opened by the dashboard page only',
          });
        const session = srv.links.redeem((await readBody(req)).ticket);
        if (!session)
          return json(res, 403, {
            error: LINK_EXPIRED,
          });
        res.setHeader(
          'set-cookie',
          linkSetCookie(/** @type {AddressInfo} */ (srv.server.address()).port, session)
        );
        return json(res, 200, { ok: true });
      },
    },
  ],
  // POST /__pxsig/ticket: `pxsig serve --link` (a person at a terminal, the CLI's token), a new link
  [
    'ticket',
    {
      methods: 'POST',
      stage: 'pre-auth',
      project: 'none',
      run({ srv, req, res }) {
        if (!mayMintTicket(req.headers, srv.tokens)) return json(res, 403, { error: NEEDS_PERSON });
        return json(res, 200, { link: dashboardLink(srv, `${srv.url}/report/`) });
      },
    },
  ],
  // POST /__pxsig/check {ids?|story?|stories?|all?, renders?}: queue renders + engine checks, answer
  // 202; `renders: true` (Measure renders, the link only) counts React renders in that run
  [
    'check',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'split',
      async run(cx) {
        const { srv, res, body } = cx;
        // Measure renders (`renders: true`) replaces visual results: a person, with the link.
        if (body.renders === true && !linked(cx))
          return json(res, 403, { error: NEEDS_LINK_RUN, code: NEEDS_LINK_CODE });
        // Without a project, a check is split across the projects that own the ids / stories.
        const targets =
          body.project || srv.states.size === 1 ? [stateFor(srv, body)] : [...srv.states.values()];
        const results = [];
        for (const S of targets) results.push(await enqueue(srv, S, body));
        const queued = results.flatMap((r) => r.queued);
        const skipped = results.flatMap((r) => r.skipped);
        // Split across projects, a name only one project knows is not skipped by the others.
        const named = new Set(queued.flatMap((id) => [id, id.replace(/(__[^@]+)?(@.+)?$/, '')]));
        return json(res, 202, {
          ok: true,
          queued,
          registered: results.flatMap((r) => r.registered),
          skipped: targets.length > 1 ? skipped.filter((x) => !named.has(x.name)) : skipped,
        });
      },
    },
  ],
  // POST /__pxsig/repair {apply?, only?, stale?}: the safe repairs, planned or applied (never prunes)
  [
    'repair',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      run: async ({ srv, res, body, S }) =>
        json(
          res,
          200,
          await repair(srv, S, {
            apply: body.apply === true,
            only: body.only,
            stale: body.stale === true,
          })
        ),
    },
  ],
  // POST /__pxsig/a11y-prune {plan, batch, reason?}: `pxsig a11y --prune`, the CLI's token only
  [
    'a11y-prune',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      run: ({ srv, res, body, S, auth }) =>
        // A decision (lib/guard.mjs DECISIONS): `authorize` let it through only with its `via` set.
        json(res, 200, {
          ok: true,
          project: S.name,
          ...a11yPrune(srv, S, body, /** @type {string} */ (auth.via)),
        }),
    },
  ],
  // POST /__pxsig/approve-story {story, reason?}: every entry of a story that waits, one batch
  [
    'approve-story',
    {
      methods: 'POST',
      stage: 'authorized',
      project: 'body',
      async run({ srv, res, body, S, auth }) {
        const { story } = body;
        if (typeof story !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+$/.test(story))
          return json(res, 400, { error: 'bad story' });
        /**
         * @param {unknown} v
         * @param {number} max
         */
        const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
        // `via` is how the decision reached the server (the token it carried), never the body's word.
        return json(res, 200, {
          ok: true,
          project: S.name,
          ...(await approveStory(srv, S, story, { via: auth.via, reason: s(body.reason, 500) })),
        });
      },
    },
  ],
  // react/analyse, react/skip, check/cancel (serve/react.mjs)
  ...reactRoutes,
  // rejection-dismiss (serve/rejections.mjs)
  ...rejectionRoutes,
];
/** The routes by action: `create.mjs` copies them into `srv.routes`. */
export const routes = new Map(table);

/**
 * Every other POST: a decision on one entry, by its id.
 *   POST /__pxsig/approve {id, batch?, reason?, kind?}: the latest render becomes the baseline
 *   POST /__pxsig/reject {id, note?} · /__pxsig/unreview {id}: unreviewing an approval restores the
 *     old baseline; a reject's note (its reason) stays open past the check (serve/rejections.mjs)
 *   POST /__pxsig/a11y-accept {id} · a11y-reject {id, note?} · a11y-unreview: the axe violations
 *   POST /__pxsig/a11y-unaccept {id, rule?}: a rule (or all) off the entry's accepted list
 * Any other name is 404 "unknown action", once the id is checked.
 * @param {RouteContext} cx
 */
async function decide({ srv, res, action, body, S, auth }) {
  const { id } = body;
  if (typeof id !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/.test(id))
    return json(res, 400, { error: 'bad id' });
  /**
   * @param {unknown} v
   * @param {number} max
   */
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const meta = {
    // pxsig's own batch name (`pxsig approve apply` sends one per plan), else the server's.
    batch: ownBatch(body.batch) ?? undefined,
    via: auth.via,
    reason: s(body.reason, 500),
    kind: s(body.kind, 16),
    rule: s(body.rule, 80)?.replace(/[^\w-]/g, ''),
    // Cut to one line of 280 characters where it is stored (lib/rejections.mjs `sanitizeNote`).
    note: s(body.note, 4096),
  };
  if (action.startsWith('a11y-'))
    return json(res, 200, {
      ok: true,
      project: S.name,
      id,
      entry: a11yReview(srv, S, action, id, meta),
    });
  json(res, 200, { ok: true, project: S.name, id, entry: await review(srv, S, action, id, meta) });
}

/**
 * `/__pxsig/<action>`: routes that answer any method; then GET (the project picked first, 405
 * for anything but a GET route); then POST: the link's own routes, `authorize`, the body, a
 * check (split across projects), the project, a named route, else a decision (`decide`).
 * @param {ServeContext} srv
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} action
 * @param {URLSearchParams} q
 */
export async function dispatch(srv, req, res, action, q) {
  const route = srv.routes.get(action);
  /** @type {Omit<RouteContext, 'body' | 'S' | 'auth'>} */
  const cx = { srv, req, res, q, action };
  if (route?.methods === 'any') return route.run(/** @type {RouteContext} */ (cx));
  if (req.method === 'GET') {
    const S = stateFor(srv, { project: q.get('project'), story: q.get('story') });
    if (route?.methods === 'GET') return route.run(/** @type {RouteContext} */ ({ ...cx, S }));
    return json(res, 405, { error: 'POST only' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  const post = route?.methods === 'POST' ? route : undefined;
  if (post?.stage === 'pre-auth') return post.run(/** @type {RouteContext} */ (cx));
  // Same-origin, or a project's Storybook (the addon, checks only): a page on any other site must
  // not write. Decisions need more: the link's cookie or the CLI's token (top of this file).
  const auth = authorize({
    action,
    headers: req.headers,
    tokens: srv.tokens,
    links: srv.links,
    port: /** @type {AddressInfo} */ (srv.server.address()).port,
    ownOrigin: `http://${req.headers.host}`,
    allowedOrigins: srv.allowedOrigins,
  });
  if (!auth.ok) {
    console.error(`[serve] refused POST /__pxsig/${action}: ${auth.error}`);
    return json(res, auth.status, { error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
  }
  const body = await readBody(req);
  if (post?.project === 'split')
    return post.run(/** @type {RouteContext} */ ({ ...cx, body, auth }));
  const S = stateFor(srv, body);
  return (post ?? { run: decide }).run({ ...cx, body, S, auth });
}
