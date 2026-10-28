// The hydrotik adapter's `packagesIn`: package name → folder, from a checkout's package folders.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { packagesIn } from '../src/ui/adapters/hydrotik/vite.mjs';

test('packagesIn keys each package by its name and skips a package.json with no name', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pxsig-packages-in-'));
  /** @param {string} dir @param {string} text */
  const pkg = (dir, text) => {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, 'package.json'), text);
  };
  pkg('packages/ds', '{"name":"@x/ds"}');
  pkg('packages/private', '{"private":true}');
  pkg('apps/site', '{"name":"site"}');
  pkg('apps/broken', '{not json');
  assert.deepEqual(packagesIn(root), {
    '@x/ds': path.join(root, 'packages', 'ds'),
    site: path.join(root, 'apps', 'site'),
  });
});
