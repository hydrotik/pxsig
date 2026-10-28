// check-versions.mjs: every released version agrees, and with the tag.
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  PACKAGES,
  cargoLockVersions,
  cargoWorkspaceVersion,
  mismatches,
  readVersions,
} from './check-versions.mjs';

const CARGO = `[workspace]
members = ["crates/a"]

[workspace.dependencies]
version = "9.9.9"

[workspace.package] # the release version
version = "1.2.3"
edition = "2021"
`;

const LOCK = (/** @type {string} */ core, /** @type {string} */ cli) => `version = 4

[[package]]
name = "anyhow"
version = "1.0.0"

[[package]]
name = "pxsig-cli"
version = "${cli}"
dependencies = ["pxsig-core"]

[[package]]
name = "pxsig-core"
version = "${core}"
`;

test('reads [workspace.package] version, not another section', () => {
  assert.equal(cargoWorkspaceVersion(CARGO), '1.2.3');
  assert.equal(cargoWorkspaceVersion('[package]\nversion = "1.0.0"\n'), null);
});

test('reads the workspace crates from Cargo.lock', () => {
  const v = cargoLockVersions(LOCK('1.2.3', '1.2.4'), ['pxsig-core', 'pxsig-cli']);
  assert.equal(v.get('pxsig-core'), '1.2.3');
  assert.equal(v.get('pxsig-cli'), '1.2.4');
  assert.equal(v.size, 2);
});

/**
 * A checkout with every version file, removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} pkg package folder → its version (default 1.2.3)
 * @param {string} [lock]
 */
function checkout(t, pkg, lock = LOCK('1.2.3', '1.2.3')) {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-versions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'Cargo.toml'), CARGO);
  writeFileSync(join(root, 'Cargo.lock'), lock);
  for (const p of PACKAGES) {
    mkdirSync(join(root, p), { recursive: true });
    writeFileSync(join(root, p, 'package.json'), JSON.stringify({ version: pkg[p] ?? '1.2.3' }));
  }
  return root;
}

test('versions that agree, with and without the tag', (t) => {
  const v = readVersions(checkout(t, {}));
  assert.equal(v.length, 6);
  assert.deepEqual(mismatches(v), []);
  assert.deepEqual(mismatches(v, 'v1.2.3'), []);
  assert.deepEqual(mismatches(v, '1.2.3'), []);
});

test('a package left behind is named, with the version it should have', (t) => {
  const v = readVersions(checkout(t, { 'packages/storybook-addon': '1.2.2' }));
  assert.deepEqual(mismatches(v), [
    'packages/storybook-addon/package.json is 1.2.2, Cargo.toml [workspace.package] is 1.2.3',
  ]);
});

test('a tag unlike the files names every file', (t) => {
  const problems = mismatches(readVersions(checkout(t, {})), 'v1.3.0');
  assert.equal(problems.length, 6);
  assert.match(
    problems[0],
    /^Cargo\.toml \[workspace\.package\] is 1\.2\.3, the tag v1\.3\.0 is 1\.3\.0$/
  );
});

test('a stale Cargo.lock and a missing version are both caught', (t) => {
  const root = checkout(t, {}, LOCK('1.2.3', '1.2.2'));
  writeFileSync(join(root, 'packages/dashboard/package.json'), '{}');
  assert.deepEqual(mismatches(readVersions(root)), [
    'packages/dashboard/package.json: no version found',
    'Cargo.lock pxsig-cli is 1.2.2, Cargo.toml [workspace.package] is 1.2.3',
  ]);
});
