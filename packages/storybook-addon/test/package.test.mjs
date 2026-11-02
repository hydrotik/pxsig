// The published manifest: no runtime dependencies, and Storybook an optional peer, so installing
// the addon pulls in nothing (npm 7+ would otherwise install the newest Storybook and its bundlers).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const manifest = createRequire(import.meta.url)('../package.json');

test('the addon has no dependencies and an optional Storybook peer', () => {
  for (const field of ['dependencies', 'optionalDependencies', 'bundleDependencies'])
    assert.equal(manifest[field], undefined, field);
  assert.match(manifest.peerDependencies.storybook, /^>=\d+$/);
  assert.equal(manifest.peerDependenciesMeta.storybook.optional, true);
});
