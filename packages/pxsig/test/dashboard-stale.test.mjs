// `dashboard-stale` (lib/integrity/dashboard.mjs): pxsig doctor names a dashboard build that
// `pxsig serve` would pass over for another pxsig version, with the command that fixes it, and
// says nothing more when no build is stale.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDirFor, STAMP } from '../src/lib/dashboard-dir.mjs';
import { dashboardProblems } from '../src/lib/integrity/dashboard.mjs';
import { reconcile, writeLedger } from '../src/lib/integrity.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { here } from './integrity-helpers.mjs';
import { skipUnless } from './strict.mjs';

const V = '9.9.9';

/**
 * A built dashboard in `dir`, recording `pxsig` (or no version).
 * @param {string} dir
 * @param {string | null} pxsig
 */
function build(dir, pxsig) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, STAMP), JSON.stringify(pxsig ? { pxsig } : { builtAt: 1 }));
  return dir;
}

test('PXSIG_DASHBOARD_DIR: another version or none is stale, with the build command; this version or no build is not', () => {
  const f = fixture({ withSigs: false });
  const at = (/** @type {Record<string, string>} */ env) =>
    dashboardProblems(f.ctx, { env, version: V, cwd: f.repo });
  build(join(f.repo, 'old'), '0.0.1');
  assert.deepEqual(at({ PXSIG_DASHBOARD_DIR: 'old' }), [
    {
      code: 'dashboard-stale',
      severity: 'warn',
      reason:
        'the dashboard build in ./old (PXSIG_DASHBOARD_DIR) is from pxsig 0.0.1 (this is 9.9.9): `pxsig serve` serves the prebuilt dashboard instead. To serve it, run `pxsig dashboard build --out ./old`',
    },
  ]);
  build(join(f.repo, 'bare'), null);
  assert.match(
    at({ PXSIG_DASHBOARD_DIR: join(f.repo, 'bare') })[0].reason,
    /^the dashboard build in \.\/bare \(PXSIG_DASHBOARD_DIR\) records no pxsig version \(this is 9\.9\.9\)/
  );
  build(join(f.repo, 'current'), V);
  assert.deepEqual(at({ PXSIG_DASHBOARD_DIR: 'current' }), []);
  assert.deepEqual(at({ PXSIG_DASHBOARD_DIR: 'nothing-built' }), []);
  assert.deepEqual(at({}), [], 'no dashboard.ui, no PXSIG_DASHBOARD_DIR');
});

test("the project's dashboard.ui build: stale for another version, its severity configurable", () => {
  const f = fixture({ withSigs: false });
  const cfgPath = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, dashboard: { ui: './pxsig-ui' } }));
  const at = () => dashboardProblems(f.ctx, { env: {}, version: V, cwd: f.repo });
  assert.deepEqual(at(), [], 'no build yet: serve says so itself');
  build(buildDirFor(f.repo), '0.0.1');
  assert.deepEqual(at(), [
    {
      code: 'dashboard-stale',
      severity: 'warn',
      reason:
        'the dashboard build for dashboard.ui (./pxsig-ui) is from pxsig 0.0.1 (this is 9.9.9): `pxsig serve` serves the prebuilt dashboard instead. To serve it, run `pxsig dashboard build` in .',
    },
  ]);
  const quiet = {
    ...f.ctx,
    integrity: { ...f.ctx.integrity, severity: { 'dashboard-stale': 'info' } },
  };
  assert.equal(
    dashboardProblems(/** @type {typeof f.ctx} */ (quiet), { env: {}, version: V, cwd: f.repo })[0]
      .severity,
    'info'
  );
  build(buildDirFor(f.repo), V);
  assert.deepEqual(at(), []);
});

test(
  'pxsig doctor: a stale build adds one setup line; a current one leaves the output byte for byte',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture({ withSigs: false });
    writeLedger(f.ctx, await reconcile(f.ctx, { index: f.index, affected: f.affected }));
    const version = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
    build(join(f.repo, 'current'), version);
    build(join(f.repo, 'old'), '0.0.1');
    const doctor = (/** @type {Record<string, string>} */ env) => {
      const r = spawnSync(
        process.execPath,
        [join(here, '..', 'src', 'cli.mjs'), 'doctor', '--offline'],
        {
          cwd: f.repo,
          encoding: 'utf8',
          env: { ...testEnv(testHome), PXSIG_FORMAT: 'text', PXSIG_BIN: rustBin, ...env },
        }
      );
      return { out: r.stdout.replace(/\d+(\.\d+)?\s?(ms|s)\b/g, '<t>'), status: r.status };
    };
    const plain = doctor({});
    assert.deepEqual(doctor({ PXSIG_DASHBOARD_DIR: 'current' }), plain);
    const stale = doctor({ PXSIG_DASHBOARD_DIR: 'old' });
    assert.equal(stale.status, plain.status, 'a warn setup problem never changes the exit code');
    assert.ok(
      stale.out.includes(
        `setup: dashboard-stale — the dashboard build in ./old (PXSIG_DASHBOARD_DIR) is from pxsig 0.0.1 (this is ${version}): \`pxsig serve\` serves the prebuilt dashboard instead. To serve it, run \`pxsig dashboard build --out ./old\``
      ),
      stale.out
    );
  }
);
