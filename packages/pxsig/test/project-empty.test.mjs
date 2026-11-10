/**
 * project-empty.test.mjs — the setup finding `project-empty` (lib/integrity/problems.mjs
 * `setupProblems`): a project with no stories at all, most often a package registered as a project
 * that is not one (a dashboard adapter). A warning `integrity.severity` can change; none for a
 * project with entries, none when a broken story index already says why it is empty.
 *
 *   node --test packages/pxsig/test/project-empty.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { reconcile, resolveContext } from '../src/lib/integrity.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { cli, tree } from './features-helpers.mjs';
import { fixture, rustBin, tempDir } from './fixture.mjs';
/** @import { StoryIndex } from '../src/types.js' */

/** @type {StoryIndex} */
const emptyIndex = {
  source: 'storybook',
  storybook: { url: 'http://test/index.json', reachable: true, healthy: true },
  stories: [],
};

/**
 * A package with a pxsig config and an empty manifest, as an adapter registered as a project has.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown>} [config]
 */
function emptyProject(t, config = {}) {
  const repo = tempDir('adapter', t);
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, '.pxsig'));
  writeFileSync(
    join(repo, 'pxsig.config.json'),
    JSON.stringify({
      name: 'adapter',
      srcRoot: 'src',
      storybook: { url: 'http://127.0.0.1:1' },
      ...config,
    })
  );
  writeFileSync(join(repo, '.pxsig', 'manifest.json'), JSON.stringify({ stories: [] }));
  const P = openProject({ cwd: repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  return { repo, ctx: resolveContext(P) };
}

/** @param {Awaited<ReturnType<typeof reconcile>>} led */
const empties = (led) => led.setup.filter((x) => x.code === 'project-empty');

test('project-empty: a warning for a project with no stories, naming the likely cause', async (t) => {
  const { repo, ctx } = emptyProject(t);
  const led = await reconcile(ctx, { index: emptyIndex });
  assert.equal(led.entries.length, 0);
  assert.deepEqual(empties(led), [
    {
      code: 'project-empty',
      severity: 'warn',
      reason:
        'project "adapter" has no stories: none in its story index under src, none in its manifest. A package registered as a project that is not one (a dashboard adapter, a package without stories) has none: an adapter belongs to a project\'s dashboard.ui, not to pxsig.workspace.json\'s projects (docs/ui/build-adapter.md). For a project whose stories are elsewhere, srcRoot names their folder',
    },
  ]);
  assert.ok(!empties(led)[0].reason.includes(repo), 'workspace-relative, never absolute');
  // The static scan (Storybook not reachable) of a folder with no story files: still empty.
  const scanned = await reconcile(ctx, { offline: true });
  assert.equal(empties(scanned).length, 1);
});

test('project-empty: integrity.severity overrides it', async (t) => {
  const { ctx } = emptyProject(t, { integrity: { severity: { 'project-empty': 'info' } } });
  const [o] = empties(await reconcile(ctx, { index: emptyIndex }));
  assert.equal(o.severity, 'info');
});

test('project-empty: none for a project with entries, none behind a broken index', async (t) => {
  const f = fixture({ withSigs: false, t });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.deepEqual(empties(led), []);
  const { ctx } = emptyProject(t);
  /** @type {StoryIndex} */
  const broken = {
    source: 'static',
    storybook: {
      url: 'http://test/index.json',
      reachable: true,
      healthy: false,
      error: 'Unable to index files',
    },
    stories: [],
  };
  const b = await reconcile(ctx, { index: broken });
  assert.deepEqual(
    b.setup.map((x) => x.code).filter((c) => c.startsWith('storybook') || c === 'project-empty'),
    ['storybook-index-broken']
  );
});

test('pxsig doctor shows project-empty, and a warning keeps its exit code', () => {
  const root = tree({
    'pxsig.config.json': { name: 'adapter', storybook: { url: 'http://127.0.0.1:1' } },
    '.pxsig/manifest.json': { version: 2, stories: [] },
  });
  const json = cli(['doctor', '--json', '--offline'], root);
  const setup = /** @type {{ code: string, severity: string }[]} */ (JSON.parse(json.stdout).setup);
  assert.deepEqual(
    setup.filter((x) => x.code === 'project-empty').map((x) => x.severity),
    ['warn'],
    json.stdout
  );
  const plain = cli(['doctor', '--plain', '--offline'], root);
  assert.match(plain.stdout, /project-empty/);
  assert.match(plain.stdout, /project "adapter" has no stories/);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
});
