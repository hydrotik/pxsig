/**
 * fixtures.mjs — the seeded random numbers, the tiny PNG writer and the `.psig` template that
 * generate-store.mjs builds its synthetic store from.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/** @import { PsigTemplate } from './types.js' */

/** mulberry32: small, seeded, the same sequence on every OS. */
/** @param {number} seed */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- a tiny PNG (no dependencies) ---------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Buffer} buf */
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** @type {(type: string, data: Buffer) => Buffer} */
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/**
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => number[]} px
 */
export function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export const IMAGE = png(128, 128, (x, y) =>
  ((x >> 4) + (y >> 4)) % 2 ? [230, 230, 230] : [40, 60, 90]
);
export const CHANGED = png(128, 128, (x, y) =>
  x > 24 && x < 104 && y > 24 && y < 104
    ? [220, 20, 20]
    : ((x >> 4) + (y >> 4)) % 2
      ? [230, 230, 230]
      : [40, 60, 90]
);

export const sha = (/** @type {Buffer} */ buf) => createHash('sha256').update(buf).digest('hex');

/** One real `.psig` from the engine, split so each entry's copy only changes the header's id. */
/**
 * @param {string} bin
 * @param {string} scratch
 * @returns {PsigTemplate}
 */
export function template(bin, scratch) {
  const pngPath = join(scratch, 't.png');
  writeFileSync(pngPath, IMAGE);
  const run = (/** @type {string[]} */ args) => {
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${bin} ${args[0]}: ${r.stderr || r.error?.message}`);
  };
  run(['capture', pngPath, '--out', join(scratch, 't.json'), '--grid', '16']);
  run([
    'pack',
    join(scratch, 't.json'),
    '--out',
    join(scratch, 't.psig'),
    '--entry',
    '{"id":"t"}',
    '--image',
    pngPath,
  ]);
  const buf = readFileSync(join(scratch, 't.psig'));
  const len = buf.readUInt32LE(6);
  return {
    // The engine's own header JSON (spec section 5).
    header: /** @type {PsigTemplate['header']} */ (
      JSON.parse(buf.subarray(10, 10 + len).toString('utf8'))
    ),
    body: buf.subarray(10 + len),
  };
}
/**
 * @param {PsigTemplate} t
 * @param {string} id
 * @param {unknown} [createdAt]
 */
export function psig(t, id, createdAt = t.header.record?.createdAt) {
  const header = Buffer.from(
    JSON.stringify({ ...t.header, entry: { id }, record: { ...t.header.record, createdAt } })
  );
  const pre = Buffer.alloc(10);
  pre.write('PSIG', 0, 'latin1');
  pre.writeUInt16LE(t.header.container ?? 1, 4);
  pre.writeUInt32LE(header.length, 6);
  return Buffer.concat([pre, header, t.body]);
}
