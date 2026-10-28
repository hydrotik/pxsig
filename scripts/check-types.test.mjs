import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countDiagnostics } from './lib/lint-ratchet.mjs';
import { parseTsc } from './check-types.mjs';

test("tsc's lines (relative to the repository root, where it runs) become diagnostics", () => {
  const out = [
    "packages/pxsig/src/lib/a.mjs(3,7): error TS7006: Parameter 'x' implicitly has an 'any' type.",
    'scripts\\b.mjs(10,1): error TS2339: Property y does not exist.',
    '  continuation line',
    'Found 2 errors.',
  ].join('\n');
  const d = parseTsc(out);
  assert.deepEqual(
    d.map((x) => [x.filename, x.code, x.at]),
    [
      ['packages/pxsig/src/lib/a.mjs', 'TS7006', '3:7'],
      ['scripts/b.mjs', 'TS2339', '10:1'],
    ]
  );
  assert.deepEqual(countDiagnostics(d), {
    'packages/pxsig/src/lib/a.mjs': { TS7006: 1 },
    'scripts/b.mjs': { TS2339: 1 },
  });
});
