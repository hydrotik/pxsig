// Workspace layers and provenance, mode inheritance, workspace-dependency staleness, the store lock,
// multi-project CLI reads, `approve plan --new`, `approve undo` from git, colocated .gitattributes,
// `doctor --fail-on info` and `check --since` rows. Temp folders only; no Storybook, no server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { editedFilesSince, resolveContext } from '../src/lib/integrity.mjs';
import { ensureGitattributes, initProject } from '../src/lib/setup.mjs';
import { findWorkspace, loadProject, openProject, resolveModes } from '../src/lib/workspace.mjs';
import { hasRust, rustBin } from './fixture.mjs';
import { src, env, tree, cli } from './features-helpers.mjs';

// --- config layers -------------------------------------------------------------------------------------------

test('workspace defaults: paths resolve against the workspace root; provenance names each layer', () => {
  const root = tree({
    'pxsig.workspace.json': {
      projects: { ds: 'packages/ds' },
      defaults: {
        storybook: { configDir: 'apps/sb/.storybook', staticDir: 'apps/sb/storybook-static' },
        affects: { extra: ['shared/tokens'] },
        grid: 48,
      },
    },
    'packages/ds/pxsig.config.json': { srcRoot: 'src', capture: { settleMs: 50 } },
  });
  const ws = findWorkspace({ cwd: root, env });
  const P = loadProject(ws, ws.projects[0], {
    env: { PXSIG_STORYBOOK_URL: 'http://127.0.0.1:9' },
    flags: { grid: 32 },
  });
  assert.equal(
    P.storybook.configDir,
    join(root, 'apps', 'sb', '.storybook'),
    'not relative to the project'
  );
  assert.equal(P.storybook.staticDir, join(root, 'apps', 'sb', 'storybook-static'));
  assert.ok(P.affects.includes('shared/tokens'));
  assert.equal(
    P.srcRoot,
    join(root, 'packages', 'ds', 'src'),
    'a project path stays relative to the project'
  );
  const s = P.configSources;
  assert.equal(s.grid, 'flags');
  assert.equal(s['storybook.url'], 'env');
  assert.equal(s['storybook.configDir'], 'workspace defaults');
  assert.equal(s['capture.settleMs'], 'project config');
  assert.equal(s['capture.target'], 'defaults');
  assert.equal(s.modes, 'defaults');
});

test('the workspace schema describes defaults paths as the code resolves them: from the workspace root', () => {
  const schema = JSON.parse(readFileSync(join(src, '..', 'schema', 'workspace.json'), 'utf8'));
  const text = schema.properties.defaults.description;
  assert.match(text, /relative to the workspace root/);
  assert.doesNotMatch(text, /project folder/);
});

test('pxsig config shows the layer of every key, and config flags are the top layer', () => {
  const root = tree({ 'pxsig.config.json': { name: 'one', grid: 96 }, 'src/a.ts': '' });
  const c = JSON.parse(
    cli(['config', '--json', '--storybook-url', 'http://127.0.0.1:5', '--grid', '24'], root).stdout
  );
  assert.equal(c.config.grid, 24);
  assert.equal(c.sources.grid, 'flags');
  assert.equal(c.sources['storybook.url'], 'flags');
  assert.equal(c.storybook.url, 'http://127.0.0.1:5');
  const md = cli(['config', '--markdown'], root);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /\| Key \| Value \| Set by \|/);
  assert.match(md.stdout, /\| grid \| 96 \| project config \|/);
});

test('modes extend through several levels; a cycle or an unknown parent is a setup error', () => {
  const m = resolveModes({
    base: { colorScheme: 'dark', globals: 'theme:dark' },
    brand: { extends: 'base', globals: 'theme:brand' },
    mobile: { extends: 'brand', viewport: [390, 844] },
  });
  assert.deepEqual(m.mobile, { colorScheme: 'dark', globals: 'theme:brand', viewport: [390, 844] });
  assert.equal(m.brand.extends, undefined);
  assert.throws(
    () => resolveModes({ a: { extends: 'b' }, b: { extends: 'c' }, c: { extends: 'a' } }),
    /cycle: a → b → c → a/
  );
  assert.throws(() => resolveModes({ a: { extends: 'nope' } }), /"nope", which is not defined/);
  const root = tree({
    'pxsig.config.json': {
      modes: {
        light: {},
        dark: { extends: 'light', colorScheme: 'dark' },
        dim: { extends: 'dark', globals: 'x' },
      },
    },
  });
  assert.equal(openProject({ cwd: root, env }).modes.dim.colorScheme, 'dark');
});

