/**
 * gate-colour.test.mjs — the colour rule's settings: the built-in project gate, the schema's limits
 * and the `gate-colour-off` setup warning (lib/integrity/problems.mjs), which is how a project that
 * turns the rule off or loosens it past its limits shows in `pxsig doctor` and the dashboard.
 *
 *   node --test packages/pxsig/test/gate-colour.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COLOUR_LIMITS, colourGateProblems } from '../src/lib/integrity/problems.mjs';
import { DEFAULTS } from '../src/lib/workspace/layers.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema/project.json', import.meta.url), 'utf8'));
const on = { deltaE: 3, minArea: 64, cellDeltaE: 5, minCells: 3 };
/** @param {[string, unknown][]} rows `[id, gate.colour]`; `undefined` leaves the key out */
const report = (rows) =>
  /** @type {any} */ ({
    rows: rows.map(([id, colour]) => ({ id, gate: colour === undefined ? {} : { colour } })),
  });
const ctx = /** @type {any} */ ({ integrity: {} });

test('the built-in gate turns the colour rule on, inside the limits the schema sets', () => {
  assert.deepEqual(DEFAULTS.gate.colour, on);
  const props = schema.$defs.colourGate.oneOf[1].properties;
  for (const [k, max] of Object.entries(COLOUR_LIMITS)) {
    assert.equal(props[k].maximum, max, `schema maximum of ${k}`);
    assert.ok(on[/** @type {keyof typeof on} */ (k)] <= max);
  }
  assert.equal(schema.$defs.gate.properties.colour.$ref, '#/$defs/colourGate');
});

test('gate-colour-off: rows checked with the rule off or past its limits, from any layer', () => {
  assert.deepEqual(colourGateProblems(report([['a', on]]), ctx), []);
  assert.deepEqual(
    colourGateProblems(report([['old', undefined]]), ctx),
    [],
    'a row from an engine before the rule'
  );
  assert.deepEqual(colourGateProblems(null, ctx), []);
  const [w, ...more] = colourGateProblems(
    report([
      ['a', on],
      ['off', null],
      ['wide', { ...on, deltaE: 40 }],
      ['no-flat', { ...on, minArea: 0 }],
      ['at-limit', { ...on, ...COLOUR_LIMITS }],
    ]),
    ctx
  );
  assert.equal(more.length, 0);
  assert.equal(w.code, 'gate-colour-off');
  assert.equal(w.severity, 'warn');
  assert.equal(w.count, 3, 'off, past a limit, one check off; at the limits is not counted');
  assert.match(
    w.reason,
    /^3 entries were checked without the colour rule \(1 with it off, 2 with it loosened past its limits: off, wide, no-flat\)/
  );
  assert.match(w.reason, /deltaE 10, minArea 1024, cellDeltaE 15 and minCells 16/);
  /** @param {string} severity */
  const at = (severity) =>
    colourGateProblems(
      report([['off', null]]),
      /** @type {any} */ ({ integrity: { severity: { 'gate-colour-off': severity } } })
    )[0];
  assert.equal(at('error').severity, 'error', 'integrity.severity can raise it');
  assert.doesNotMatch(at('error').reason, /not applied/);
  assert.equal(at('warn').severity, 'warn');
  for (const low of ['info', 'off']) {
    const w = at(low);
    assert.equal(w.severity, 'warn', `${low}: never lowered`);
    assert.ok(
      w.reason.endsWith(
        `. integrity.severity sets gate-colour-off to "${low}", which is not applied: it is a warning at least, and can only be raised to error`
      ),
      'and the lowered value is named, not ignored quietly'
    );
  }
});
