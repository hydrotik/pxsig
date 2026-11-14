/**
 * build-config.mjs's adapter choice: each rule of `adapterSpec`, in order, and what `from` says;
 * the built-in plain adapter, and that it matches the copy in examples/custom-ui; an adapter's
 * class prefixes.
 */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  adapterSpec,
  builtinAdapters,
  classIdentifiers,
  resolveAdapter,
} from '../build-config.mjs';

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

// The example stays written for an older contract (docs/ui/contract-changes.md), so the two
// conformance.json files differ in `contract` only.
test('the built-in plain adapter and the example agree, but for the contract they use', () => {
  const built = path.join(repo, 'packages/dashboard/src/ui/adapters/plain');
  const example = path.join(repo, 'examples/custom-ui/pxsig-ui');
  /** @param {string} dir @param {string} f */
  const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
  /** @param {string} dir */
  const files = (dir) => readdirSync(dir).sort();
  assert.deepEqual(files(built), files(example), 'the same files in both folders');
  /** @param {string} dir */
  const conformance = (dir) => read(dir, 'conformance.json').replace(/"contract": "[^"]*"/, '');
  assert.equal(
    conformance(built),
    conformance(example),
    'conformance.json differs beyond "contract": copy one onto the other'
  );
  for (const f of files(built).filter((x) => x !== 'conformance.json'))
    assert.equal(
      read(built, f).replace(
        "import type * as C from '../../contract';",
        "import type * as C from 'pxsig/dashboard';"
      ),
      read(example, f),
      `${f} differs beyond its contract import: copy one onto the other`
    );
});

test("an adapter's class prefixes name the classes its design system's stylesheets define", () => {
  assert.equal(classIdentifiers(undefined, tmp), undefined, 'none: vanilla-extract names them');
  assert.equal(classIdentifiers({}, tmp), undefined);
  // Real paths, as vanilla-extract gives them (the temporary folder may itself be under a link).
  const root = realpathSync(mkdtempSync(path.join(tmp, 'root-')));
  const ds = path.join(realpathSync(tmp), 'ds');
  mkdirSync(path.join(ds, 'src'), { recursive: true });
  // The folder named through a link: vanilla-extract gives each file by its real path.
  const link = path.join(tmp, 'ds-link');
  symlinkSync(ds, link, 'junction');
  const name = /** @type {NonNullable<ReturnType<typeof classIdentifiers>>} */ (
    classIdentifiers({ [link]: 'ds-' }, root)
  );
  const rel = (/** @type {string} */ f) => path.relative(root, path.join(ds, f));
  assert.equal(name({ hash: '1abc0', filePath: rel('src/Badge.css.ts') }), 'ds-1abc0');
  assert.equal(name({ hash: 'abc0', filePath: 'src/styles/base.css.ts' }), 'abc0', 'the dashboard');
  assert.equal(
    name({ hash: '1abc0', filePath: 'src/styles/base.css.ts' }),
    '_1abc0',
    "vanilla-extract's own default for a hash that starts with a digit"
  );
  assert.equal(name({ hash: 'x0', filePath: rel('../ds-other/a.css.ts') }), 'x0', 'a sibling');
});
