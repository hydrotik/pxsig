/**
 * build-config.mjs's adapter choice: each rule of `adapterSpec`, in order, and what `from` says;
 * the built-in plain adapter, and that it matches the copy in examples/custom-ui.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adapterSpec, builtinAdapters, resolveAdapter } from '../build-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const ENV = ['PXSIG_UI_ADAPTER', 'PXSIG_DS_SOURCE'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const tmp = mkdtempSync(path.join(tmpdir(), 'pxsig-build-config-'));

/** A working folder, with a pxsig.config.json holding `text` when given. @param {string} [text] */
function folder(text) {
  const dir = mkdtempSync(path.join(tmp, 'cwd-'));
  if (text !== undefined) writeFileSync(path.join(dir, 'pxsig.config.json'), text);
  return dir;
}

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
});
after(() => {
  for (const k of ENV)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  rmSync(tmp, { recursive: true, force: true });
});

test('--ui comes first', () => {
  process.env.PXSIG_UI_ADAPTER = 'hydrotik';
  process.env.PXSIG_DS_SOURCE = tmp;
  const cwd = folder('{"dashboard":{"ui":"./mine"}}');
  assert.deepEqual(adapterSpec({ adapter: './x', cwd }), { spec: './x', base: cwd, from: '--ui' });
});

test('then PXSIG_UI_ADAPTER', () => {
  process.env.PXSIG_UI_ADAPTER = './env-ui';
  process.env.PXSIG_DS_SOURCE = tmp;
  const cwd = folder('{"dashboard":{"ui":"./mine"}}');
  assert.deepEqual(adapterSpec({ cwd }), {
    spec: './env-ui',
    base: cwd,
    from: 'PXSIG_UI_ADAPTER',
  });
});

test('then dashboard.ui in pxsig.config.json', () => {
  process.env.PXSIG_DS_SOURCE = tmp;
  const cwd = folder('{"dashboard":{"ui":"./mine"}}');
  assert.deepEqual(adapterSpec({ cwd }), {
    spec: './mine',
    base: cwd,
    from: 'pxsig.config.json dashboard.ui',
  });
});

test('then hydrotik, when PXSIG_DS_SOURCE is set', () => {
  process.env.PXSIG_DS_SOURCE = tmp;
  const cwd = folder('{"dashboard":{}}');
  assert.deepEqual(adapterSpec({ cwd }), {
    spec: 'hydrotik',
    base: cwd,
    from: 'default (PXSIG_DS_SOURCE is set)',
  });
});

test('else plain: no flag, no environment, no config (or an unreadable one)', () => {
  for (const cwd of [folder(), folder('{not json'), folder('{"dashboard":{"ui":""}}')])
    assert.deepEqual(adapterSpec({ cwd }), { spec: 'plain', base: cwd, from: 'default' });
  process.env.PXSIG_UI_ADAPTER = '';
  process.env.PXSIG_DS_SOURCE = '';
  assert.equal(adapterSpec({ cwd: folder() }).spec, 'plain', 'empty variables count as unset');
});

test('the plain default resolves to the built-in adapter', () => {
  assert.deepEqual(builtinAdapters(), ['hydrotik', 'plain']);
  const ui = resolveAdapter({ cwd: folder() });
  assert.equal(ui.name, 'plain');
  assert.equal(ui.from, 'default');
  assert.equal(ui.file, path.join(repo, 'packages/dashboard/src/ui/adapters/plain/index.tsx'));
});

test('the built-in plain adapter and the example agree, but for where the contract comes from', () => {
  const built = path.join(repo, 'packages/dashboard/src/ui/adapters/plain');
  const example = path.join(repo, 'examples/custom-ui/pxsig-ui');
  /** @param {string} dir @param {string} f */
  const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
  for (const f of ['theme.css', 'conformance.json'])
    assert.equal(read(built, f), read(example, f), `${f} differs: copy one onto the other`);
  assert.equal(
    read(built, 'index.tsx').replace(
      "import type * as C from '../../contract';",
      "import type * as C from 'pxsig/dashboard';"
    ),
    read(example, 'index.tsx'),
    'index.tsx differs beyond its contract import: copy one onto the other'
  );
});
