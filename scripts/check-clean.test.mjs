// What check-clean lets into the repository: images only as product shots, and only small ones.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SHOT_MAX_BYTES, conflictLines, fileProblem } from './check-clean.mjs';

test('images are forbidden outside docs/product-shots/', () => {
  for (const f of [
    'docs/hero.png',
    'packages/pxsig/test/a.jpg',
    'README.webp',
    'docs/product-shots.png',
    'x/docs/product-shots/a.png',
  ])
    assert.ok(fileProblem(f, 1000), f);
});

test('product shots are allowed: images up to the size guard, and Markdown', () => {
  for (const f of [
    'docs/product-shots/inspector-dark.png',
    'docs/product-shots/a.jpeg',
    'docs/product-shots/b.webp',
    'docs/product-shots/c.avif',
    'docs/product-shots/d.gif',
    'docs/product-shots/README.md',
    'docs/product-shots/shots.json',
  ])
    assert.equal(fileProblem(f, 500 * 1024), null, f);
  assert.equal(fileProblem('docs/product-shots/edge.png', SHOT_MAX_BYTES), null);
  // A string here (assert.match fails the test on null).
  assert.match(
    /** @type {string} */ (fileProblem('docs/product-shots/big.png', SHOT_MAX_BYTES + 1)),
    /over 1\.5 MB/
  );
});

test('nothing else goes into docs/product-shots/', () => {
  for (const f of [
    'docs/product-shots/font.woff2',
    'docs/product-shots/a.psig',
    'docs/product-shots/a.pxsig.json',
    'docs/product-shots/x.svg',
    'docs/product-shots/tool.wasm',
    'docs/product-shots/shot.mjs',
    'docs/product-shots/other.json',
  ])
    assert.ok(fileProblem(f, 10), f);
  for (const f of [
    'docs/product-shots/.pxsig/latest/a.png',
    'docs/product-shots/__pxsig__/a.png',
    'docs/product-shots/dist/a.png',
  ])
    assert.ok(fileProblem(f, 10), f);
});

test('the other rules still hold', () => {
  assert.ok(fileProblem('.local/notes.md'));
  assert.ok(fileProblem('docs/product-shots/.local/a.png'));
  assert.ok(fileProblem('examples/x/.pxsig/baselines/a.psig'));
  assert.equal(fileProblem('docs/cli.md'), null);
});

test('merge conflict markers are found at the start of a line, nowhere else', () => {
  const [ours, mid, theirs] = ['<', '=', '>'].map((c) => c.repeat(7));
  const text = [
    'a',
    `${ours} HEAD`,
    'b',
    mid,
    'c',
    `${theirs} feature\r`,
    `  ${ours} indented`,
    `${'='.repeat(8)}`,
    `${mid}x`,
    'Title',
    '===',
  ].join('\n');
  assert.deepEqual(conflictLines(text), [2, 4, 6]);
  assert.deepEqual(conflictLines('no markers\n'), []);
});
