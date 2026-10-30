/**
 * shared-helpers.test.mjs — the helpers that used to have two copies each: `distance` (lib/args.mjs;
 * `help` calls it without swaps) and `sourceRoots` (lib/integrity/context.mjs; tools/staleness.mjs
 * calls it too). Each must give what both copies gave.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { distance } from '../src/lib/args.mjs';
import { folders, sourceRoots } from '../src/lib/integrity/context.mjs';
import { tempDir } from './fixture.mjs';

/**
 * The plain edit distance help.mjs had (insertions, deletions, substitutions).
 * @param {string} a
 * @param {string} b
 */
function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return d[a.length][b.length];
}

const WORDS = [
  '',
  'a',
  'ci',
  'cl',
  'json',
  'jsno',
  'sjon',
  'pretty',
  'pretyt',
  'approve',
  'aprove',
];
const PAIRS = WORDS.flatMap((a) => WORDS.map((b) => /** @type {const} */ ([a, b])));

test('distance without swaps is the plain edit distance help used', () => {
  for (const [a, b] of PAIRS) assert.equal(distance(a, b, { swaps: false }), levenshtein(a, b));
});

test('distance with swaps (the default) counts a swap of neighbours as one edit', () => {
  assert.equal(distance('json', 'jsno'), 1);
  assert.equal(distance('json', 'jsno', { swaps: false }), 2);
  assert.equal(distance('pretty', 'pretyt'), 1);
  assert.equal(distance('approve', 'aprove'), 1);
  assert.equal(distance('', 'ci'), 2);
  for (const [a, b] of PAIRS) {
    assert.ok(distance(a, b) <= levenshtein(a, b), `${a} / ${b}`);
    assert.equal(distance(a, b), distance(b, a), `${a} / ${b}`);
  }
});

test('sourceRoots: each existing folder once, resolved against the base; files and gaps dropped', (t) => {
  const base = tempDir('roots', t);
  mkdirSync(join(base, 'src'));
  mkdirSync(join(base, 'styles'));
  writeFileSync(join(base, 'tokens'), '');
  const roots = sourceRoots(base, ['src', join(base, 'src'), './styles', 'tokens', 'missing']);
  assert.deepEqual(roots, [join(base, 'src'), join(base, 'styles')]);
});

test('folders keeps the entries of an affects list without a file extension', () => {
  assert.deepEqual(folders(['src', 'theme.css', 'styles/', 'tokens.JSON', 'lib']), [
    'src',
    'styles/',
    'lib',
  ]);
});
