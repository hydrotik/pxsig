/**
 * files-tail.test.mjs — `tailLines` (src/lib/files.mjs) gives a log's last lines exactly as reading
 * the whole file would (`trim`, split on newlines, the last n), whatever the chunk size: blank and
 * whitespace tails, CRLF, a byte order mark, multi-byte characters across a chunk's edge, a file
 * shorter than n, an empty file. The dashboard's run history (`/__pxsig/data`) reads it.
 *
 *   node --test packages/pxsig/test/files-tail.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tailLines } from '../src/lib/files.mjs';
import { tempDir } from './fixture.mjs';

/** What the dashboard's history read before: the whole file. */
const whole = (/** @type {string} */ p, /** @type {number} */ n) =>
  readFileSync(p, 'utf8').trim().split('\n').slice(-n);

const line = (/** @type {number} */ i) =>
  JSON.stringify({ at: `t${i}`, rows: { [`é-${i}`]: [i % 2, '✓'.repeat(i % 5)] } });
const many = Array.from({ length: 250 }, (_, i) => line(i)).join('\n');

const files = {
  empty: '',
  newline: '\n',
  one: `${line(1)}\n`,
  'no final newline': many,
  'final newline': `${many}\n`,
  'blank tail': `${many}\n\n\n  \n`,
  'blank lines inside': `${line(1)}\n\n${line(2)}\n\n\n${line(3)}\n`,
  crlf: `${many.split('\n').join('\r\n')}\r\n`,
  bom: `﻿${line(1)}\n${line(2)}\n`,
  'leading blank': `\n\n${line(1)}\n${line(2)}\n`,
  'unicode space tail': `${many}\n  \n`,
};

test('tailLines answers what reading the whole file answers', () => {
  const dir = tempDir();
  for (const [name, text] of Object.entries(files)) {
    const p = join(dir, `${name}.ndjson`);
    writeFileSync(p, text);
    for (const n of [0, 1, 2, 3, 99, 100, 250, 251, 1000])
      for (const chunk of [1, 2, 3, 7, 64, 1 << 16])
        assert.deepEqual(tailLines(p, n, chunk), whole(p, n), `${name}, n ${n}, chunk ${chunk}`);
  }
});

test('a long log: its last 100 lines, read from its end', () => {
  const p = join(tempDir(), 'history.ndjson');
  // 2,000 lines of ~6 KB: the last 100 are in the last ~600 KB of ~12 MB.
  const big = 'x'.repeat(6000);
  writeFileSync(
    p,
    Array.from({ length: 2000 }, (_, i) => `${JSON.stringify({ at: `t${i}`, big })}\n`).join('')
  );
  const t0 = performance.now();
  const tail = tailLines(p, 100);
  const elapsed = performance.now() - t0;
  assert.deepEqual(tail, whole(p, 100));
  assert.equal(JSON.parse(/** @type {string} */ (tail.at(-1))).at, 't1999');
  assert.ok(elapsed < 1000, `${elapsed} ms`);
});
