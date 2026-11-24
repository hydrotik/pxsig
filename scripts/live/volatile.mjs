/**
 * live/volatile.mjs — the live screens' response scrub: what the real server answers that varies from
 * run to run (the times it writes, durations, its ports, the staged base's commit), rewritten at the HTTP boundary before the
 * page sees it, so a live screen is the same on every run (docs/releasing.md, "Live screens").
 *
 * Strict both ways:
 *   - every listed path must be present with its type (an ISO time, a number, a URL), unless it is
 *     optional; a server that stops sending a field fails the step, naming the path;
 *   - after the rewrite, an ISO time, a loopback URL with a port (other than the dead one), a
 *     duration (`…Ms`) or a hash under a `commit` or `sha` key left anywhere in the answer fails
 *     the step, naming its path. A new volatile
 *     field is added to RULES on purpose; it never turns into a flaky screen.
 * Everything else (rows, verdicts, review state, counts, errors, the ledger) passes untouched.
 *
 * A displayed time keeps its order: the k-th distinct value of a `rank` field in the run becomes
 * FIXED_TIME − 60 min + k min, so "Last check" still moves forward after a check. Other times become
 * FIXED_TIME, also inside a `text` field (an integrity reason); durations 1,000 ms; URLs the dead
 * URL, their path kept; a commit FIXED_COMMIT. The staged base's commit is a hash of the example's
 * files, so without this a dependency bump to the example would change the live screens.
 *
 * Zero dependencies.
 */
import { FIXED_TIME } from '../../packages/pxsig/src/dashboard-check/capture.mjs';
import { fixGateReport } from './gate-report.mjs';
import { serverFetch } from './server.mjs';

/** @import { ScrubRule } from './types.js' */

