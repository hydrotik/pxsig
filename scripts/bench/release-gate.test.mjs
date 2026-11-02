import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gate,
  MAX_AGE_DAYS,
  MAX_BEHIND,
  pickRun,
  stale,
  STEP,
  stepConclusion,
} from './release-gate.mjs';

const runs = [
  { databaseId: 3, headSha: 'c'.repeat(40), conclusion: 'success' },
  { databaseId: 2, headSha: 'b'.repeat(40), conclusion: 'failure', url: 'https://example.test/2' },
  { databaseId: 1, headSha: 'a'.repeat(40), conclusion: 'success' },
];

test('the newest run on the tagged commit or an ancestor of it is the one read', () => {
  // c is newer than the tag (not an ancestor); b is.
  const ancestors = new Set(['b'.repeat(40), 'a'.repeat(40)]);
  assert.equal(pickRun(runs, (h) => ancestors.has(h))?.databaseId, 2);
  assert.equal(
    pickRun(runs, () => false),
    null
  );
});

test('only the benchmark step counts, by its name or the name GitHub gave it before', () => {
  const jobs = (/** @type {string} */ name, /** @type {string} */ conclusion) => ({
    jobs: [
      {
        steps: [
          { name: 'Run pnpm install --frozen-lockfile', conclusion: 'success' },
          { name, conclusion },
          { name: 'Run pnpm audit --prod --audit-level high', conclusion: 'failure' },
        ],
      },
    ],
  });
  assert.equal(stepConclusion(jobs(STEP, 'success')), 'success');
  assert.equal(
    stepConclusion(
      jobs('Run node scripts/bench/run.mjs --runs 5 --out bench-results.json', 'failure')
    ),
    'failure'
  );
  assert.equal(stepConclusion({ jobs: [{ steps: [] }] }), null);
});

test('a failed benchmark fails the release; no run or an unfinished step only warns', () => {
  const [, b] = runs;
  assert.equal(gate(b, 'failure').exit, 1);
  assert.match(gate(b, 'failure').text, /re-run bench on main/);
  assert.deepEqual([gate(b, 'success').exit, gate(b, 'success').level], [0, 'notice']);
  assert.deepEqual([gate(null, null).exit, gate(null, null).level], [0, 'warning']);
  assert.deepEqual([gate(b, 'skipped').exit, gate(b, 'skipped').level], [0, 'warning']);
});

test('a run older than MAX_AGE_DAYS or MAX_BEHIND commits counts as none, whatever its result', () => {
  const [, b] = runs;
  assert.deepEqual([MAX_AGE_DAYS, MAX_BEHIND], [7, 20]);
  assert.equal(stale({ ageDays: 7, behind: 20 }), null, 'the limits themselves are fresh');
  assert.equal(stale({}), null, 'unknown age and distance do not count against a run');
  for (const fresh of [{ ageDays: 7.5 }, { behind: 21 }]) {
    for (const conclusion of ['success', 'failure']) {
      const g = gate(b, conclusion, fresh, 'o/r');
      assert.deepEqual([g.exit, g.level], [0, 'warning'], JSON.stringify({ fresh, conclusion }));
      assert.match(g.text, /too old to count/);
      assert.match(g.text, /gh workflow run bench\.yml -R o\/r --ref main/);
    }
  }
  assert.match(
    gate(b, 'success', { ageDays: 9.2, behind: 30 }).text,
    /9 days old \(limit 7\), 30 commits/
  );
  assert.match(gate(null, null, {}, 'o/r').text, /gh workflow run bench\.yml -R o\/r/);
});

test('a fresh run keeps its result, and the notice says how far before the tag it ran', () => {
  const [, b] = runs;
  const ok = gate(b, 'success', { ageDays: 37 / 1440, behind: 0 });
  assert.deepEqual([ok.exit, ok.level], [0, 'notice']);
  assert.match(ok.text, /\(1 h ago, on the tag\): not slower/);
  assert.match(gate(b, 'success', { ageDays: 2.25, behind: 4 }).text, /2\.3 days ago, 4 commits/);
  assert.equal(
    gate(b, 'failure', { ageDays: 6.9, behind: 20 }).exit,
    1,
    'a fresh failure still fails'
  );
});
