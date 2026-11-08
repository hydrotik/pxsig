/**
 * dashboard-fixtures.test.mjs — the dashboard's sample data (packages/dashboard/fixtures/
 * scenarios.mjs, which its flow tests and the locked screens render) against what a real
 * `GET /__pxsig/data` answers.
 *
 *   node --test packages/pxsig/test/dashboard-fixtures.test.mjs
 *
 * A fixture project is checked for real: once by `pxsig check` (the CLI writes check.json), then
 * by the server (`POST /__pxsig/check`, which rewrites it in its own shape), with the server's
 * integrity ledger, and one entry rejected through it. Every key path the scenarios set must be
 * one the server sent in either answer, with the same JSON type, so a field renamed on the server
 * fails here instead of leaving the mocked dashboard green. Needs the Rust binary and Chromium;
 * skipped without them.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from '../../dashboard/fixtures/scenarios.mjs';
import { fixture, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, serve, src } from './server-helpers.mjs';

/**
 * A JSON value's shape, merged over many values: the types seen, an object's keys, an array's items.
 * @typedef {{ types: Set<string>, keys: Map<string, Shape>, items: Shape | null }} Shape
 */

/**
 * Objects keyed by data (ids, codes, modes, suites), not by field names: their keys merge into `*`.
 * Paths name array items `[]`.
 */
const MAPS = new Set([
  'sigs',
  'review',
  'a11yReview',
  'scenarioSuites',
  'calibrationSuites',
  'check.envs',
  'check.manifest.modes',
  'check.manifest.gate',
  'integrity.summary.byCode',
  'integrity.summary.byStatus',
  'integrity.components[].counts',
  'bench.render.byConcurrency',
]);

/**
 * Top-level fields the server sends that no scenario sets; the dashboard renders without each.
 * A new one fails the test until a scenario sets it or it is listed here.
 */
const NOT_IN_SCENARIOS = new Set([
  'versions', // the top bar's tooltip and Help: "unknown" without it
  'gateCalibration', // a calibration run's output: none in a sample
  'scenarioSuites', // the same
  'calibrationSuites', // the same
  'approvals', // approvals.byStory: off unless set
  'source', // `dashboard-screens` only for pxsig's own screens
  'rejections', // the open rejections (lib/rejections.mjs): no dashboard view reads them yet
]);

/**
 * Fields the scenarios set that only some runs produce, so the fixture project's checks do not:
 * each names the source line that sets it, which must still be there.
 * @type {Record<string, [file: string, sets: RegExp]>}
 */
const ONLY_SOME_RUNS = {
  // A failing entry whose retry render passes.
  'check.rows[].flaky': ['check/render.mjs', /\brow\.flaky = true;/],
  // React render counts: with `react.renders` on, or a Measure renders run.
  'check.rows[].renders': ['lib/rows.mjs', /\{ renders: rr\.renders \}/],
};

/** @returns {Shape} */
const blank = () => ({ types: new Set(), keys: new Map(), items: null });

/** @param {unknown} v */
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Merge `v` into `into`.
 * @param {unknown} v
 * @param {string} path
 * @param {Shape} into
 * @returns {Shape}
 */
function shapeOf(v, path, into = blank()) {
  const k = kind(v);
  into.types.add(k);
  if (k === 'array')
    for (const x of /** @type {unknown[]} */ (v))
      into.items = shapeOf(x, `${path}[]`, into.items ?? blank());
  if (k === 'object')
    for (const [key, x] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
      const name = MAPS.has(path) ? '*' : key;
      into.keys.set(name, shapeOf(x, path ? `${path}.${name}` : name, into.keys.get(name)));
    }
  return into;
}

/**
 * What the scenarios set that the server does not send, or sends as another type.
 * @param {Shape} fx the scenarios' shape
 * @param {Shape} live the server's
 * @param {string} path
 * @param {{ problems: string[], unverified: string[] }} out
 */