export const DEAD_ORIGIN = 'http://127.0.0.1:1';
export const FIXED_MS = 1000;
export const FIXED_COMMIT = '0000000';
const ISO = /\b\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?\b/;
const HASH = /^[0-9a-f]{7,40}$/;
/** A batch name's time (lib/approvals/core.mjs `newBatch`), and the one it becomes. */
const BATCH = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z/;
const FIXED_BATCH = FIXED_TIME.replace(/[:.]/g, '-');
const LOOPBACK = /\b(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/g;

/** The integrity ledger's volatile fields (GET integrity, and `integrity` in GET data). */
const LEDGER = /** @type {const} */ ([
  ['generatedAt', 'time'],
  ['entries[].approval.at', 'time', true],
  ['entries[].issues[].reason', 'text', true],
  ['elapsedMs', 'ms'],
  ['sources.storyIndex.url', 'url', true],
  ['sources.manifest.updatedAt', 'time', true],
  ['sources.report.generatedAt', 'time', true],
  ['entries[].verdict.checkedAt', 'time', true],
  ['entries[].renderedAt', 'time', true],
]);
/** @type {(prefix: string, optional?: boolean) => ScrubRule[]} */
const ledger = (prefix, optional = false) =>
  LEDGER.map(([p, kind, opt]) => ({ path: `${prefix}${p}`, kind, optional: optional || !!opt }));

/** Route (the path after /__pxsig/) → its rules. */
/** @type {Record<string, ScrubRule[]>} */
export const RULES = {
  data: [
    { path: 'generatedAt', kind: 'time' },
    { path: 'check.generatedAt', kind: 'rank' },
    { path: 'check.fullCheckAt', kind: 'rank', optional: true },
    { path: 'check.rows[].checkedAt', kind: 'time', optional: true },
    { path: 'check.rows[].renderMs', kind: 'ms', optional: true },
    { path: 'check.rows[].approved.at', kind: 'time', optional: true },
    { path: 'check.summary.renderWallMs', kind: 'ms' },
    { path: 'check.summary.rustEngineMs', kind: 'ms' },
    { path: 'check.summary.rustProcessMs', kind: 'ms', optional: true },
    { path: 'check.summary.retryMs', kind: 'ms', optional: true },
    { path: 'check.summary.totalMs', kind: 'ms' },
    { path: 'history[].at', kind: 'rank' },
    { path: 'history[].summary.elapsedMs', kind: 'ms', optional: true },
    { path: 'storybook.baseUrl', kind: 'url' },
    { path: 'review.*.at', kind: 'time', optional: true },
    { path: 'a11yReview.*.at', kind: 'time', optional: true },
    // The open rejections (lib/rejections.mjs): kind → entry id → when it opened, each reason's
    // time, each check's.
    { path: 'rejections.*.*.at', kind: 'time', optional: true },
    { path: 'rejections.*.*.notes[].at', kind: 'time', optional: true },
    { path: 'rejections.*.*.checks[].at', kind: 'time', optional: true },
    // The React analysis (lib/react/data.mjs): when results went out of date, when they were made,
    // how long the analysis took; a row's render counts' times.
    { path: 'react.status.stale.since', kind: 'time', optional: true },
    { path: 'react.report.generatedAt', kind: 'time', optional: true },
    { path: 'react.report.summary.ms', kind: 'ms', optional: true },
    { path: 'react.report.base.commit', kind: 'commit', optional: true },
    // The served dashboard build (lib/build-identity.mjs): the checkout's commit, the design
    // system's, when it was built; none for a release build.
    { path: 'build.commit', kind: 'commit', optional: true },
    { path: 'build.designSystem.commit', kind: 'commit', optional: true },
    { path: 'build.builtAt', kind: 'time', optional: true },
    { path: 'check.rows[].renders.at', kind: 'time', optional: true },
    { path: 'check.rows[].renders.prev.at', kind: 'time', optional: true },
    ...ledger('integrity.', true),
  ],
  status: [
    { path: 'projects[].storybook', kind: 'url', optional: true },
    { path: 'integritySummary.*.generatedAt', kind: 'time', optional: true },
    { path: 'dashboard', kind: 'url' },
    { path: 'review.*.at', kind: 'time', optional: true },
  ],
  projects: [{ path: 'projects[].storybook', kind: 'url', optional: true }],
  integrity: ledger(''),
  // The report's versions and machine class (live/gate-report.mjs); its text and link follow.
  'gate-report': [{ path: 'facts', kind: 'report' }],
  // Repair baseline records: when the plan was made, and the batch the repair logged (its name
  // starts with the time).
  'record-repair-plan': [{ path: 'plan.createdAt', kind: 'time' }],
  'record-repair': [{ path: 'batch', kind: 'batch' }],
};

/** Routes scrubbed on their own path only: `gate-report/self-check` holds nothing volatile. */
const EXACT = new Set(['gate-report']);

/** The route of a request URL (`/__pxsig/data?project=x` → `data`), or null when none is scrubbed. */
export function routeOf(/** @type {string} */ url) {
  const m = /\/__pxsig\/([a-z-]+)(\/.*)?/.exec(new URL(url).pathname);
  if (m && m[2] && EXACT.has(m[1])) return null;
  return m && RULES[m[1]] ? m[1] : null;
}

/**
 * Every concrete location of `path` in `obj`: `[parent, key, shown path]`.
 * @param {unknown} obj
 * @param {string} path
 * @returns {{ parent: Record<string, unknown>, key: string, at: string, missing: boolean }[]}
 */
function locate(obj, path) {
  /** @type {{ parent: Record<string, unknown>, key: string, at: string, missing: boolean }[]} */
  const out = [];
  const walk = (
    /** @type {unknown} */ v,
    /** @type {string[]} */ rest,
    /** @type {string} */ at
  ) => {
    if (v == null || typeof v !== 'object') return;
    const [head, ...tail] = rest;
    const each = head.endsWith('[]') || head === '*';
    const key = head.replace(/\[\]$/, '');
    const o = /** @type {Record<string, unknown>} */ (v);
    if (head === '*') {
      for (const [k, x] of Object.entries(o)) walk(x, tail, `${at}.${k}`);
      return;
    }
    if (!tail.length) {
      out.push({ parent: o, key, at: `${at}.${key}`.slice(1), missing: !(key in o) });
      return;
    }
    if (each) {
      const arr = o[key];
      if (Array.isArray(arr)) arr.forEach((x, i) => walk(x, tail, `${at}.${key}[${i}]`));
      else out.push({ parent: o, key, at: `${at}.${key}`.slice(1), missing: true });
    } else if (o[key] == null)
      out.push({ parent: o, key, at: `${at}.${key}`.slice(1), missing: true });
    else walk(o[key], tail, `${at}.${key}`);
  };
  walk(obj, path.split('.'), '');
  return out;
}

/** A scrubber for one run: ranks are kept across its answers. */
export function scrubber() {
  /** @type {Map<string, string[]>} rank field → its distinct values, in the order first seen */
  const ranks = new Map();
  const fixed = Date.parse(FIXED_TIME);
  /**
   * Rewrite one answer of `route` in place; returns the problems (empty when clean).
   * @param {string} route
   * @param {unknown} body
   * @returns {string[]}
   */
  function scrub(route, body) {
    /** @type {string[]} */
    const problems = [];
    /** @type {Set<string>} */
    const done = new Set();
    for (const rule of RULES[route] ?? []) {
      // An optional prefix that is absent or null (`integrity.` before the first pass) is skipped.
      for (const { parent, key, at, missing } of locate(body, rule.path)) {
        const v = parent[key];
        if (missing || v == null) {
          if (!rule.optional) problems.push(`${route}: ${at} is missing`);
          continue;
        }
        if (rule.kind === 'report') problems.push(...fixGateReport(parent, `${route}: ${at}`));
        else if (rule.kind === 'batch') {
          if (typeof v !== 'string' || !BATCH.test(v))
            problems.push(`${route}: ${at} is not a batch`);
          else parent[key] = v.replace(BATCH, FIXED_BATCH);
        } else if (rule.kind === 'text') {
          if (typeof v !== 'string') problems.push(`${route}: ${at} is not text`);
          else parent[key] = v.replace(new RegExp(ISO.source, 'g'), FIXED_TIME);
        } else if (rule.kind === 'ms') {
          if (typeof v !== 'number') problems.push(`${route}: ${at} is not a number`);
          else parent[key] = FIXED_MS;
        } else if (rule.kind === 'commit') {
          if (typeof v !== 'string' || !HASH.test(v))
            problems.push(`${route}: ${at} is not a commit`);
          else parent[key] = FIXED_COMMIT;
        } else if (rule.kind === 'url') {
          if (typeof v !== 'string' || !/^https?:\/\//.test(v))
            problems.push(`${route}: ${at} is not a URL`);
          else {
            const u = new URL(v);
            parent[key] =
              `${DEAD_ORIGIN}${u.pathname === '/' && !v.endsWith('/') ? '' : u.pathname}${u.search}`;
          }
        } else if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v)))
          problems.push(`${route}: ${at} is not an ISO time`);
        else if (rule.kind === 'time') parent[key] = FIXED_TIME;
        else {
          const seen = ranks.get(rule.path) ?? [];
          if (!seen.includes(v)) seen.push(v);
          ranks.set(rule.path, seen);
          parent[key] = new Date(
            fixed - 60 * 60_000 + (seen.indexOf(v) + 1) * 60_000
          ).toISOString();
        }
        done.add(at);
      }
    }
    leftovers(body, '', done, route, problems);
    return problems;
  }
  return { scrub };
}

