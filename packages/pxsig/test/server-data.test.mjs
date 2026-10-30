/**
 * server-data.test.mjs — `GET /__pxsig/data`, the dashboard's live report, from a `pxsig serve` on
 * a fixture project in a temp dir.
 *
 *   node --test packages/pxsig/test/server-data.test.mjs
 *
 * Covers: the answer's shape for a named project and for the only project, that it is read on each
 * request (no cache), and that an unknown or path-like project name is a 404 naming the projects.
 * Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, hasRust } from './fixture.mjs';
import { serve } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

/**
 * The keys of the answer these tests read (src/report.mjs buildData).
 * @typedef {{
 *   project: string, label: string, store: string, generatedAt: string,
 *   versions: { pxsig: string }, check: { rows: { id: string, pass: boolean }[] },
 *   review: Record<string, unknown>, storybook: { baseUrl: string },
 *   paths: Record<string, string>, sigs: Record<string, string>, error?: string,
 * }} Data
 */

/**
 * @param {string} base
 * @param {string} [query]
 */
const data = async (base, query = '') => {
  const r = await fetch(`${base}/__pxsig/data${query}`);
  return { status: r.status, headers: r.headers, body: /** @type {Data} */ (await r.json()) };
};

test(
  "GET /__pxsig/data answers the project's report, its links and its signatures, read on each request",
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      const r = await data(S.base, '?project=fixture');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.match(/** @type {string} */ (r.headers.get('content-type')), /^application\/json/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const d = r.body;
      assert.equal(d.project, 'fixture');
      assert.equal(d.label, 'fixture');
      assert.equal(d.store, '.pxsig');
      assert.match(d.versions.pxsig, /^\d+\.\d+\.\d+/);
      assert.ok(Date.parse(d.generatedAt) > Date.now() - 60_000);
      const report = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
      assert.deepEqual(
        d.check.rows.map((x) => x.id),
        report.rows.map((/** @type {{ id: string }} */ x) => x.id)
      );
      assert.deepEqual(d.review, {});
      assert.equal(d.storybook.baseUrl, 'http://127.0.0.1:1');
      assert.deepEqual(d.paths, {
        diffRoot: '/p/fixture/diffs/',
        renders: '/p/fixture/renders/',
        baselines: '/p/fixture/baselines/',
      });
      assert.deepEqual(Object.keys(d.sigs).sort(), f.manifest.stories.map((e) => e.id).sort());
      assert.equal(d.sigs[f.ids.ok], `/p/fixture/sig/${f.ids.ok}`);
      // The signature link answers the baseline's header.
      const sig = await fetch(`${S.base}${d.sigs[f.ids.ok]}`);
      assert.equal(sig.status, 200);
      assert.equal(/** @type {{ format: string }} */ (await sig.json()).format, 'psig');

      // One project: naming it is optional.
      const only = await data(S.base);
      assert.equal(only.status, 200);
      assert.equal(only.body.project, 'fixture');

      // Live: a report written after the server started is what the next request reads.
      report.rows.find((/** @type {{ id: string }} */ x) => x.id === f.ids.ok).pass = false;
      writeFileSync(join(f.px, 'reports', 'check.json'), JSON.stringify(report));
      const again = await data(S.base, '?project=fixture');
      assert.equal(again.body.check.rows.find((x) => x.id === f.ids.ok)?.pass, false);
    } finally {
      S.stop();
    }
  }
);

test(
  'GET /__pxsig/data for an unknown or path-like project is a 404 naming the projects',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      for (const name of ['nope', '../x', '..%2F..%2Fx', 'fixture/../fixture']) {
        const r = await data(S.base, `?project=${name}`);
        const shown = decodeURIComponent(name);
        assert.equal(r.status, 404, name);
        assert.equal(r.body.error, `no project "${shown}" (projects: fixture)`, name);
        assert.equal(r.body.project, undefined, `${name}: no report in the answer`);
      }
    } finally {
      S.stop();
    }
  }
);
