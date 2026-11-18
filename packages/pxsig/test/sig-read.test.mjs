/**
 * sig-read.test.mjs — lib/integrity/sig-read.mjs reads each baseline once for the ledger and
 * `pxsig doctor`: what it finds must be what psig.mjs (`readHeader`, `hasImage`) and a sha256 of
 * the file find, for good files and broken ones, and a file changed since is read again.
 *
 *   node --test packages/pxsig/test/sig-read.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hasImage, readHeader } from '../src/lib/psig.mjs';
import { hashOf, sigFacts, sigHasImage } from '../src/lib/integrity/sig-read.mjs';

/**
 * A `.psig` container: "PSIG", u16 version, u32 header length, the header, the sections.
 * @param {object} header
 * @param {{ lenDelta?: number, tail?: Buffer }} [o]
 */
function psig(header, { lenDelta = 0, tail = Buffer.from('section-bytes') } = {}) {
  const head = Buffer.from(JSON.stringify(header));
  const pre = Buffer.alloc(10);
  pre.write('PSIG', 0, 'latin1');
  pre.writeUInt16LE(1, 4);
  pre.writeUInt32LE(head.length + lenDelta, 6);
  return Buffer.concat([pre, head, tail]);
}

const sha = (/** @type {Buffer} */ b) => createHash('sha256').update(b).digest('hex');

test('the facts match readHeader, hasImage and a sha256, for good and broken files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-sig-read-'));
  try {
    const files = {
      image: psig({ sections: [{ name: 'image', length: 13 }] }),
      boxes: psig({ sections: [{ name: 'boxes', length: 13 }], masks: { masks: [{ s: '.x' }] } }),
      bare: psig({ id: 'x' }),
      emptyMasks: psig({ masks: { masks: [] } }),
      notPsig: Buffer.from('not a baseline at all'),
      short: Buffer.from('PSIG'),
      badJson: Buffer.concat([psig({ a: 1 }).subarray(0, 12), Buffer.from('}}}}}}}}}}}}')]),
      // The length runs past the end: readHeader pads with zeros, which never parse.
      overlong: psig(
        { sections: [{ name: 'image', length: 1 }] },
        { lenDelta: 50, tail: Buffer.alloc(0) }
      ),
    };
    for (const [name, buf] of Object.entries(files)) {
      const path = join(dir, `${name}.psig`);
      writeFileSync(path, buf);
      const h = readHeader(path);
      assert.equal(sigHasImage(path), hasImage(path), `${name}: image`);
      const f = sigFacts(path);
      assert.ok(f, name);
      assert.equal(f.psig, h !== null, `${name}: psig`);
      assert.equal(f.image, hasImage(path), `${name}: image fact`);
      assert.equal(f.boxes, !!h?.sections?.some((s) => s.name === 'boxes'), `${name}: boxes`);
      assert.equal(f.masks, !!h?.masks?.masks?.length, `${name}: masks`);
      assert.equal(hashOf(path), sha(buf), `${name}: hash`);
    }
    const missing = join(dir, 'missing.psig');
    assert.equal(sigHasImage(missing), false);
    assert.equal(sigFacts(missing), null);
    assert.equal(hashOf(missing), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file changed after it was read is read again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-sig-read-'));
  try {
    const path = join(dir, 'a.psig');
    const before = psig({ sections: [{ name: 'image', length: 13 }] });
    writeFileSync(path, before);
    assert.equal(sigHasImage(path), true);
    assert.equal(hashOf(path), sha(before));
    // Other bytes, another size and mtime: neither the hash nor the facts come from the cache.
    const after = psig({ sections: [{ name: 'boxes', length: 13 }] }, { tail: Buffer.from('x') });
    writeFileSync(path, after);
    utimesSync(path, new Date(2020, 0, 1), new Date(2020, 0, 1));
    assert.equal(hashOf(path), sha(after));
    assert.equal(sigFacts(path)?.image, false);
    assert.equal(sigFacts(path)?.boxes, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
