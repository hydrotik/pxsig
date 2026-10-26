import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rustBinary } from '../../packages/pxsig/src/lib/workspace.mjs';
import { generateStore } from './generate-store.mjs';
import { judge, SLACK_MS } from './run.mjs';

test('a step fails over its fixed budget, or more than 50% over the last release', () => {
  const v = Object.fromEntries(judge({ affected: 2100, list: 40, doctor: 900, plan: 700, data: 50 }, { affected: 300, list: 30, doctor: 500, plan: 400, data: 60 }).map((x) => [x.step, x]));
  assert.deepEqual(v.affected.why, ['over the 2000 ms budget', 'more than 50% over the last release (300 ms)']);
  assert.equal(v.list.fail, false, `a rise under ${SLACK_MS} ms is noise`);
  assert.equal(v.doctor.fail, true);
  assert.equal(v.plan.fail, true, 'plan has no fixed budget, only the 50% rule');
  assert.equal(v.data.fail, false);
});

test('with no baseline for this OS, only the budgets apply', () => {
  assert.deepEqual(judge({ affected: 1900, plan: 99999 }, null).map((x) => x.fail), [false, false]);
});

test('the synthetic store has hydrotik\'s size and is the same for the same seed', { skip: !existsSync(process.env.PXSIG_BIN || rustBinary()) && 'the Rust engine is not built' }, () => {
  const a = mkdtempSync(join(tmpdir(), 'pxsig-bench-a-'));
  const b = mkdtempSync(join(tmpdir(), 'pxsig-bench-b-'));
  try {
    const ra = generateStore(a);
    const rb = generateStore(b);
    assert.deepEqual([ra.entries, ra.matrix, ra.renders, ra.storyFiles], [1074, 1668, 2742, 168]);
    assert.deepEqual(ra.changed, rb.changed);
    for (const f of ['.pxsig/manifest.json', '.pxsig/manifest.matrix.json', '.pxsig/a11y.json', 'src/index.ts']) assert.equal(readFileSync(join(a, f), 'utf8'), readFileSync(join(b, f), 'utf8'), f);
    assert.equal(readFileSync(join(a, '.pxsig/approvals.ndjson'), 'utf8').trim().split('\n').length, 2742 + 293 + 1);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
