// `pxsig init` records the package's Storybook folders: `--storybook-static`, and `.storybook/` and
// `storybook-static/` when the folder has them. The written config opens as a valid project. No
// Storybook, no server: nothing here makes a request.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { detectStorybook, initProject } from '../src/lib/setup.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { cli, env, tree } from './features-helpers.mjs';
import { testHome } from './fixture.mjs';

/** @param {string} dir */
const config = (dir) => JSON.parse(readFileSync(join(dir, 'pxsig.config.json'), 'utf8'));

test('detectStorybook: .storybook and storybook-static only when they are folders', () => {
  assert.deepEqual(detectStorybook(tree({})), { configDir: null, staticDir: null });
  const files = tree({ '.storybook': 'not a folder', 'storybook-static': '' });
  assert.deepEqual(detectStorybook(files), { configDir: null, staticDir: null });
  const both = tree({ '.storybook/main.ts': '', 'storybook-static/index.json': {} });
  assert.deepEqual(detectStorybook(both), {
    configDir: '.storybook',
    staticDir: 'storybook-static',
  });
});

test('initProject writes storybook.staticDir', () => {
  const dir = tree({});
  initProject({ dir, storybookStaticDir: 'sb-out' });
  assert.deepEqual(config(dir).storybook, { staticDir: 'sb-out' });
});

test('init --storybook-static writes storybook.staticDir, and the project resolves it', () => {
  const dir = tree({});
  const r = cli(['init', '--storybook-static', 'sb-out', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(config(dir).storybook, { staticDir: 'sb-out' });
  assert.deepEqual(JSON.parse(r.stdout).detected, { configDir: null, staticDir: null });
  const P = openProject({ cwd: dir, env });
  assert.equal(P.storybook.staticDir, join(dir, 'sb-out'));
  assert.equal(P.storybook.url, 'http://localhost:6006', 'the URL is still tried first');
});

test('init records .storybook/ and storybook-static/ it finds, and says so', () => {
  const dir = tree({ '.storybook/main.ts': '', 'storybook-static/index.json': {} });
  const r = cli(['init'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(config(dir).storybook, {
    configDir: '.storybook',
    staticDir: 'storybook-static',
  });
  assert.match(r.stdout, /found \.storybook\/: recorded as storybook\.configDir/);
  assert.match(r.stdout, /found storybook-static\/: recorded as storybook\.staticDir/);
  assert.match(r.stdout, /else the build in storybook-static/);
  const P = openProject({ cwd: dir, env });
  assert.equal(P.storybook.configDir, join(dir, '.storybook'));
});

test('init: a flag wins over what it finds; nothing found writes no storybook key', () => {
  const dir = tree({ '.storybook/main.ts': '', 'storybook-static/index.json': {} });
  const r = cli(
    ['init', '--storybook-config', 'config/sb', '--storybook-static', 'dist/sb', '--json'],
    dir
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(config(dir).storybook, { configDir: 'config/sb', staticDir: 'dist/sb' });
  assert.deepEqual(JSON.parse(r.stdout).detected, { configDir: null, staticDir: null });
  const none = tree({});
  const plain = cli(['init'], none);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(config(none).storybook, undefined);
  assert.doesNotMatch(plain.stdout, /found /);
  assert.match(plain.stdout, /Storybook must be running/);
});

test('init leaves an existing config alone, folders or not', () => {
  const dir = tree({ 'pxsig.config.json': { version: 1, srcRoot: 'src' } });
  mkdirSync(join(dir, '.storybook'));
  mkdirSync(join(dir, 'storybook-static'));
  writeFileSync(join(dir, 'storybook-static', 'index.json'), '{}');
  const r = cli(['init', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(config(dir), { version: 1, srcRoot: 'src' });
  assert.deepEqual(JSON.parse(r.stdout).detected, { configDir: null, staticDir: null });
});

test('init and a missing config name no absolute path: the folder by its name', () => {
  const dir = tree({});
  const forbidden = [dir, realpathSync(dir), testHome, userInfo().homedir];
  /** @param {string} text */
  const clean = (text) => {
    for (const p of forbidden.flatMap((x) => [x, JSON.stringify(x).slice(1, -1)]))
      assert.ok(!text.includes(p), `absolute path (${p}) in:\n${text}`);
  };
  const missing = cli(['doctor', '--plain'], dir);
  assert.equal(missing.status, 2, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /in this folder or above it: run `pxsig init`/);
  clean(missing.stdout + missing.stderr);
  const plain = cli(['init', '--plain'], dir);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, new RegExp(`pxsig init — ${basename(dir)}`));
  assert.match(plain.stdout, /pxsig\.config\.json/);
  clean(plain.stdout + plain.stderr);
  const json = cli(['init', '--json'], tree({}));
  assert.deepEqual(JSON.parse(json.stdout).wrote, [
    'pxsig.config.json',
    '.pxsig/.gitignore',
    '.pxsig/.gitattributes',
  ]);
});
