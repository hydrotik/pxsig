/**
 * react-progress.test.mjs — the parts the server's React view builds on: an analysis run's
 * progress and Skip (`onProgress`, `signal`), a closed worker pool settling what it was asked,
 * render counts stamped with when and the counts before (`stampRenders`), and `data.react` in a
 * static report (lib/react/data.mjs).
 *
 *   node --test packages/pxsig/test/react-progress.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyse } from '../src/lib/react/index.mjs';
import { reactData } from '../src/lib/react/data.mjs';
import { createPool } from '../src/lib/react/pool.mjs';
import { stampRenders } from '../src/lib/rows.mjs';
import { hasRust } from './fixture.mjs';
import { fixtureModules, hasCompiler, projectAt, reactProject } from './react-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ReactProgress, RenderCounts } from '../src/types/react.js' */

const skip = skipUnless(
  hasRust && hasCompiler,
  'the engine or the React Compiler test fixtures are missing'
);

test('a run reports each file done; a second run is all cached', { skip }, async (t) => {
  const P = projectAt(reactProject(t));
  /** @type {ReactProgress[]} */
  const seen = [];
  const r = await analyse(P, { onProgress: (p) => seen.push({ ...p }) });
  assert.ok(r.ran);
  assert.deepEqual(seen, [
    { done: 0, total: 1, cached: 0 },
    { done: 1, total: 1, cached: 0 },
  ]);
  /** @type {ReactProgress[]} */
  const again = [];
  await analyse(P, { onProgress: (p) => again.push({ ...p }) });
  assert.deepEqual(again, [{ done: 1, total: 1, cached: 1 }]);
});

test('a skipped run writes nothing and says so', { skip }, async (t) => {
  const P = projectAt(reactProject(t));
  const ctl = new AbortController();
  ctl.abort();
  const before = await analyse(P, { signal: ctl.signal });
  assert.deepEqual(before, {
    ran: false,
    why: 'skipped',
    text: 'react: analysis skipped: nothing written',
  });
  assert.ok(!existsSync(join(P.store.reports, 'react.json')));
  // Skipped while compiling: the workers end, and the run answers at once.
  const mid = new AbortController();
  const r = await analyse(P, {
    signal: mid.signal,
    onProgress: (p) => {
      if (p.done === 0) setImmediate(() => mid.abort());
    },
  });
  assert.equal(r.ran ? 'ran' : r.why, 'skipped');
  assert.ok(!existsSync(join(P.store.reports, 'react.json')));
});

test('a closed pool answers what it was still asked', { skip }, async () => {
  const mods = fixtureModules(7);
  const pool = createPool({
    size: 1,
    babel: join(mods, '@babel', 'core'),
    compiler: join(mods, 'babel-plugin-react-compiler'),
    cwd: process.cwd(),
    options: { compilationMode: 'infer', target: '19', environment: {}, lint: false },
  });
  const task = { path: 'a.tsx', text: 'export function A() { return null; }', parser: ['jsx'] };
  const answers = [pool.compile(task), pool.compile(task), pool.compile(task)];
  await pool.close();
  for (const a of await Promise.all(answers))
    assert.ok('error' in a || 'functions' in a, JSON.stringify(a));
});

test('render counts get when, and the counts of the row they replace', () => {
  /** @type {RenderCounts} */
  const counts = {
    v: 1,
    build: 'production',
    react: '19.3.0',
    mount: { commits: 3, rendered: 12 },
    top: [],
    settled: true,
  };
  const at = '2026-11-05T12:00:00.000Z';
  const first = stampRenders({ id: 'a--b', renders: counts }, undefined, at);
  assert.deepEqual(first.renders, { ...counts, at });
  const next = stampRenders(
    { id: 'a--b', renders: { ...counts, mount: { commits: 5, rendered: 20 } } },
    first,
    '2026-11-05T13:00:00.000Z'
  );
  assert.deepEqual(next.renders?.prev, { commits: 3, rendered: 12, at });
  // No counts, or no React (null): as it was.
  /** @type {{ id: string, renders?: RenderCounts | null }} */
  const none = { id: 'a--b' };
  assert.equal(stampRenders(none, first, at), none);
  const notReact = { id: 'a--b', renders: null };
  assert.equal(stampRenders(notReact, first, at), notReact);
});

test('a static report has data.react only with results; who wrote them', { skip }, async (t) => {
  const dir = reactProject(t);
  const P = projectAt(dir);
  assert.equal(reactData(P), null);
  assert.equal(reactData(P, { check: { rows: [{}] } }), null);
  const counted = reactData(P, { check: { rows: [{ renders: null }] } });
  assert.deepEqual(
    [counted?.status.compiler, counted?.report, counted?.source],
    ['ready', null, null]
  );
  const r = await analyse(P);
  assert.ok(r.ran);
  assert.equal(reactData(P)?.source, 'react-cli');
  const { summary, alerts, base, backend } = r.report;
  assert.equal(
    reactData(P, { check: { react: { summary, alerts, base, backend } } })?.source,
    'check'
  );
  // Served: always there, and what the server knows.
  const live = reactData(P, {
    live: {
      running: true,
      error: null,
      skipped: false,
      held: null,
      stale: { files: 2, since: 'x' },
      missing: [],
      wrote: r.report.generatedAt,
      report: null,
    },
  });
  assert.deepEqual(
    [live?.status.compiler, live?.status.stale, live?.source],
    ['running', { files: 2, since: 'x' }, 'server']
  );
  // Bad config: the warning without its prefix.
  writeFileSync(
    join(dir, 'pxsig.config.json'),
    JSON.stringify({ name: 'react-fixture', srcRoot: 'src', react: { target: '16' } })
  );
  const bad = reactData(projectAt(dir), { check: { rows: [{ renders: null }] } });
  assert.equal(bad?.status.compiler, 'bad-config');
  assert.match(String(bad?.status.configWarning), /^react\.target must be/);
});
