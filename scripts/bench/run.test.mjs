import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rustBinary } from '../../packages/pxsig/src/lib/workspace.mjs';
import { generateStore } from './generate-store.mjs';
import { judge, RELEASE_RATIO, SLACK_MS } from './run.mjs';

test('a step fails over its fixed budget; more than 50% over the last release only warns', () => {
  const v = Object.fromEntries(
    judge(
      { affected: 2100, list: 40, doctor: 900, plan: 3100, data: 50 },
      { affected: 300, list: 30, doctor: 500, plan: 400, data: 60 }
    ).map((x) => [x.step, x])
  );
  assert.deepEqual(v.affected.why, ['over the 2000 ms budget']);
  assert.deepEqual(v.affected.warn, ['more than 50% over the last release (300 ms)']);
  assert.equal(v.list.fail, false);
  assert.deepEqual(v.list.warn, [], `a rise under ${SLACK_MS} ms is noise`);
  assert.equal(v.doctor.fail, false, 'a rise over 50% within the budget is a warning');
  assert.deepEqual(v.doctor.warn, ['more than 50% over the last release (500 ms)']);
  assert.equal(v.plan.fail, true, 'plan has a budget too');
  assert.equal(v.data.fail, false);
});

test('more than 30% and more than SLACK_MS slower than the release in the same run fails', () => {
  const v = Object.fromEntries(
    judge({ affected: 320, list: 140, doctor: 520, plan: 900, data: 260 }, null, {
      affected: 200,
      list: 100,
      doctor: 500,
      plan: 600,
      data: 200,
    }).map((x) => [x.step, x])
  );
  assert.equal(RELEASE_RATIO, 1.3);
  assert.deepEqual(v.affected.why, [
    'more than 30% slower than the last release in this run (200 ms)',
  ]);
  assert.equal(v.list.fail, false, `40% slower but under ${SLACK_MS} ms is noise`);
  assert.equal(v.doctor.fail, false, '4% slower is within the spread');
  assert.equal(v.plan.fail, true, '50% and 300 ms slower');
  assert.equal(v.data.fail, false, 'exactly 30% is not over it');
  assert.equal(v.plan.rel, 600);
  assert.equal(v.plan.relLimit, 780);
});

test('a step the release did not run is not compared', () => {
  const [v] = judge({ list: 900 }, null, {});
  assert.equal(v.rel, null);
  assert.equal(v.fail, false);
});

test('with no baseline for this OS, only the budgets apply', () => {
  assert.deepEqual(
    judge({ affected: 1900, plan: 2900 }, null).map((x) => x.fail),
    [false, false]
  );
});

test(
  "the synthetic store has hydrotik's size and is the same for the same seed",
  { skip: !existsSync(process.env.PXSIG_BIN || rustBinary()) && 'the Rust engine is not built' },
  () => {
    const a = mkdtempSync(join(tmpdir(), 'pxsig-bench-a-'));
    const b = mkdtempSync(join(tmpdir(), 'pxsig-bench-b-'));
    try {
      const ra = generateStore(a);
      const rb = generateStore(b);
      assert.deepEqual([ra.entries, ra.matrix, ra.renders, ra.storyFiles], [1074, 1668, 2742, 168]);
      assert.deepEqual(ra.changed, rb.changed);
      for (const f of [
        '.pxsig/manifest.json',
        '.pxsig/manifest.matrix.json',
        '.pxsig/a11y.json',
        'src/index.ts',
      ])
        assert.equal(readFileSync(join(a, f), 'utf8'), readFileSync(join(b, f), 'utf8'), f);
      assert.equal(
        readFileSync(join(a, '.pxsig/approvals.ndjson'), 'utf8').trim().split('\n').length,
        2742 + 293 + 1
      );
    } finally {
      rmSync(a, { recursive: true, force: true, maxRetries: 5 });
      rmSync(b, { recursive: true, force: true, maxRetries: 5 });
    }
  }
);
