/**
 * serve/gate-report.mjs — the inspector's Report to pxsig (lib/gate-report.mjs) through the server:
 *
 *   GET  /__pxsig/gate-report?project=&id=&full=1&keepId=1&noImage=1
 *        the report of one entry: { text, url, trimmed, facts, image } (`image` a PNG data URL, or
 *        null for an image-free report). Writes nothing; answers 409 when there is nothing to
 *        report (no check, no baseline, a render error).
 *   POST /__pxsig/gate-report/self-check {id}
 *        the report's self-check: the entry re-rendered on this machine into a temporary folder and
 *        judged against its baseline (a dry re-render: the store, check.json and any decision stay
 *        as they are), answered with `state`: `differs` (it still fails the gate), `passes`,
 *        `error` or `not-checked`.
 *
 * Neither decides anything, so neither needs the dashboard link: a read-only page may prepare a
 * report. No answer holds a path or a user name; nothing is sent anywhere: the person posts.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserPool, renderStories } from '../lib/capture.mjs';
import { gateReport, GateReportError, scrub } from '../lib/gate-report.mjs';
import { fetchStoryIndex } from '../lib/integrity.mjs';
import { json } from './http.mjs';
/** @import { Route, ServeContext } from '../types/serve.js' */
/** @import { ProjectState } from './projects.mjs' */

/** The entry id pattern (docs/spec.md#entry-id). */
const ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;
/** @param {string | null} v */
const on = (v) => v === '1' || v === 'true';

/**
 * A message for the page: an error from a render may name a file.
 * @param {ProjectState} S
 * @param {string} id
 * @param {string} s
 */
const safe = (S, id, s) =>
  scrub(s, { id, keepId: true, roots: [S.P.workspaceRoot, homedir()] }).slice(0, 400);

/**
 * The self-check: a dry re-render. The entry is rendered into a temporary folder and judged by
 * the engine against its baseline, as a check judges it, but nothing of the store changes: not
 * its render, not check.json, not the history, and never a person's decision (a re-check clears
 * one; a report must not).
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {string} id
 */
async function selfCheck(srv, S, id) {
  const entry = S.manifest?.stories?.find((e) => e.id === id);
  if (!entry || !S.runPath)
    return {
      state: 'not-checked',
      error: entry ? 'the manifest did not load' : 'not in the manifest',
    };
  const idx = await fetchStoryIndex(S.manifest.baseUrl);
  if (!idx.healthy)
    return {
      state: 'not-checked',
      error: safe(
        S,
        id,
        idx.reachable ? "Storybook's story index is broken" : 'Storybook is not reachable'
      ),
    };
  srv.pool ??= browserPool(S.P);
  const tmp = mkdtempSync(join(tmpdir(), 'pxsig-self-check-'));
  try {
    const out = join(tmp, 'renders');
    const { results } = await renderStories(srv.pool, [entry], out, {
      ...S.manifest,
      concurrency: 1,
      project: S.P,
      a11y: false,
    });
    const r = results.find(Boolean);
    if (!r || r.error) return { state: 'error', error: safe(S, id, r?.error ?? 'no render') };
    const trim = S.manifest.trim;
    if (trim)
      await srv.rust('trim', {
        dir: out,
        only: [id],
        pad: trim.pad ?? 16,
        tolerance: trim.tolerance ?? 8,
      });
    const res = await srv.rust('check', {
      manifest: S.runPath,
      pngDir: out,
      root: S.P.workspaceRoot,
      only: [id],
      outDir: join(tmp, 'diffs'),
      cache: join(tmp, 'cache'),
      history: join(tmp, 'history.ndjson'),
    });
    const row = res.results.find((x) => x.id === id);
    if (!row) return { state: 'error', error: 'the engine judged nothing' };
    if (row.error) return { state: 'error', error: safe(S, id, String(row.error)) };
    return { state: row.pass ? 'passes' : 'differs', reasons: row.reasons ?? [] };
  } catch (e) {
    return { state: 'error', error: safe(S, id, /** @type {Error} */ (e).message ?? 'error') };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
