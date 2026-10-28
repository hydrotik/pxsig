// expandEntries: a story's parameters.pxsig is user data, checked before it shapes an entry. No browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandEntries } from '../src/lib/manifest.mjs';
/** @import { StoryParameters } from '../src/types.js' */

const stories = [{ id: 'a-b--c', importPath: 'src/a.stories.tsx', sigFor: () => 'x.psig' }];
/** @param {unknown} pxsig */
const params = (pxsig) =>
  /** @type {Record<string, StoryParameters>} */ ({ 'a-b--c': { pxsig, tags: [] } });
/** @param {unknown} pxsig */
const expand = (pxsig) => expandEntries({}, stories, params(pxsig));

test('valid parameters shape the entries', () => {
  const { entries } = expand({
    grid: 96,
    delay: 400,
    ignore: ['.live'],
    viewport: [320, 640],
    states: [{ name: 'hover', action: 'hover', target: 'button' }],
    a11y: false,
  });
  assert.deepEqual(
    entries.map((e) => e.id),
    ['a-b--c', 'a-b--c__hover']
  );
  assert.equal(entries[0].grid, 96);
  assert.deepEqual(entries[0].viewport, [320, 640]);
  assert.equal(entries[0].a11y, false);
});

test('null cancels an inherited value, and grid 0 leaves the adaptive grid on', () => {
  const { entries } = expand({ delay: null, target: null, grid: 0 });
  assert.equal(entries[0].delay, undefined);
  assert.equal(entries[0].grid, undefined);
});

test('a state with no action is still an entry (it waits and captures)', () => {
  const { entries } = expand({ states: [{ name: 'loaded', waitFor: '[data-ready]' }] });
  assert.deepEqual(
    entries.map((e) => e.id),
    ['a-b--c', 'a-b--c__loaded']
  );
});

test('a bad parameters.pxsig value is a setup error naming the story and the field', () => {
  for (const [pxsig, field] of /** @type {[unknown, string][]} */ ([
    [{ addModes: 7 }, 'addModes'],
    [{ modes: 'dark' }, 'modes'],
    [{ states: [{ action: 'hover' }] }, 'states'],
    [{ states: [{ name: 'hover', action: 7 }] }, 'states'],
    [{ states: { name: 'hover' } }, 'states'],
    [{ grid: '96' }, 'grid'],
    [{ ignore: '.live' }, 'ignore'],
    [{ viewport: [320] }, 'viewport'],
    [{ delay: -1 }, 'delay'],
    [{ target: 3 }, 'target'],
    [{ gate: 24 }, 'gate'],
    [{ disable: 'no' }, 'disable'],
    [{ detail: 'off' }, 'detail'],
    [{ a11y: 0 }, 'a11y'],
  ]))
    assert.throws(
      () => expand(pxsig),
      (/** @type {Error & { setup?: boolean }} */ e) =>
        e.setup === true &&
        e.message.startsWith(`story "a-b--c": parameters.pxsig.${field} must be`),
      field
    );
  assert.throws(() => expand(['dark']), /story "a-b--c": parameters.pxsig must be an object/);
});
