// `doctor --fail-on info`. Temp folders only; no Storybook, no server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cli, cleanProject } from './features-helpers.mjs';

// --- doctor --fail-on info, check --since rows -----------------------------------------------------------------

test('doctor --fail-on info passes ok / drift-only ledgers and fails on info findings', () => {
  const clean = cleanProject();
  const r = cli(['doctor', '--offline', '--fail-on', 'info', '--json'], clean);
  assert.equal(r.status, 0, r.stdout.slice(0, 2000) + r.stderr);
  assert.ok(JSON.parse(r.stdout).summary.byStatus.drift >= 1);
  const quiet = cleanProject({ quiet: true });
  assert.equal(
    cli(['doctor', '--offline', '--fail-on', 'info', '--json'], quiet).status,
    1,
    'skipped-unaffected is an info finding'
  );
  assert.equal(
    cli(['doctor', '--offline', '--fail-on', 'warn', '--json'], quiet).status,
    0,
    'but not a warning'
  );
});
