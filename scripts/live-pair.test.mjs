// The live screens' `{ pair: id }` action (scripts/live/pair.mjs): the staged baseline reads as a
// record and an image from two renders, and is the one entry Repair baseline records may write.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { planRecordRepair } from '../packages/pxsig/src/lib/approvals/record-repair.mjs';
import { pairProblems } from '../packages/pxsig/src/lib/integrity/pairs.mjs';
import { resolveContext } from '../packages/pxsig/src/lib/integrity.mjs';
import { reviewState } from '../packages/pxsig/src/lib/integrity/unreviewed.mjs';
import { openProject } from '../packages/pxsig/src/lib/workspace.mjs';
import { fixture, hasRust, rustBin } from '../packages/pxsig/test/fixture.mjs';
import { stagePair } from './live/pair.mjs';

test('a staged pair is mismatched, logged by migrate only, and eligible', (t) => {
  if (!hasRust) return t.skip('Rust binary not built');
  const f = fixture({ t });
  const env = { ...process.env, PXSIG_BIN: rustBin };
  const before = readFileSync(f.sig(f.ids.ok));
  stagePair(f.repo, f.ids.ok, env);
  assert.notDeepEqual(readFileSync(f.sig(f.ids.ok)), before);
  const P = openProject({ cwd: f.repo, env });
  assert.deepEqual(pairProblems(resolveContext(P))[0]?.ids, [f.ids.ok]);
  const plan = planRecordRepair(P, JSON.parse(readFileSync(P.manifestPath(), 'utf8')));
  assert.deepEqual(
    plan.eligible.map((x) => x.id),
    [f.ids.ok]
  );
  assert.deepEqual(plan.ineligible, []);
  // Logged as an earlier pxsig's migrate wrote it: first in the log, before the review ratchet.
  const lines = readFileSync(P.store.approvals, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines[0].via, 'migrate');
  assert.equal(lines[0].id, f.ids.ok);
  assert.equal(lines[0].pxsig, '0.7.6');
  const own = lines.filter((l) => l.id === f.ids.ok);
  assert.deepEqual(reviewState(own, lines[0].after), {
    reviewed: false,
    new: false,
    by: 'migrate',
  });
});
