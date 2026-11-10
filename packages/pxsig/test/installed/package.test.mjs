// The installed package's self-test: what npm put in node_modules/pxsig works on this host. Node
// built-ins and the package's own files only: no network, no browser, no engine needed.
//
//   node --test "node_modules/pxsig/test/installed/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
/** @type {{ version: string, bin: Record<string, string>, exports: Record<string, string | Record<string, string>> }} */
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
/** What docs/package.md documents for `pxsig/workspace`. */
const WORKSPACE = ['SetupError', 'findWorkspace', 'loadProject', 'openProject', 'pickProject'];
const PSIG = ['hasImage', 'readHeader', 'readImage', 'readSection'];

test('pxsig --version prints the version in package.json and the shipped UI contract', () => {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, PXSIG_NO_DELEGATE: '1' };
  for (const k of Object.keys(env))
    if (k.toUpperCase().startsWith('PXSIG_') && k !== 'PXSIG_NO_DELEGATE') delete env[k];
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [join(pkg, manifest.bin.pxsig), '--version', '--json'], {
    cwd: pkg,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  /** @type {{ pxsig: string, contract: string | null }} */
  const v = JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
  assert.equal(v.pxsig, manifest.version);
  assert.match(String(v.contract), /^\d+\.\d+/);
});

test('every bin and exports target is a file in the package', () => {
  const targets = [
    ...Object.values(manifest.bin),
    ...Object.values(manifest.exports).flatMap((t) =>
      typeof t === 'string' ? [t] : Object.values(t)
    ),
  ];
  for (const t of targets) assert.ok(statSync(join(pkg, t)).isFile(), t);
});

test('pxsig/workspace and pxsig/psig resolve by name and export their documented functions', async () => {
  const workspace = await import('pxsig/workspace');
  assert.deepEqual(Object.keys(workspace).sort(), WORKSPACE);
  for (const name of WORKSPACE)
    assert.equal(
      typeof (/** @type {Record<string, unknown>} */ (workspace)[name]),
      'function',
      name
    );
  const psig = await import('pxsig/psig');
  assert.deepEqual(Object.keys(psig).sort(), PSIG);
  assert.equal(psig.readHeader(join(pkg, 'no-such-file.psig')), null);
  assert.equal(psig.hasImage(join(pkg, 'no-such-file.psig')), false);
});

test('pxsig/dashboard is types only: loading it in Node says so', async () => {
  // A name in a variable: TypeScript would otherwise check the contract source it points at.
  const dashboard = 'pxsig/dashboard';
  await assert.rejects(import(dashboard), { message: /^pxsig\/dashboard is types only/ });
});

test('the UI catalog exports and the JSON schemas parse', () => {
  for (const name of ['hydrotik.json', 'hydrotik.schema.json', 'hydrotik.source.json']) {
    const json = require(`pxsig/ui/catalog/${name}`);
    assert.equal(typeof json, 'object', name);
  }
  const schemas = readdirSync(join(pkg, 'schema')).filter((f) => f.endsWith('.json'));
  assert.ok(schemas.length > 0, 'schema/ holds the config schemas');
  for (const f of schemas) {
    const s = JSON.parse(readFileSync(join(pkg, 'schema', f), 'utf8'));
    assert.match(s.$schema, /^https:\/\/json-schema\.org\//, f);
    assert.equal(typeof s.title, 'string', f);
  }
  assert.ok(existsSync(join(pkg, 'README.md')), 'README.md');
});
