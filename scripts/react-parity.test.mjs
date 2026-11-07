/**
 * react-parity.test.mjs — the parity report's comparison (scripts/lib/react-parity.mjs): functions
 * matched by line, the compile result and the outcome counted, every difference listed.
 *
 *   node --test scripts/react-parity.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCorpus, isFlow, parserOf, percent, table } from './lib/react-parity.mjs';

/** @import { CompileResult, ReactFunction } from '../packages/pxsig/src/types/react.js' */

/**
 * @param {string} name
 * @param {number} line
 * @param {ReactFunction['outcome']} outcome
 * @returns {ReactFunction}
 */
const f = (name, line, outcome) => ({
  name,
  kind: 'component',
  line,
  endLine: line,
  outcome,
  diagnostics: [],
});

test('functions are matched by line; compile result and outcome are counted apart', () => {
  /** @type {Map<string, CompileResult>} */
  const babel = new Map([
    ['b.jsx', { functions: [f('A', 1, 'compiled'), f('B', 5, 'bailout'), f('C', 9, 'opted-out')] }],
    ['a.jsx', { error: 'compiler-error' }],
    ['c.jsx', { error: 'compiler-error' }],
  ]);
  /** @type {Map<string, CompileResult>} */
  const oxc = new Map([
    [
      'b.jsx',
      {
        functions: [
          f('A', 1, 'compiled'),
          f('B', 5, 'compiled'),
          f('C', 9, 'bailout'),
          f('D', 12, 'bailout'),
        ],
      },
    ],
    ['a.jsx', { functions: [] }],
    ['c.jsx', { error: 'compiler-error' }],
  ]);
  const p = compareCorpus(babel, oxc);
  assert.deepEqual(p, {
    files: 3,
    functions: 4,
    compiledSame: 3,
    outcomeSame: 1,
    differences: [
      'a.jsx (file) compiler-error -> ok',
      'b.jsx:5 B bailout -> compiled',
      'b.jsx:9 C opted-out -> bailout',
      'b.jsx:12 D (none) -> bailout',
    ],
  });
  assert.equal(percent(p), '75.0');
  assert.equal(percent({ ...p, functions: 0 }), '100.0');
  assert.match(
    table({ fixtures: p }, { babel: 'b 1', oxc: 'o 2' }),
    /\| fixtures \| 3 \| 4 \| 3 \(75\.0%\) \| 1 \| 4 \|/
  );
});

test('parser plugins by extension, and Flow files left out', () => {
  assert.deepEqual(parserOf('a/B.tsx'), ['jsx', 'typescript']);
  assert.deepEqual(parserOf('a/b.mts'), ['typescript']);
  assert.deepEqual(parserOf('a/b.js'), ['jsx']);
  assert.ok(isFlow('x/flow-types.js', ''));
  assert.ok(isFlow('x/a.js', '// @flow\n'));
  assert.ok(!isFlow('overflow/a.js', 'const a = 1;'));
});
