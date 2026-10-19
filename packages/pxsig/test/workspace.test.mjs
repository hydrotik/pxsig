import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findWorkspace, loadProject, missingProjects, openProject, pickProject, runManifest, serverUrlFor, unlistedConfigs, workspaceProblems } from '../src/lib/workspace.mjs';

const env = {};
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-ws-'));
  mkdirSync(join(root, '.git'));
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return root;
};

test('single package: the config is the whole registry', () => {
  const root = tree({ 'pxsig.config.json': { srcRoot: 'src' }, 'package.json': { name: '@scope/ui' }, 'src/Button/x.ts': '' });
  const ws = findWorkspace({ cwd: join(root, 'src', 'Button'), env });
  assert.equal(ws.root, root);
  assert.equal(ws.file, null);
  assert.deepEqual(ws.projects.map((p) => p.name), ['ui']);
  const P = openProject({ cwd: join(root, 'src'), env });
  assert.equal(P.store.root, join(root, '.pxsig'));
  assert.equal(P.sigFor('button--primary', 'src/Button/Button.stories.tsx'), '.pxsig/baselines/Button/button--primary.psig');
});

test('monorepo: workspace file, project by name, by path, by cwd; ambiguity refused', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds', app: 'apps/web' }, defaults: { grid: 48 } },
    'packages/ds/pxsig.config.json': { srcRoot: 'src', grid: 96 },
    'packages/ds/src/a.ts': '',
    'apps/web/pxsig.config.json': { storybook: { url: 'http://localhost:7007/' } },
  });
  const ws = findWorkspace({ cwd: join(root, 'packages', 'ds', 'src'), env });
  assert.equal(ws.root, root);
  assert.equal(pickProject(ws, { cwd: join(root, 'packages', 'ds', 'src') }).name, 'ds');
  assert.equal(pickProject(ws, { project: 'app', cwd: root }).name, 'app');
  assert.equal(pickProject(ws, { project: 'apps/web', cwd: root }).name, 'app');
  assert.equal(pickProject(ws, { cwd: root }), null);
  assert.throws(() => openProject({ cwd: root, env }), /choose one with --project/);
  assert.throws(() => pickProject(ws, { project: 'nope', cwd: root }), /no project "nope"/);
  // layers: project beats workspace defaults; flags beat both
  assert.equal(loadProject(ws, ws.projects[0], { env }).config.grid, 96);
  assert.equal(loadProject(ws, ws.projects[1], { env }).config.grid, 48);
  assert.equal(loadProject(ws, ws.projects[1], { env, flags: { grid: 32 } }).config.grid, 32);
  assert.equal(loadProject(ws, ws.projects[1], { env }).storybook.url, 'http://localhost:7007');
});

test('colocated layout and $workspace paths', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds' } },
    'packages/ds/pxsig.config.json': { store: { layout: 'colocated' }, storybook: { configDir: '$workspace/apps/sb/.storybook' } },
  });
  const P = openProject({ cwd: root, env });
  assert.equal(P.storybook.configDir, join(root, 'apps', 'sb', '.storybook'));
  assert.equal(P.sigFor('b--x', 'packages/ds/src/components/B/B.stories.tsx'), 'packages/ds/src/components/B/__pxsig__/b--x.psig');
});

test('doctor helpers: unlisted configs and missing projects', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds', gone: 'packages/gone' } },
    'packages/ds/pxsig.config.json': {},
    'packages/extra/pxsig.config.json': {},
  });
  const ws = findWorkspace({ cwd: root, env });
  assert.deepEqual(unlistedConfigs(ws), ['packages/extra/pxsig.config.json']);
  assert.deepEqual(missingProjects(ws), ['gone']);
});

test('discovery never crosses a .git boundary', () => {
  const outer = tree({ 'pxsig.workspace.json': { projects: {} } });
  const inner = join(outer, 'nested');
  mkdirSync(join(inner, '.git'), { recursive: true });
  assert.throws(() => findWorkspace({ cwd: inner, env }), /no pxsig.workspace.json or pxsig.config.json/);
});

test('mode inheritance and the run manifest', () => {
  const root = tree({
    'pxsig.config.json': { modes: { dark: { globals: 'theme:dark', colorScheme: 'dark' }, mobile: { extends: 'dark', viewport: [390, 844] } } },
  });
  const P = openProject({ cwd: root, env });
  assert.deepEqual(P.modes.mobile.viewport, [390, 844]);
  assert.equal(P.modes.mobile.colorScheme, 'dark');
  const m = runManifest(P, { stories: [{ id: 'a' }] });
  assert.equal(m.defaultMode, 'dark');
  assert.equal(m.colorScheme, 'dark');
  assert.equal(m.stories.length, 1);
});

test('workspace problems: unlisted config, missing project, another major version installed', () => {
  const root = tree({
    'pxsig.workspace.json': { projects: { ds: 'packages/ds', gone: 'packages/gone' } },
    'packages/ds/pxsig.config.json': {},
    'packages/extra/pxsig.config.json': {},
    'packages/ds/node_modules/pxsig/package.json': { name: 'pxsig', version: '99.0.0' },
  });
  const ws = findWorkspace({ cwd: root, env });
  const codes = workspaceProblems(loadProject(ws, ws.projects[0], { env })).map((x) => `${x.code}:${x.severity}`);
  assert.deepEqual(codes.sort(), ['project-missing:error', 'project-unlisted:warn', 'version-skew:warn']);
});

test('the server address: PXSIG_URL, else the running server file, else the configured port', () => {
  const root = tree({ 'pxsig.config.json': {} });
  assert.equal(serverUrlFor(root, { env: {}, port: 7000 }), 'http://127.0.0.1:7000');
  mkdirSync(join(root, 'node_modules', '.cache', 'pxsig'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '.cache', 'pxsig', 'server.json'), JSON.stringify({ url: 'http://127.0.0.1:7123' }));
  assert.equal(serverUrlFor(root, { env: {} }), 'http://127.0.0.1:7123');
  assert.equal(serverUrlFor(root, { env: { PXSIG_URL: 'http://h:1/' } }), 'http://h:1');
});

test('affects: the source folders of runtime workspace dependencies, found through their links', () => {
  const root = tree({
    'pxsig.config.json': {},
    'package.json': { name: 'app', dependencies: { '@x/tokens': 'workspace:*' }, devDependencies: { '@x/lint': 'workspace:*' } },
    'libs/tokens/package.json': { name: '@x/tokens' },
    'libs/tokens/src/index.js': '',
    'libs/lint/package.json': { name: '@x/lint' },
  });
  mkdirSync(join(root, 'node_modules', '@x'), { recursive: true });
  symlinkSync(join(root, 'libs', 'tokens'), join(root, 'node_modules', '@x', 'tokens'));
  symlinkSync(join(root, 'libs', 'lint'), join(root, 'node_modules', '@x', 'lint'));
  const P = openProject({ cwd: root, env });
  assert.ok(P.affects.includes('libs/tokens/src'));
  assert.ok(!P.affects.some((a) => a.startsWith('libs/lint')), 'dev-only dependencies do not affect renders');
});
