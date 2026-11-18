/**
 * A dashboard build's identity (lib/build-identity.mjs): the commit of pxsig's checkout and its
 * uncommitted changes under the paths that feed the build, none outside a checkout or from an
 * installed package; the identity the API carries (no path); and the rules that make a build out of
 * date when its source is not the checkout's.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  buildIdentity,
  pxsigSource,
  sourceFields,
  sourceMismatch,
} from '../src/lib/build-identity.mjs';
import { buildData, dashboardDir, useDashboard } from '../src/report.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

/** @param {string} root @param {string[]} args */
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** @param {string} root @param {string} p @param {string} [text] */
const put = (root, p, text = 'x') => {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), text);
};

/** A pxsig-shaped checkout with one commit. */
function checkout() {
  const root = tempDir('src');
  git(root, 'init', '-q');
  put(root, 'packages/pxsig/package.json', '{}');
  put(root, 'packages/dashboard/src/a.ts');
  put(root, 'packages/dashboard/test/a.test.mjs');
  put(root, 'README.md');
  git(root, 'add', '-A');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one');
  return { root, pkg: join(root, 'packages', 'pxsig'), head: git(root, 'rev-parse', 'HEAD') };
}

test("pxsigSource: the checkout's commit; dirty only for changes under the paths that feed the build", () => {
  const c = checkout();
  assert.deepEqual(pxsigSource(c.pkg), { commit: c.head, dirty: false });
  put(c.root, 'README.md', 'changed');
  put(c.root, 'packages/dashboard/test/a.test.mjs', 'changed');
  assert.deepEqual(pxsigSource(c.pkg), { commit: c.head, dirty: false }, 'tests and docs: clean');
  put(c.root, 'packages/dashboard/src/a.ts', 'changed');
  assert.deepEqual(pxsigSource(c.pkg), { commit: c.head, dirty: true }, 'an edited source');
  git(c.root, 'checkout', '-q', '--', 'packages/dashboard/src/a.ts');
  put(c.root, 'packages/dashboard/src/new.ts');
  assert.deepEqual(pxsigSource(c.pkg), { commit: c.head, dirty: true }, 'a new, untracked source');
});

test('pxsigSource: null outside a git checkout, for an installed package, or in a checkout that is not pxsig', () => {
  const plain = tempDir('plain');
  mkdirSync(join(plain, 'packages', 'pxsig'), { recursive: true });
  assert.equal(pxsigSource(join(plain, 'packages', 'pxsig')), null, 'no git checkout');
  const c = checkout();
  const installed = join(c.root, 'node_modules', 'pxsig');
  mkdirSync(installed, { recursive: true });
  assert.equal(pxsigSource(installed), null, 'under node_modules: the release');
  const other = join(c.root, 'vendor', 'pxsig');
  mkdirSync(other, { recursive: true });
  assert.equal(pxsigSource(other), null, "another repository's folder");
  assert.deepEqual(sourceFields(null), { commit: null, dirty: null });
  assert.deepEqual(sourceFields({ commit: A, dirty: true }), { commit: A, dirty: true });
});

test('buildIdentity: the same fields from either stamp, with no path; null without one', () => {
  const ref = tempDir('ref');
  writeFileSync(
    join(ref, 'BUILD.json'),
    JSON.stringify({
      adapter: 'hydrotik',
      pxsig: '0.7.7',
      commit: A,
      dirty: true,
      designSystem: { commit: B, dirty: false, lockSha256: 'f'.repeat(64) },
      builtAt: '2026-11-18T17:18:44.273Z',
      bundled: [],
    })
  );
  assert.deepEqual(buildIdentity(ref), {
    pxsig: '0.7.7',
    commit: A,
    dirty: true,
    designSystem: { commit: B, dirty: false },
    adapter: 'hydrotik',
    builtAt: '2026-11-18T17:18:44.273Z',
  });
  const own = tempDir('own');
  writeFileSync(
    join(own, 'pxsig-build.json'),
    JSON.stringify({
      adapter: join(own, 'pxsig-ui', 'index.ts'),
      adapterName: 'pxsig-ui',
      pxsig: '0.7.7',
      commit: null,
      dirty: null,
      builtAt: Date.UTC(2026, 10, 18, 12, 0),
      files: ['index.html'],
    })
  );
  const id = buildIdentity(own);
  assert.deepEqual(id, {
    pxsig: '0.7.7',
    commit: null,
    dirty: null,
    designSystem: null,
    adapter: 'pxsig-ui',
    builtAt: '2026-11-18T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(id).includes(own), false, "the adapter's file is not carried");
  // A stamp from before the identity: the version only.
  writeFileSync(join(own, 'pxsig-build.json'), JSON.stringify({ pxsig: '0.7.6', adapter: '/x/y' }));
  assert.deepEqual(buildIdentity(own), {
    pxsig: '0.7.6',
    commit: null,
    dirty: null,
    designSystem: null,
    adapter: null,
    builtAt: null,
  });
  assert.equal(buildIdentity(tempDir('none')), null);
});

test('sourceMismatch: another commit, or a different dirty state, is out of date; no commit or no checkout never is', () => {
  const dir = tempDir('stamp');
  const stamp = (/** @type {Record<string, unknown>} */ s) =>
    writeFileSync(join(dir, 'BUILD.json'), JSON.stringify({ pxsig: '0.7.7', ...s }));
  stamp({ commit: A, dirty: false });
  assert.equal(sourceMismatch(dir, { commit: A, dirty: false }), null);
  assert.equal(
    sourceMismatch(dir, { commit: B, dirty: false }),
    'is from commit aaaaaaa (the checkout is at bbbbbbb)'
  );
  assert.equal(
    sourceMismatch(dir, { commit: A, dirty: true }),
    "was built before the checkout's uncommitted changes"
  );
  assert.equal(sourceMismatch(dir, null), null, 'installed: nothing to compare');
  stamp({ commit: A, dirty: true });
  assert.equal(
    sourceMismatch(dir, { commit: A, dirty: false }),
    'was built with uncommitted changes (the checkout has none now)'
  );
  assert.equal(sourceMismatch(dir, { commit: A, dirty: true }), null);
  stamp({ commit: null, dirty: null });
  assert.equal(sourceMismatch(dir, { commit: B, dirty: true }), null, 'a release build');
});

test("the dashboard data (GET /__pxsig/data) carries the served build's identity, with no path", () => {
  const root = tempDir('proj');
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'pxsig.config.json'), JSON.stringify({ version: 1, name: 'ui' }));
  const dash = tempDir('dash');
  writeFileSync(
    join(dash, 'pxsig-build.json'),
    JSON.stringify({
      adapter: join(dash, 'ui', 'index.ts'),
      adapterName: 'ui',
      pxsig: '0.7.7',
      commit: A,
      dirty: false,
      builtAt: 0,
    })
  );
  const was = dashboardDir;
  useDashboard(dash);
  try {
    const d = buildData(openProject({ cwd: root }));
    assert.deepEqual(d.build, {
      pxsig: '0.7.7',
      commit: A,
      dirty: false,
      designSystem: null,
      adapter: 'ui',
      builtAt: '1970-01-01T00:00:00.000Z',
    });
    assert.equal(JSON.stringify(d.build).includes(dash), false);
    useDashboard(tempDir('unbuilt'));
    assert.equal(buildData(openProject({ cwd: root })).build, null, 'no stamp: null');
  } finally {
    useDashboard(was);
  }
});
