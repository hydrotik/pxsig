// dashboard-build.mjs: this repository's build is hydrotik unless another adapter is named, from
// PXSIG_DS_SOURCE's checkout or the pinned target/design-system, and fails rather than build plain.
// vite.config.mjs, run by Vite directly with no adapter named, refuses too.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { repoBuildEnv } from './dashboard-build.mjs';
import { DsFetchError, NO_SOURCE } from './ds-fetch.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** @param {import('node:test').TestContext} t */
const tmp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-dash-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** `ensure` that records its calls and returns a stand-in folder. */
const fetcher = () => {
  const calls = { n: 0 };
  return { calls, ensure: () => (calls.n++, '/fetched/design-system') };
};

test('no adapter named: hydrotik, on the pinned design system in target/', (t) => {
  const f = fetcher();
  const { add, why } = repoBuildEnv({
    env: { PXSIG_UI_ADAPTER: '' },
    cwd: tmp(t),
    ensure: f.ensure,
  });
  assert.deepEqual(add, {
    PXSIG_UI_ADAPTER: 'hydrotik',
    PXSIG_DS_SOURCE: '/fetched/design-system',
  });
  assert.equal(f.calls.n, 1);
  assert.match(why, /hydrotik \(this repository\), design system from target\/design-system/);
});

test('PXSIG_DS_SOURCE naming a checkout: that checkout, nothing fetched', (t) => {
  const f = fetcher();
  const ds = tmp(t);
  const { add } = repoBuildEnv({ env: { PXSIG_DS_SOURCE: ds }, cwd: tmp(t), ensure: f.ensure });
  assert.deepEqual(add, { PXSIG_UI_ADAPTER: 'hydrotik', PXSIG_DS_SOURCE: ds });
  assert.equal(f.calls.n, 0);
});

test('PXSIG_DS_SOURCE naming no folder (a git URL): the fetch, which reads it as its source', (t) => {
  const f = fetcher();
  const env = { PXSIG_DS_SOURCE: 'https://example.invalid/ds.git' };
  assert.equal(
    repoBuildEnv({ env, cwd: tmp(t), ensure: f.ensure }).add.PXSIG_DS_SOURCE,
    '/fetched/design-system'
  );
  assert.equal(f.calls.n, 1);
});

test('another adapter named: built as named, nothing fetched', (t) => {
  const f = fetcher();
  for (const env of [{ PXSIG_UI_ADAPTER: 'plain' }, { PXSIG_UI_ADAPTER: './some/adapter' }])
    assert.deepEqual(repoBuildEnv({ env, cwd: tmp(t), ensure: f.ensure }).add, {});
  const cwd = tmp(t);
  writeFileSync(join(cwd, 'pxsig.config.json'), JSON.stringify({ dashboard: { ui: 'plain' } }));
  assert.deepEqual(repoBuildEnv({ env: {}, cwd, ensure: f.ensure }).add, {});
  assert.equal(f.calls.n, 0);
});

test('hydrotik named without PXSIG_DS_SOURCE: target/design-system too', (t) => {
  const f = fetcher();
  const { add } = repoBuildEnv({
    env: { PXSIG_UI_ADAPTER: 'hydrotik' },
    cwd: tmp(t),
    ensure: f.ensure,
  });
  assert.equal(add.PXSIG_DS_SOURCE, '/fetched/design-system');
  assert.equal(f.calls.n, 1);
});

test('no design system to be had: the build fails with the fix, never builds plain', (t) => {
  const ensure = () => {
    throw new DsFetchError(NO_SOURCE);
  };
  assert.throws(() => repoBuildEnv({ env: {}, cwd: tmp(t), ensure }), /git config pxsig\.dsSource/);
});

test('vite.config.mjs, run by Vite with no adapter named and no design system, refuses', (t) => {
  const dashboard = join(repo, 'packages', 'dashboard');
  const vite = join(dashboard, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.config.mjs'], {
    cwd: dashboard,
    encoding: 'utf8',
    env: {
      ...process.env,
      PXSIG_UI_ADAPTER: '',
      PXSIG_DS_SOURCE: '',
      INIT_CWD: tmp(t),
      PXSIG_DASHBOARD_OUT: join(tmp(t), 'out'),
    },
  });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /no adapter named: build with `pnpm build:dashboard`/);
});
