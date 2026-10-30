// Which axe-core the a11y pass uses, and where its version is recorded. Temp folders only.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { axePackage, axeVersion, browserPool } from '../src/lib/capture.mjs';
import { collectEnv, compareEnv, envId } from '../src/lib/env.mjs';
import { env, stubBrowser } from './env-helpers.mjs';
import { tempDir } from './fixture.mjs';
/** @import { Project } from '../src/types.js' */
/** @import { PxsigBrowser } from '../src/types/t4.js' */

const require = createRequire(import.meta.url);
// pxsig's own axe-core: the one its package.json declares.
const own = JSON.parse(readFileSync(require.resolve('axe-core/package.json'), 'utf8')).version;

/**
 * A project folder with its own axe-core at another version.
 * @param {import('node:test').TestContext} t
 */
function projectWithAxe(t) {
  const root = tempDir('axe', t);
  const dir = join(root, 'node_modules', 'axe-core');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"app","private":true}\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"axe-core","version":"0.0.1-project"}\n');
  writeFileSync(join(dir, 'axe.min.js'), '/* the project copy */\n');
  return { root, workspaceRoot: root, dir };
}

test("pxsig's own axe-core wins over the project's", (t) => {
  const P = projectWithAxe(t);
  const pkg = axePackage(P);
  assert.ok(pkg);
  assert.equal(pkg.version, own);
  assert.notEqual(realpathSync(pkg.dir), realpathSync(P.dir));
  assert.equal(axeVersion(P), own);
});

test("the project's axe-core is used only when pxsig's cannot be found", (t) => {
  const P = projectWithAxe(t);
  const missing = () => {
    throw new Error('Cannot find module');
  };
  const pkg = axePackage(P, missing);
  assert.ok(pkg);
  assert.equal(pkg.version, '0.0.1-project');
  // Node resolves through symlinks (macOS's /var is /private/var).
  assert.equal(realpathSync(pkg.dir), realpathSync(P.dir));
});

test('the env records the axe-core version; the id and older envs are unaffected', async () => {
  const e = await collectEnv(stubBrowser(), { playwright: '1.58.2', axe: '4.10.3' });
  assert.equal(e.axe, '4.10.3');
  const without = await collectEnv(stubBrowser(), { playwright: '1.58.2' });
  assert.equal(without.axe, null);
  assert.equal(e.id, without.id, 'axe is not a major field');
  // An env written before `axe` existed reads as before, and compares as compatible.
  const old = env();
  assert.equal('axe' in old, false);
  assert.equal(envId(old), old.id);
  assert.deepEqual(compareEnv(old, env({ axe: '4.10.3' })), { match: 'compatible', diff: ['axe'] });
  assert.deepEqual(compareEnv(old, env({ axe: '4.10.3' }), ['axe']), { match: 'same' });
});

test("a check's env carries the version the a11y pass uses", async (t) => {
  // browserPool reads only the folders and `config` of a project.
  const P = /** @type {Project} */ (/** @type {unknown} */ ({ ...projectWithAxe(t), config: {} }));
  const b = /** @type {PxsigBrowser} */ (/** @type {unknown} */ (stubBrowser()));
  const e = await browserPool(P, { chromium: b }).env('chromium');
  assert.equal(e.axe, own);
});
