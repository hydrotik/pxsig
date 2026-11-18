// Values the dashboard and the server both hold, each in its own language: the dashboard's
// TypeScript cannot import the server's modules (nor the server the dashboard's, whose source is
// copied elsewhere in the package), so this test reads the dashboard's literals and holds them
// equal to the server's exports. Masks are a security control: a mismatch here is a bug on one
// side, never a reason to edit this test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NEEDS_LINK_CODE } from '../src/lib/guard.mjs';
import { blockedPrefixes, LARGE_SHARE } from '../src/lib/mask-words.mjs';
import { NOTE_MAX } from '../src/lib/rejections.mjs';

const dashboard = (/** @type {string} */ path) =>
  readFileSync(new URL(`../../dashboard/src/${path}`, import.meta.url), 'utf8');

/**
 * The literal of `export const <name> = <literal>;` in a dashboard source.
 * @param {string} source
 * @param {string} name
 */
const literal = (source, name) => {
  const m = source.match(new RegExp(`^export const ${name} = ([^;\\n]+);$`, 'm'));
  assert.ok(m, `${name} is declared as one literal`);
  return m[1].trim();
};

test("a rejection note's limit: the reject row's and the server's", () => {
  assert.equal(Number(literal(dashboard('inspector/RejectNote.tsx'), 'NOTE_MAX')), NOTE_MAX);
});

test("the Large mask share: the inspector's and the server's words", () => {
  assert.equal(Number(literal(dashboard('inspector/masks.ts'), 'LARGE_SHARE')), LARGE_SHARE);
});

test('the reasons masks block an approval with: the same prefixes, in the same order', () => {
  const src = dashboard('inspector/masks.ts');
  const block = src.match(/^const BLOCKED = \[\n([\s\S]*?)\n\] as const;$/m);
  assert.ok(block, 'masks.ts declares BLOCKED as one array');
  const prefixes = [...block[1].matchAll(/^\s*\['((?:[^'\\]|\\.)*)', '[a-z]+'\],$/gm)].map(
    (m) => m[1]
  );
  assert.equal(prefixes.length, block[1].split('\n').length, 'every line is one [prefix, cause]');
  assert.deepEqual(prefixes, blockedPrefixes);
});

test("the code of a decision made without the dashboard link: the page's and the server's", () => {
  assert.equal(literal(dashboard('link.ts'), 'NEEDS_LINK_CODE'), `'${NEEDS_LINK_CODE}'`);
});
