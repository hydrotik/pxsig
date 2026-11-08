// text-determinism.mjs's comparison: equal records, a moved run, other strings. No browser.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compare, diffRecords } from './text-determinism.mjs';

/**
 * @param {[string, number][]} runs string, x
 * @returns {import('../packages/pxsig/src/types/text.js').TextRecord}
 */
const rec = (runs) => ({
  v: 1,
  frame: { w: 100, h: 40 },
  styles: [],
  runs: runs.map(([s, x], i) => ({ path: `0/#${i}`, s, st: 0, boxes: [[x, 0, 10, 18]] })),
  elements: [{ path: '0', tag: 'div', box: [0, 0, 100, 40] }],
  skipped: {
    iframes: 0,
    closedShadow: 0,
    hidden: 0,
    fields: 0,
    ignored: 0,
    clipped: 0,
    covered: 0,
    offFrame: 0,
  },
  truncated: false,
});

test('a run moved beyond 0.5px is counted; one within it is not', () => {
  const d = diffRecords(
    rec([
      ['1', 0],
      ['new', 12],
    ]),
    rec([
      ['1', 0.3],
      ['new', 16.25],
    ])
  );
  assert.equal(d.sameStrings, true);
  assert.equal(d.moved, 1);
  assert.equal(d.maxDx, 4.25);
  assert.equal(d.sameElements, true);
});

test('other strings are named, and byte-identical files counted', () => {
  assert.equal(diffRecords(rec([['a', 0]]), rec([['b', 0]])).sameStrings, false);
  const root = mkdtempSync(join(tmpdir(), 'text-det-'));
  try {
    const [a, b] = ['a', 'b'].map((n) => join(root, n));
    for (const d of [a, b]) mkdirSync(d);
    writeFileSync(join(a, 'x.boxes.json'), JSON.stringify(rec([['1', 0]])));
    writeFileSync(join(b, 'x.boxes.json'), JSON.stringify(rec([['1', 0]])));
    writeFileSync(join(a, 'y.boxes.json'), JSON.stringify(rec([['1', 0]])));
    writeFileSync(join(b, 'y.boxes.json'), JSON.stringify(rec([['2', 0]])));
    const md = compare([a, b]);
    assert.match(md, /2 records · 1 byte-identical · 1 differ · 0 missing · 1 with other strings/);
    assert.match(md, /\| y \| \*\*no\*\* \|/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
