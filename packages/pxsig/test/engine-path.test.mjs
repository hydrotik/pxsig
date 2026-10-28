/**
 * engine-path.test.mjs — where pxsig looks for its engine binary. An installed pxsig never runs a
 * `target/release/pxsig` from the project that installed it: only pxsig's own clone has its build
 * there.
 *
 *   node --test packages/pxsig/test/engine-path.test.mjs
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rustBinary } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'pxsig.exe' : 'pxsig';

test('PXSIG_BIN wins', () => {
  assert.equal(rustBinary({ PXSIG_BIN: join(tmpdir(), 'x', exe) }), join(tmpdir(), 'x', exe));
});

test("an installed pxsig without its platform package names that package, not the project's target/", async () => {
  const project = tempDir('engine');
  const installed = join(project, 'node_modules', 'pxsig');
  mkdirSync(installed, { recursive: true });
  cpSync(join(pkg, 'src'), join(installed, 'src'), { recursive: true });
  cpSync(join(pkg, 'package.json'), join(installed, 'package.json'));
  const { rustBinary: installedRustBinary } = await import(
    pathToFileURL(join(installed, 'src', 'lib', 'workspace.mjs')).href
  );
  const p = installedRustBinary({});
  assert.ok(!p.startsWith(join(project, 'target')), p);
  assert.ok(p.includes(`${sep}@pxsig${sep}cli-${process.platform}-${process.arch}${sep}`), p);
});
