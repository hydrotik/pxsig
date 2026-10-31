/**
 * peer-message.test.mjs — a missing peer's message names the install command of the package
 * manager whose lockfile the workspace has (lib/workspace/peers.mjs `addCommand`).
 *
 *   node --test packages/pxsig/test/peer-message.test.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { addCommand } from '../src/lib/workspace/peers.mjs';
import { resolvePeer } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';

test('the install command follows the lockfile; npm without one', (t) => {
  const none = tempDir('peer-none', t);
  assert.equal(addCommand([none], 'playwright'), 'npm install -D playwright');
  for (const [file, cmd] of [
    ['pnpm-lock.yaml', 'pnpm add -D'],
    ['yarn.lock', 'yarn add -D'],
    ['bun.lock', 'bun add -d'],
    ['package-lock.json', 'npm install -D'],
  ]) {
    const dir = tempDir('peer-lock', t);
    writeFileSync(join(dir, file), '');
    assert.equal(addCommand([none, dir], 'playwright'), `${cmd} playwright`, file);
  }
});

test('a missing peer names its package, not the file asked for, and the yarn command', (t) => {
  const root = tempDir('peer-yarn', t);
  writeFileSync(join(root, 'yarn.lock'), '');
  assert.throws(
    () => resolvePeer({ root, workspaceRoot: root }, 'pxsig-no-such-peer/package.json', {}),
    /cannot find "pxsig-no-such-peer": install it in the workspace \(yarn add -D pxsig-no-such-peer\)/
  );
  assert.throws(
    () => resolvePeer({ root, workspaceRoot: root }, '@pxsig/no-such-peer/x.js', {}),
    /cannot find "@pxsig\/no-such-peer"/
  );
});
