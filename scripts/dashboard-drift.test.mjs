import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { driftSummary, planFor } from './dashboard-drift.mjs';

test('a base ref: the default adapter and out folder', () => {
  assert.deepEqual(planFor(['--base-ref', 'origin/main'], '/r'), {
    mode: 'ref',
    ref: 'origin/main',
    adapter: 'examples/custom-ui/pxsig-ui',
    out: resolve('/r', 'node_modules', '.cache', 'pxsig', 'dashboard-drift'),
  });
});

test('two builds, resolved from the folder the command runs in', () => {
  assert.deepEqual(planFor(['--base-build', 'a', '--head-build', '/b', '--out', 'o'], '/r'), {
    mode: 'builds',
    base: resolve('/r', 'a'),
    head: resolve('/b'),
    out: resolve('/r', 'o'),
  });
});

test('usage problems', () => {
  for (const args of [
    [],
    ['--base-build', 'a'],
    ['--base-ref'],
    ['--base-ref', 'main', '--base-build', 'a', '--head-build', 'b'],
  ])
    assert.ok('error' in planFor(args, '/r'), args.join(' '));
});

test('the drift summary keeps the counts, failures and the comparison', () => {
  const md = [
    '## pxsig dashboard check — 2 of 2 screens rendered',
    '',
    '| Screens |',
    '',
    '### Compared with the earlier check',
    '',
    '- changed: `a` #1 (dark)',
    '',
    '### Layout',
    '',
    '- `a` #1 (dark): x',
    '',
  ].join('\n');
  const out = driftSummary(md, 'g/index.html');
  assert.match(out, /^## Dashboard drift — 2 of 2/);
  assert.match(out, /- changed: `a` #1 \(dark\)/);
  assert.doesNotMatch(out, /Layout/);
  assert.match(out, /Gallery: `g\/index.html`\n$/);
});
