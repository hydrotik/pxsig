/**
 * screens-source.test.mjs — a project whose manifest says `source: dashboard-screens` (pxsig's own
 * dashboard screens, scripts/screens-check.mjs): nothing fetches a Storybook for it, its entries
 * group by section, the dashboard is told, and `pxsig check` refuses it with what to run instead.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { componentOf, loadStoryIndex, resolveContext } from '../src/lib/integrity.mjs';
import { manifestSource, SCREENS } from '../src/lib/source.mjs';
import { ensureStorybook } from '../src/lib/static.mjs';
import { buildData } from '../src/report.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { cli, env, tree } from './features-helpers.mjs';

const entry = {
  id: 'inspector--header-1@dark',
  story: 'inspector--header-1',
  mode: 'dark',
  state: null,
  sig: '.pxsig/baselines/inspector/inspector--header-1@dark.psig',
  importPath: 'src/ui/features/inspector.ts',
};
/**
 * A project whose Storybook URL would answer nothing; `source` set or not.
 * @param {string} [source]
 */
const project = (source) =>
  tree({
    'pxsig.config.json': { name: 'pxsig', storybook: { url: 'http://127.0.0.1:1' } },
    '.pxsig/manifest.json': {
      version: 2,
      project: 'pxsig',
      ...(source ? { source } : {}),
      stories: [entry],
    },
  });
/** A fetch that fails the test when called. */
const noFetch = /** @type {typeof fetch} */ (
  async () => assert.fail('a project of screens fetched a Storybook')
);

test('the manifest names the source; anything else, or none, is a story project', () => {
  const P = openProject({ cwd: project(SCREENS), env });
  assert.equal(manifestSource(P.manifestPath()), SCREENS);
  assert.equal(manifestSource(openProject({ cwd: project(), env }).manifestPath()), 'storybook');
  assert.equal(
    manifestSource(openProject({ cwd: project('other'), env }).manifestPath()),
    'storybook'
  );
  assert.equal(manifestSource('/nowhere/manifest.json'), 'storybook');
});

test('a project of screens fetches no Storybook, and its components are sections', async () => {
  const P = openProject({ cwd: project(SCREENS), env });
  const sb = await ensureStorybook(P, { fetchImpl: noFetch });
  assert.equal(sb.served, false);
  const ctx = resolveContext(P);
  const idx = await loadStoryIndex(ctx, { fetchImpl: noFetch });
  assert.equal(idx.source, SCREENS);
  assert.deepEqual(idx.stories, []);
  assert.equal(componentOf(ctx, entry.importPath, entry.story), 'inspector');
  // A story project keeps its story-file scope: the same path is out of it.
  const stories = resolveContext(openProject({ cwd: project(), env }));
  assert.equal(componentOf(stories, entry.importPath, entry.story), null);
});

test("the dashboard's data says which source it serves", () => {
  assert.equal(buildData(openProject({ cwd: project(SCREENS), env })).source, SCREENS);
  assert.equal(buildData(openProject({ cwd: project(), env })).source, 'storybook');
});

test('pxsig check refuses a project of screens and names the script that checks it', () => {
  const r = cli(['check', '--all'], project(SCREENS));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(
    r.stderr + r.stdout,
    /dashboard's screens: check them with `node scripts\/screens-check\.mjs`/
  );
});
