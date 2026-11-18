// The sample server's signature images (dashboard-check/signatures.mjs): made by the engine from
// the sample images, square as a check writes them, the same on every run, and served for the
// inspector's signature and heatmap URLs; without the engine the sample diff stands in.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sampleImages, scenarioServer } from '../../pxsig/src/dashboard-check/server.mjs';
import { sampleSignatures } from '../../pxsig/src/dashboard-check/signatures.mjs';
import { rustBinary } from '../../pxsig/src/lib/workspace/peers.mjs';

/** @type {typeof import('pngjs')} */
const { PNG } = createRequire(new URL('../../pxsig/package.json', import.meta.url))('pngjs');

const noEngine = existsSync(rustBinary()) ? false : 'no pxsig engine (cargo build --release)';

test(
  'the engine makes square signatures and a heatmap, the same on every run',
  {
    skip: noEngine,
  },
  () => {
    const images = sampleImages();
    const a = sampleSignatures(images);
    const b = sampleSignatures(images);
    assert.ok(a && b);
    for (const k of /** @type {const} */ (['baseline', 'current', 'diff'])) {
      const p = PNG.sync.read(a[k]);
      assert.equal(p.width, p.height, k);
      assert.ok(a[k].equals(b[k]), `${k} is the same on every run`);
    }
    assert.ok(!a.baseline.equals(a.current), 'the change shows in the signatures');
  }
);

test('without the engine there are none', () => {
  assert.equal(sampleSignatures(sampleImages(), join(tmpdir(), 'no-such-pxsig-engine')), null);
});

test(
  'the server answers each signature URL with its image, and the diff without them',
  {
    skip: noEngine,
  },
  async () => {
    const images = sampleImages();
    const sigs = /** @type {NonNullable<ReturnType<typeof sampleSignatures>>} */ (
      sampleSignatures(images)
    );
    const dir = mkdtempSync(join(tmpdir(), 'pxsig-sample-sigs-test-'));
    const get = async (/** @type {string} */ base, /** @type {string} */ p) =>
      Buffer.from(await (await fetch(`${base}${p}`)).arrayBuffer());
    const opts = { dir, scenario: 'clean', fixtures: /** @type {any} */ ({}), posts: [] };
    const withSigs = await scenarioServer({ ...opts, images: { ...images, sigs } });
    const without = await scenarioServer({ ...opts, images });
    try {
      const at = '/p/demo/diffs/latest/ui-button--primary';
      assert.ok((await get(withSigs.base, `${at}.baseline.png`)).equals(sigs.baseline));
      assert.ok((await get(withSigs.base, `${at}.current.png`)).equals(sigs.current));
      assert.ok((await get(withSigs.base, `${at}.diff.png`)).equals(sigs.diff));
      assert.ok((await get(without.base, `${at}.current.png`)).equals(images.diff));
    } finally {
      withSigs.close();
      without.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
