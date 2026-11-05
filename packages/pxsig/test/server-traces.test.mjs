/**
 * server-traces.test.mjs — integrity's tracing kept between passes (src/serve/traces.mjs): a pass
 * for a baseline or a render reuses the last pass's answers and calls no engine; anything that can
 * change an answer traces again; the ledger is the same either way.
 *
 *   node --test packages/pxsig/test/server-traces.test.mjs
 *
 * The in-process half needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { runIntegrity } from '../src/serve/integrity.mjs';
import { traceCache } from '../src/serve/traces.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ProjectState } from '../src/serve/projects.mjs' */
/** @import { ManifestEntry } from '../src/types.js' */

/**
 * A pass as reconcile makes it: one tracer call per file, all at once.
 * @param {ReturnType<typeof traceCache>} cache
 * @param {ProjectState} S
 * @param {string} root
 * @param {string[]} files
 */
const pass = (cache, S, root, files) => {
  const tracer = cache.tracer(S, root);
  return Promise.all(files.map((f) => tracer(f)));
};

test('the same files, mtimes and entries reuse the answers; any change traces every file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-traces-'));
  try {
    for (const f of ['a.tsx', 'b.tsx', 'c.tsx']) writeFileSync(join(root, f), f);
    /** @type {string[]} */
    let calls = [];
    let fail = false;
    const S = /** @type {ProjectState} */ (
      /** @type {unknown} */ ({
        manifest: { stories: [{ id: 'a--x', importPath: 'a.tsx' }] },
        /** @param {string} f */
        affected: (f) => {
          calls.push(f);
          return fail
            ? Promise.reject(new Error('engine'))
            : Promise.resolve([`${f}:${calls.length}`]);
        },
      })
    );
    const cache = traceCache();
    const first = await pass(cache, S, root, ['a.tsx', 'b.tsx']);
    assert.deepEqual(calls, ['a.tsx', 'b.tsx']);

    calls = [];
    assert.deepEqual(await pass(cache, S, root, ['b.tsx', 'a.tsx']), [first[1], first[0]]);
    assert.deepEqual(calls, [], 'same set in another order: no engine call');

    /** @param {string} why @param {() => void} change */
    const retraces = async (why, change) => {
      change();
      calls = [];
      await pass(cache, S, root, ['a.tsx', 'b.tsx']);
      assert.deepEqual(calls.sort(), ['a.tsx', 'b.tsx'], why);
    };
    await retraces('a new mtime', () => utimesSync(join(root, 'a.tsx'), 1000, 1000));
    await retraces('an entry added', () =>
      S.manifest.stories.push(/** @type {ManifestEntry} */ ({ id: 'b--y', importPath: 'b.tsx' }))
    );
    await retraces('cleared', () => cache.clear());
    calls = [];
    await pass(cache, S, root, ['a.tsx', 'b.tsx', 'c.tsx']);
    assert.equal(calls.length, 3, 'one more edited file: every file traced');
    calls = [];
    await pass(cache, S, root, ['a.tsx', 'b.tsx']);
    assert.equal(calls.length, 2, 'one fewer: every file traced');

    cache.clear();
    fail = true;
    await assert.rejects(pass(cache, S, root, ['a.tsx', 'b.tsx']));
    fail = false;
    calls = [];
    await pass(cache, S, root, ['a.tsx', 'b.tsx']);
    assert.equal(calls.length, 2, 'a failed trace is not kept');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "in process: a baselines pass after a full one calls no engine and writes the full pass's ledger",
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    // An edit newer than every verdict, so passes trace it.
    const now = Date.now() / 1000;
    utimesSync(join(f.repo, 'src/components/Alpha/Alpha.stories.tsx'), now, now);
    const app = createPxsigServer({
      ws: findWorkspace({ cwd: f.repo }),
      flags: {},
      port: 0,
      open: false,
    });
    try {
      await app.start();
      const { srv } = app;
      const S = [...srv.states.values()][0];
      await S.integrityDone;
      let calls = 0;
      const trace = srv.trace;
      srv.trace = (m, p) => (calls++, trace(m, p));
      /** The ledger without its timings. */
      const ledger = () =>
        Object.fromEntries(
          Object.entries(/** @type {object} */ (S.integrity)).filter(
            ([k]) => k !== 'elapsedMs' && k !== 'generatedAt'
          )
        );

      await runIntegrity(srv, S, 'source changed');
      assert.ok(calls > 0, 'a source change traces');
      assert.equal(S.integrity?.sources.staleness.method, 'import-graph');
      assert.ok(S.integrity?.sources.staleness.filesTraced, 'the edit is traced');
      const full = ledger();

      calls = 0;
      for (const why of ['baselines changed', 'renders changed']) {
        await runIntegrity(srv, S, why);
        assert.equal(calls, 0, `${why}: no engine call`);
        assert.deepEqual(ledger(), full, `${why}: the same ledger`);
      }
      for (const why of ['check', 'request', 'manifest changed']) {
        calls = 0;
        await runIntegrity(srv, S, why);
        assert.ok(calls > 0, `${why}: traced again`);
        assert.deepEqual(ledger(), full, `${why}: the same ledger`);
      }
    } finally {
      await app.stop();
    }
  }
);
