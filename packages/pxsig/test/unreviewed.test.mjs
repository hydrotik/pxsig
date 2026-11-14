/**
 * unreviewed.test.mjs — baselines no person approved (lib/integrity/unreviewed.mjs): the rule that
 * tells reviewed from unreviewed from the approval log, the ratchet (queue vs new), the queue's
 * order, and what the ledger carries. On the integrity fixture (test/fixture.mjs), in a temp dir.
 *
 *   node --test packages/pxsig/test/unreviewed.test.mjs
 */
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../src/lib/approvals/core.mjs';
import { reconcile } from '../src/lib/integrity.mjs';
import { atLeast, reviewOrder, reviewState } from '../src/lib/integrity/unreviewed.mjs';
import { fixture } from './fixture.mjs';
/** @import { ApprovalLine } from '../src/types.js' */

/**
 * A log line.
 * @param {Partial<ApprovalLine> & { id: string, after: string | null }} l
 * @returns {ApprovalLine}
 */
const line = (l) => ({
  at: '2026-11-01T00:00:00.000Z',
  via: 'dashboard',
  batch: '2026-11-01T00-00-00-000Z-dashboard',
  kind: null,
  gitHead: 'abc1234',
  before: null,
  pxsig: '0.7.7',
  ...l,
});

test('atLeast: versions, a pre-release of the ratchet counts as it, no version is older', () => {
  assert.equal(atLeast('0.7.7', '0.7.7'), true);
  assert.equal(atLeast('0.7.7-rc.1', '0.7.7'), true);
  assert.equal(atLeast('0.8.0', '0.7.7'), true);
  assert.equal(atLeast('0.7.6', '0.7.7'), false);
  assert.equal(atLeast(undefined, '0.7.7'), false);
});

test('reviewState: a person logged these bytes; anything else is unreviewed, queued or new', () => {
  const id = 'components-a--b';
  assert.deepEqual(reviewState([line({ id, after: 'h1' })], 'h1'), { reviewed: true });
  // A person approved older bytes; a migration wrote these, before the ratchet: the queue.
  assert.deepEqual(
    reviewState(
      [
        line({ id, after: 'h0', pxsig: '0.4.0' }),
        line({ id, after: 'h1', via: 'migrate', pxsig: '0.5.0' }),
      ],
      'h1'
    ),
    { reviewed: false, new: false, by: 'migrate' }
  );
  // `check --update`, an adoption, an assistant (MCP or a marker) from the ratchet on: new.
  for (const [l, by] of /** @type {const} */ ([
    [{ via: 'check-update' }, 'check-update'],
    [{ via: 'adopt' }, 'adopt'],
    [{ via: 'mcp' }, 'mcp'],
    [{ via: 'dashboard', agent: 'an-assistant' }, 'assistant'],
  ]))
    assert.deepEqual(reviewState([line({ id, after: 'h1', ...l })], 'h1'), {
      reviewed: false,
      new: true,
      by,
    });
  // An undo is never a review of its own; an undo back to bytes a person approved is reviewed.
  assert.equal(
    reviewState([line({ id, after: 'h1', undo: { in: 'dashboard', from: 'snapshot' } })], 'h1')
      .reviewed,
    false
  );
  assert.deepEqual(
    reviewState(
      [
        line({ id, after: 'h1' }),
        line({ id, after: 'h2' }),
        line({ id, after: 'h1', undo: { in: 'dashboard', from: 'snapshot' } }),
      ],
      'h1'
    ),
    { reviewed: true }
  );
  // No line at all: the queue (from before the log). Lines, but none for these bytes: new.
  assert.deepEqual(reviewState([], 'h1'), { reviewed: false, new: false, by: 'unlogged' });
  assert.deepEqual(reviewState([line({ id, after: 'h0' })], 'h1'), {
    reviewed: false,
    new: true,
    by: 'outside pxsig',
  });
});

test('reviewOrder: the file names who goes first and usage; otherwise by name', (t) => {
  const { ctx, repo } = fixture({ withSigs: false, t });
  assert.equal(reviewOrder(ctx).source, 'name');
  writeFileSync(
    join(repo, 'review-order.json'),
    JSON.stringify({ first: ['Gamma'], usage: { Alpha: 3, 'components/Beta': 9 } })
  );
  const order = reviewOrder({
    ...ctx,
    config: { ...ctx.config, approvals: { reviewOrder: 'review-order.json' } },
  });
  assert.equal(order.source, 'file');
  const sorted = [
    'components/Alpha',
    'components/Beta',
    'components/Delta',
    'components/Gamma',
  ].sort((a, b) => {
    const [ra, ua] = order.rank(a);
    const [rb, ub] = order.rank(b);
    return ra - rb || ua - ub || a.localeCompare(b);
  });
  assert.deepEqual(sorted, [
    'components/Gamma',
    'components/Beta',
    'components/Alpha',
    'components/Delta',
  ]);
  const bad = reviewOrder({
    ...ctx,
    config: { ...ctx.config, approvals: { reviewOrder: 'missing.json' } },
  });
  assert.match(String(bad.problem), /missing\.json is missing or not JSON/);
});

test('the ledger flags each unreviewed baseline, keeps every status, and counts queue and growth', async (t) => {
  const { ctx, ids, sig, index } = fixture({ withSigs: false, t });
  const offline = { index, offline: true };
  // No log at all: every baseline is in the queue, by component then id.
  const before = await reconcile(ctx, offline);
  const flagged = before.entries.filter((e) => e.unreviewed);
  assert.ok(flagged.length > 0);
  assert.ok(flagged.every((e) => e.unreviewed?.by === 'unlogged' && e.unreviewed.queue));
  assert.equal(before.summary.unreviewed?.count, flagged.length);
  assert.equal(before.summary.unreviewed?.new, 0);
  assert.equal(before.summary.unreviewed?.order, 'name');
  assert.deepEqual(
    before.summary.unreviewed?.next,
    flagged
      .sort((a, b) => a.component.localeCompare(b.component) || a.id.localeCompare(b.id))
      .slice(0, 10)
      .map((e) => e.id)
  );
  assert.equal(before.entries.find((e) => e.id === ids.ok)?.status, 'ok', 'a flag, not a status');
  assert.ok(!before.setup.some((s) => s.code === 'unreviewed-new'));

  // A person approves one; `check --update` writes another (from the ratchet on): growth.
  appendFileSync(
    ctx.files.approvals,
    `${JSON.stringify(line({ id: ids.ok, after: sha256(sig(ids.ok)) }))}\n${JSON.stringify(
      line({ id: ids.drift, after: sha256(sig(ids.drift)), via: 'check-update' })
    )}\n`
  );
  const after = await reconcile(ctx, offline);
  assert.equal(after.entries.find((e) => e.id === ids.ok)?.unreviewed, undefined);
  assert.deepEqual(after.entries.find((e) => e.id === ids.drift)?.unreviewed, {
    new: true,
    by: 'check-update',
  });
  assert.equal(after.summary.unreviewed?.queue, flagged.length - 2);
  assert.equal(after.summary.unreviewed?.new, 1);
  const grown = after.setup.find((s) => s.code === 'unreviewed-new');
  assert.equal(grown?.severity, 'warn');
  assert.match(String(grown?.reason), new RegExp(`${ids.drift}, by check-update`));
  const alpha = after.components.find((c) => c.component === 'components/Alpha');
  assert.equal(alpha?.unreviewed, 1);
});