test('staleness traces workspace dependencies: their source folders are source roots', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds' } },
    'packages/ds/pxsig.config.json': {},
    'packages/ds/package.json': { name: '@x/ds', dependencies: { '@x/tokens': 'workspace:*' } },
    'packages/ds/src/Button/Button.stories.tsx': 'export default {}',
    'packages/tokens/package.json': { name: '@x/tokens' },
    'packages/tokens/src/colors.ts': 'export const c = 1;',
  });
  mkdirSync(join(root, 'packages/ds/node_modules/@x'), { recursive: true });
  symlinkSync(join(root, 'packages/tokens'), join(root, 'packages/ds/node_modules/@x/tokens'));
  const P = openProject({ cwd: join(root, 'packages/ds'), env });
  assert.ok(P.affects.includes('packages/tokens/src'), P.affects.join(', '));
  const ctx = resolveContext(P);
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(root, 'packages/ds/src/Button/Button.stories.tsx'), old, old);
  const files = editedFilesSince(ctx, Date.now() - 30_000).map((f) => f.file);
  assert.deepEqual(
    files,
    ['packages/tokens/src/colors.ts'],
    'an edit in a workspace dependency is traced'
  );
});

// --- colocated .gitattributes ----------------------------------------------------------------------------------

test('init with the colocated layout adds *.psig binary diff=psig to the root .gitattributes, once', () => {
  const root = tree({
    'pxsig.workspace.json': { version: 1, projects: {} },
    '.gitattributes': '*.png binary',
    'packages/forms/package.json': { name: 'forms' },
  });
  const wrote = initProject({
    dir: join(root, 'packages/forms'),
    workspaceRoot: root,
    layout: 'colocated',
  });
  assert.ok(wrote.includes(join(root, '.gitattributes')));
  const text = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(text, /^\*\.png binary\n/);
  assert.match(text, /^\*\.psig binary diff=psig$/m);
  assert.equal(ensureGitattributes(root), null, 'idempotent');
  initProject({ dir: join(root, 'packages/forms'), workspaceRoot: root, layout: 'colocated' });
  // The first init wrote the line (asserted above): a match.
  assert.equal(
    /** @type {RegExpMatchArray} */ (
      readFileSync(join(root, '.gitattributes'), 'utf8').match(/\*\.psig/g)
    ).length,
    1
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, 'packages/forms/pxsig.config.json'), 'utf8')).store.layout,
    'colocated'
  );
  // The package layout leaves the root alone.
  const pkg = tree({
    'pxsig.workspace.json': { version: 1, projects: {} },
    'packages/ui/package.json': {},
  });
  initProject({ dir: join(pkg, 'packages/ui'), workspaceRoot: pkg });
  assert.ok(!existsSync(join(pkg, '.gitattributes')));
});

// --- storybook.staticDir -----------------------------------------------------------------------------------------

test('storybook.staticDir: when storybook.url does not answer, the build is served on a free port', async () => {
  const { ensureStorybook } = await import('../src/lib/static.mjs');
  const index = {
    v: 5,
    entries: {
      'a--b': {
        type: 'story',
        id: 'a--b',
        title: 'A',
        name: 'B',
        importPath: './src/A.stories.tsx',
      },
    },
  };
  const root = tree({
    'pxsig.config.json': { storybook: { url: 'http://127.0.0.1:1', staticDir: 'sb-static' } },
    'sb-static/index.json': index,
    'sb-static/iframe.html': '<html></html>',
  });
  const P = openProject({ cwd: root, env });
  const sb = await ensureStorybook(P);
  try {
    assert.equal(sb.served, true);
    assert.equal(P.storybook.url, sb.url);
    assert.equal(sb.index.healthy, true);
    assert.deepEqual(
      // A healthy index (asserted above) lists its stories.
      sb.index.stories.map((s) => s.id),
      ['a--b']
    );
    assert.equal((await fetch(`${sb.url}/iframe.html`)).status, 200);
    assert.equal((await fetch(`${sb.url}/../pxsig.config.json`)).status, 404);
  } finally {
    // `served` is true (asserted first): a served build has `close`.
    await /** @type {{ close: () => Promise<void> }} */ (sb).close();
  }
  // No build in the folder: nothing served, the caller reports Storybook unreachable.
  const empty = tree({
    'pxsig.config.json': { storybook: { url: 'http://127.0.0.1:1', staticDir: 'nothing' } },
  });
  assert.equal((await ensureStorybook(openProject({ cwd: empty, env }))).served, false);
});

test('one version: the npm package, the MCP server and the Rust workspace agree', () => {
  // Cargo.toml has a [workspace.package] version: a match.
  const cargo = /** @type {RegExpMatchArray} */ (
    readFileSync(new URL('../../../Cargo.toml', import.meta.url), 'utf8').match(
      /\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/
    )
  )[1];
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(pkg, cargo);
  if (hasRust)
    assert.equal(
      spawnSync(rustBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
      `pxsig ${cargo}`
    );
});