/**
 * Anything volatile the rules did not rewrite.
 * @param {unknown} v
 * @param {string} at
 * @param {Set<string>} done
 * @param {string} route
 * @param {string[]} problems
 */
function leftovers(v, at, done, route, problems) {
  if (done.has(at)) return;
  if (Array.isArray(v)) v.forEach((x, i) => leftovers(x, `${at}[${i}]`, done, route, problems));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      const p = at ? `${at}.${k}` : k;
      if (typeof x === 'number' && k.endsWith('Ms') && !done.has(p))
        problems.push(`${route}: ${p} is a duration no rule rewrites`);
      else if (
        (k === 'commit' || k === 'sha') &&
        typeof x === 'string' &&
        HASH.test(x) &&
        !done.has(p)
      )
        problems.push(`${route}: ${p} is a commit no rule rewrites`);
      else leftovers(x, p, done, route, problems);
    }
  else if (typeof v === 'string') {
    if (ISO.test(v)) problems.push(`${route}: ${at} holds a time no rule rewrites`);
    for (const m of v.matchAll(LOOPBACK))
      if (m[1] !== '1') problems.push(`${route}: ${at} holds a server address with its port`);
  }
}

/**
 * Route the scrubbed answers of `context` through `sc`, collecting its problems. A request that
 * gets no answer (the server dropped it) is aborted, so the page sees it fail as it
 * would, and passed to `failed`: never an answer the scrub let through, never an unhandled
 * rejection that ends the run as "screens to review" (scripts/lib/crash.mjs).
 * @param {Awaited<ReturnType<typeof import('../../packages/pxsig/src/dashboard-check/capture.mjs').screenContext>>} context
 * @param {ReturnType<typeof scrubber>} sc
 * @param {string[]} problems
 * @param {(m: string) => void} failed
 * @param {typeof serverFetch} [fetchFrom] how an answer is fetched (tests stand one in)
 */
export async function scrubRoutes(context, sc, problems, failed, fetchFrom = serverFetch) {
  await context.route(
    (u) => routeOf(u.href) != null,
    async (route) => {
      const req = route.request();
      const at = `${req.method()} /__pxsig/${routeOf(req.url())}`;
      try {
        // On a connection of its own (server.mjs `serverFetch`), as the harness's own requests:
        // Playwright's route.fetch keeps sockets alive in this process, whose event loop stalls.
        const { 'accept-encoding': _e, ...headers } = req.headers();
        // A POST's body goes with it (a decision such as record-repair names its items there).
        const sent = req.postDataBuffer() ?? undefined;
        const res = await fetchFrom(req.url(), { method: req.method(), headers, body: sent });
        const text = await res.text();
        const {
          'content-length': _l,
          'transfer-encoding': _t,
          ...kept
        } = Object.fromEntries(res.headers);
        const answer = { status: res.status, headers: kept };
        /** @type {unknown} */
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return await route.fulfill({ ...answer, body: text });
        }
        problems.push(...sc.scrub(/** @type {string} */ (routeOf(req.url())), body));
        await route.fulfill({ ...answer, json: body });
      } catch (e) {
        const err = /** @type {Error & { cause?: Error }} */ (e);
        const why = [err.message ?? e, err.cause?.message].filter(Boolean).join(': ');
        failed(`${at}: ${String(why).split('\n')[0]}`);
        await route.abort('failed').catch(() => {});
      }
    }
  );
}