function compare(fx, live, path, out) {
  const fxTypes = [...fx.types].filter((t) => t !== 'null');
  const liveTypes = [...live.types].filter((t) => t !== 'null');
  if (!fxTypes.length) return;
  // The server sent only null here (no bench run, no calibration): nothing to compare against.
  if (!liveTypes.length) return void out.unverified.push(path);
  for (const t of fxTypes)
    if (!liveTypes.includes(t))
      out.problems.push(
        `${path}: a ${t} in the scenarios, a ${liveTypes.join(' or ')} from the server`
      );
  for (const [key, s] of fx.keys) {
    const p = path ? `${path}.${key}` : key;
    const l = live.keys.get(key);
    if (l) compare(s, l, p, out);
    else if (!Object.hasOwn(ONLY_SOME_RUNS, p))
      out.problems.push(`${p}: set by the scenarios, never sent by the server`);
  }
  if (fx.items && live.items) compare(fx.items, live.items, `${path}[]`, out);
}

/** The data `/__pxsig/data` answered after a CLI check, and after a server check. */
async function liveData() {
  const f = fixture();
  // The fixture's check.json is hand-written: only real checks write the report compared here.
  rmSync(join(f.px, 'reports', 'check.json'));
  const sb = await fakeStorybook(f.index.stories);
  try {
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: sb.url } }));
    const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
    // Not spawnSync: the stand-in Storybook answers from this process's event loop.
    const child = spawn(process.execPath, [cli, 'check', '--all'], {
      cwd: f.repo,
      env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_FORMAT: '', PXSIG_URL: 'http://127.0.0.1:1' },
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const [code] = await once(child, 'close');
    // 1: the stand-in's renders differ from the fixture's baselines; any other code is a failure.
    assert.ok(code === 0 || code === 1, `pxsig check: ${code}\n${log}`);
    const S = await serve(f);
    try {
      const get = async (/** @type {string} */ what) => {
        const res = await fetch(`${S.base}/__pxsig/${what}`);
        assert.equal(res.status, 200, `${what}:\n${S.log()}`);
        return /** @type {Record<string, unknown>} */ (await res.json());
      };
      await get('integrity?fresh=1');
      const afterCli = await get('data');
      assert.equal((await S.post('check', { all: true })).status, 202, `server check:\n${S.log()}`);
      await S.idle();
      await get('integrity?fresh=1');
      // A decision, so the answer carries `review` (the session summary's scenarios set it).
      const rows = /** @type {{ rows: { id: string }[] }} */ ((await get('data')).check).rows;
      const id = rows[0].id;
      assert.equal((await S.post('reject', { id })).status, 200, `reject:\n${S.log()}`);
      return [afterCli, await get('data')];
    } finally {
      S.stop();
    }
  } finally {
    sb.close();
  }
}

test(
  "the dashboard's scenarios set only fields the server sends, with the server's types",
  { skip: needs },
  async () => {
    const answers = await liveData();
    for (const d of answers) {
      assert.ok(d.check, 'a check report');
      assert.ok(d.integrity, 'an integrity ledger');
    }
    const live = blank();
    for (const d of answers) shapeOf(d, '', live);
    const fx = blank();
    for (const make of Object.values(SCENARIOS)) shapeOf(make(), '', fx);

    /** @type {{ problems: string[], unverified: string[] }} */
    const out = { problems: [], unverified: [] };
    compare(fx, live, '', out);
    for (const key of live.keys.keys())
      if (!fx.keys.has(key) && !NOT_IN_SCENARIOS.has(key))
        out.problems.push(`${key}: sent by the server, set by no scenario (or NOT_IN_SCENARIOS)`);
    assert.deepEqual(out.problems, [], out.problems.join('\n'));
    for (const [p, [file, sets]] of Object.entries(ONLY_SOME_RUNS))
      assert.match(readFileSync(join(src, file), 'utf8'), sets, `${p}: no longer set in ${file}`);
    // Only the sections a sample project cannot produce go unchecked: a bench run, and the React
    // analysis' results (the fixture project has no React Compiler; react.json's shape is the
    // engine's, held by its own tests and lib/react/data.mjs's).
    assert.deepEqual(out.unverified, ['bench', 'react.status.off', 'react.report', 'react.source']);
  }
);
