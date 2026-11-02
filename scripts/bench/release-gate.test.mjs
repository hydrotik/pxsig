import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gate, pickRun, STEP, stepConclusion } from './release-gate.mjs';

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
