/**
 * A dashboard build from another commit of pxsig's checkout, or with other uncommitted changes,
 * is out of date (lib/build-identity.mjs): `pxsig serve` passes over it with the same note as for
 * another version, says so for a stale prebuilt dashboard (and still serves it), and `pxsig doctor`
 * reports both as `dashboard-stale`. A build with no commit (a release) or no checkout (an
 * installed pxsig) is compared by version only, as before.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDirFor, chooseDashboard, shellWord, STAMP } from '../src/lib/dashboard-dir.mjs';
import { dashboardProblems } from '../src/lib/integrity/dashboard.mjs';
import { fixture, tempDir } from './fixture.mjs';

const V = '9.9.9';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const AT_A = { commit: A, dirty: false };

/**
 * A built dashboard in `dir`, its stamp in `file`.
 * @param {string} dir
 * @param {Record<string, unknown>} stamp
 * @param {string} [file]
 */
function build(dir, stamp, file = STAMP) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(
    join(dir, file),
    JSON.stringify({ pxsig: V, builtAt: Date.now(), files: ['index.html'], ...stamp })
  );
  return dir;
}

/** A project folder whose config names a built-in adapter. */
function adapterProject() {
  const dir = tempDir('proj');
  writeFileSync(join(dir, 'pxsig.config.json'), JSON.stringify({ dashboard: { ui: 'plain' } }));
  return { name: 'a', dir, configPath: join(dir, 'pxsig.config.json') };
}

test('serve: a PXSIG_DASHBOARD_DIR build from another commit or other changes is passed over, with the rebuild command', () => {
  const prebuilt = build(tempDir('pre'), { commit: null, dirty: null }, 'BUILD.json');
  const dir = build(tempDir('env'), { commit: B, dirty: false });
  const choose = (
    /** @type {import('../src/lib/build-identity.mjs').SourceState | null} */ checkout
  ) =>
    chooseDashboard({
      projects: [],
      prebuilt,
      version: V,
      env: { PXSIG_DASHBOARD_DIR: dir },
      checkout,
    });
  const r = choose(AT_A);
  assert.deepEqual([r.source, r.dir], ['prebuilt', prebuilt]);
  assert.equal(
    r.note,
    `dashboard: the build in ${dir} (PXSIG_DASHBOARD_DIR) is from commit bbbbbbb (the checkout is at aaaaaaa): run \`pxsig dashboard build --out ${shellWord(dir)}\`. Serving the prebuilt dashboard.`
  );
  assert.equal(choose({ commit: B, dirty: false }).source, 'env', 'the same commit is served');
  assert.match(
    /** @type {string} */ (choose({ commit: B, dirty: true }).note),
    /built before the checkout's uncommitted changes: run `pxsig dashboard build --out /
  );
  assert.equal(choose(null).source, 'env', 'an installed pxsig compares the version only');
});

test("serve: a project's dashboard.ui build from another commit is passed over; one with no commit is not", () => {
  const p = adapterProject();
  const prebuilt = tempDir('pre');
  const out = build(buildDirFor(p.dir), { commit: B, dirty: false });
  const r = chooseDashboard({ projects: [p], prebuilt, version: V, root: p.dir, checkout: AT_A });
  assert.equal(r.source, 'prebuilt');
  assert.equal(
    r.note,
    'dashboard: the build for dashboard.ui (plain) in pxsig.config.json is from commit bbbbbbb (the checkout is at aaaaaaa): run `pxsig dashboard build` in .. Serving the prebuilt dashboard.'
  );
  build(out, { commit: null, dirty: null });
  assert.equal(
    chooseDashboard({ projects: [p], prebuilt, version: V, root: p.dir, checkout: AT_A }).source,
    'adapter',
    'a release build: by version only'
  );
});

test('serve: a stale prebuilt dashboard is still served, with a note naming its rebuild', () => {
  const prebuilt = build(tempDir('pre'), { commit: B, dirty: false }, 'BUILD.json');
  const r = chooseDashboard({ projects: [], prebuilt, version: V, checkout: AT_A });
  assert.deepEqual([r.source, r.dir], ['prebuilt', prebuilt]);
  assert.equal(
    r.note,
    'dashboard: the prebuilt dashboard is from commit bbbbbbb (the checkout is at aaaaaaa): run `pnpm build:dashboard` in the pxsig checkout.'
  );
  // After another note: one line each (serve prints each with its prefix).
  const p = adapterProject();
  const both = chooseDashboard({
    projects: [p],
    prebuilt,
    version: V,
    root: p.dir,
    checkout: AT_A,
  });
  assert.deepEqual(
    /** @type {string} */ (both.note).split('\n').map((l) => l.split(' ').slice(0, 4).join(' ')),
    ['dashboard: dashboard.ui (plain) in', 'dashboard: the prebuilt dashboard']
  );
  for (const checkout of [{ commit: B, dirty: false }, null])
    assert.equal(
      chooseDashboard({ projects: [], prebuilt, version: V, checkout }).note,
      null,
      'current, or installed'
    );
});

test('doctor: dashboard-stale for a build from another commit, and for a stale prebuilt dashboard serve would serve', () => {
  const f = fixture({ withSigs: false });
  const prebuilt = build(tempDir('pre'), { commit: A, dirty: false }, 'BUILD.json');
  const at = (
    /** @type {Record<string, string>} */ env,
    /** @type {import('../src/lib/build-identity.mjs').SourceState | null} */ checkout
  ) => dashboardProblems(f.ctx, { env, version: V, cwd: f.repo, checkout, prebuilt });
  build(join(f.repo, 'mine'), { commit: B, dirty: false });
  assert.deepEqual(at({ PXSIG_DASHBOARD_DIR: 'mine' }, AT_A), [
    {
      code: 'dashboard-stale',
      severity: 'warn',
      reason:
        'the dashboard build in ./mine (PXSIG_DASHBOARD_DIR) is from commit bbbbbbb (the checkout is at aaaaaaa): `pxsig serve` serves the prebuilt dashboard instead. To serve it, run `pxsig dashboard build --out ./mine`',
    },
  ]);
  assert.deepEqual(
    at({ PXSIG_DASHBOARD_DIR: 'mine' }, { commit: B, dirty: false }),
    [],
    'mine is current: the prebuilt one is not served'
  );
  assert.deepEqual(at({}, { commit: B, dirty: false }), [
    {
      code: 'dashboard-stale',
      severity: 'warn',
      reason:
        'the prebuilt dashboard is from commit aaaaaaa (the checkout is at bbbbbbb): `pxsig serve` serves it as it is. To rebuild it, run `pnpm build:dashboard` in the pxsig checkout',
    },
  ]);
  assert.deepEqual(at({}, AT_A), [], 'no build asked for, the prebuilt one current');
  assert.deepEqual(at({}, null), [], 'installed: nothing to compare');
  assert.deepEqual(
    at({}, { commit: A, dirty: true }).map((x) => x.reason.split(':')[0]),
    ["the prebuilt dashboard was built before the checkout's uncommitted changes"]
  );
});
