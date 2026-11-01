// screens-container.mjs: the check runs in the pinned image, as the caller, on the mounted checkout.
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dockerArgs, pinnedImage } from './screens-container.mjs';

const repo = new URL('..', import.meta.url);

test('the committed image is pinned by digest', () => {
  assert.match(pinnedImage(repo.pathname), /^ghcr\.io\/hydrotik\/pxsig:.+@sha256:[0-9a-f]{64}$/);
});

test('an image named by tag alone is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'screens-image-'));
  mkdirSync(join(dir, 'docker'));
  writeFileSync(
    join(dir, 'docker', 'screens-image.json'),
    JSON.stringify({ image: 'ghcr.io/hydrotik/pxsig:0.7.0-pw1.58.2' })
  );
  assert.throws(() => pinnedImage(dir), /must be ghcr\.io\/hydrotik\/pxsig:<tag>@sha256/);
});

test('docker run mounts the checkout at its own path and runs screens-check as the caller', () => {
  const a = dockerArgs({
    image: 'img@sha256:x',
    repo: '/w/pxsig',
    user: '1001:118',
    args: ['--only', 'inspector.header'],
  });
  assert.deepEqual(a.slice(a.indexOf('-v'), a.indexOf('-v') + 4), [
    '-v',
    '/w/pxsig:/w/pxsig',
    '-w',
    '/w/pxsig',
  ]);
  assert.deepEqual(a.slice(a.indexOf('--user'), a.indexOf('--user') + 2), ['--user', '1001:118']);
  assert.deepEqual(a.slice(-5), [
    'img@sha256:x',
    'node',
    'scripts/screens-check.mjs',
    '--only',
    'inspector.header',
  ]);
  assert.ok(!dockerArgs({ image: 'i', repo: '/r', user: null, args: [] }).includes('--user'));
});
