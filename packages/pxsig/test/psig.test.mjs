/**
 * psig.test.mjs — the `.psig` container across the two languages: the Rust engine writes a baseline
 * with every section and header key, and `lib/psig.mjs` reads the same header and section table,
 * byte for byte (docs/spec.md section 5). Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { hasImage, readHeader, readImage, readSection } from '../src/lib/psig.mjs';
import { CHECKER, hasRust, rustBin, tempDir } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

/** @param {Buffer} b */
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

test(
  'a .psig the engine writes reads the same in JS: header, section table, signature and image',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  (t) => {
    const dir = tempDir('psig', t);
    const png = join(dir, 'render.png');
    writeFileSync(png, CHECKER);
    const out = join(dir, 'baseline.psig');
    const entry = {
      id: 'components-alpha--default',
      story: 'components-alpha--default',
      mode: 'dark',
      state: null,
    };
    const env = { id: 'env-1', os: 'test' };
    // `pxsig serve`'s capture: entry, env, the detail channel and the image, in one file.
    const served = spawnSync(rustBin, ['serve'], {
      input: `${JSON.stringify({ id: 1, method: 'capture', params: { png, out, grid: 16, detail: true, entry, env } })}\n`,
      encoding: 'utf8',
    });
    assert.equal(served.status, 0, served.stderr);
    const answer = JSON.parse(served.stdout.trim());
    assert.equal(answer.error, undefined, answer.error);
    assert.equal(answer.result.detail, true);

    // The header: what the engine itself prints (`pxsig cat`) is what JS reads.
    const cat = spawnSync(rustBin, ['cat', out], { encoding: 'utf8' });
    assert.equal(cat.status, 0, cat.stderr);
    const header = /** @type {NonNullable<ReturnType<typeof readHeader>>} */ (readHeader(out));
    assert.deepEqual(header, JSON.parse(cat.stdout));
    assert.equal(header.format, 'psig');
    assert.deepEqual(header.entry, entry);
    assert.deepEqual(header.env, env);
    assert.ok(header.record?.detail, 'the record carries the detail channel');

    // The section table: every section, in order, at the offsets JS computes, sha256 intact.
    const sections = header.sections ?? [];
    assert.deepEqual(
      sections.map((s) => s.name),
      ['sig', 'image']
    );
    const bytes = readFileSync(out);
    let at = 10 + bytes.readUInt32LE(6);
    for (const s of sections) {
      const body = /** @type {Buffer} */ (readSection(out, s.name));
      assert.equal(body.length, s.length, s.name);
      assert.equal(sha256(body), s.sha256, `${s.name} sha256`);
      assert.ok(body.equals(bytes.subarray(at, at + s.length)), `${s.name} at its offset`);
      at += s.length;
    }
    assert.equal(at, bytes.length, 'nothing after the last section');
    assert.equal(readSection(out, 'nope'), null);

    // The signature: the same bytes the engine's plain spec v1 record carries as base64.
    const config = /** @type {{ grid?: number }} */ (header.record?.config);
    const grid = config.grid;
    assert.equal(grid, 16);
    const json = join(dir, 'render.pxsig.json');
    const cap = spawnSync(rustBin, ['capture', png, '--out', json, '--grid', String(grid)], {
      encoding: 'utf8',
    });
    assert.equal(cap.status, 0, cap.stderr);
    const record = JSON.parse(readFileSync(json, 'utf8'));
    const sig = /** @type {Buffer} */ (readSection(out, 'sig'));
    assert.ok(sig.equals(Buffer.from(record.sig, 'base64')), 'sig section = the record’s sig');
    assert.equal(sig.length, 16 * 16 * 3);
    assert.equal(header.record?.sha256, record.sha256);

    // The image: the render, byte for byte, as JS and the engine (`cat --image`) each read it.
    assert.ok(hasImage(out));
    assert.ok(/** @type {Buffer} */ (readImage(out)).equals(CHECKER));
    const back = join(dir, 'back.png');
    const img = spawnSync(rustBin, ['cat', out, '--image', back], { encoding: 'utf8' });
    assert.equal(img.status, 0, img.stderr);
    assert.ok(readFileSync(back).equals(CHECKER));
  }
);
