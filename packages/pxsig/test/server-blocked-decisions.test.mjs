/**
 * server-blocked-decisions.test.mjs — masks no approval passes (`masksBlocked` on the entry's check
 * row) take no decision on the server (src/serve/review.mjs `refuseBlocked`): approve, reject and
 * the a11y decisions are refused with a 409 that says the author fixes it and how, and nothing is
 * written to review.json. Owner decision after the Ready to try of pull request 322: a blocked
 * entry needs no decision from a person.
 *
 *   node --test packages/pxsig/test/server-blocked-decisions.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { a11yReview } from '../src/serve/a11y.mjs';
import { review } from '../src/serve/review.mjs';
import { fixture } from './fixture.mjs';

test('a blocked entry takes no decision: approve, reject and a11y are refused, nothing is written', async (t) => {
  const f = fixture({ t });
  const id = f.ids.changed;
  const checkPath = join(f.px, 'reports', 'check.json');
  const check = JSON.parse(readFileSync(checkPath, 'utf8'));
  const row = check.rows.find((/** @type {{ id: string }} */ r) => r.id === id);
  Object.assign(row, {
    pass: false,
    reasons: ['mask needs a reason: span[data-volatile]'],
    masks: [],
    masksBlocked: { problems: [{ kind: 'reason', element: 'span[data-volatile]' }] },
  });
  writeFileSync(checkPath, JSON.stringify(check));
  const app = createPxsigServer({
    ws: findWorkspace({ cwd: f.repo }),
    flags: {},
    port: 0,
    open: false,
  });
  try {
    await app.start();
    const { srv } = app;
    const S = [...srv.states.values()][0];
    await S.integrityDone;
    const said = `${id}: the masks block this entry, and the author fixes it (no decision is needed): mask needs a reason: span[data-volatile]; give data-volatile a reason, e.g. data-volatile="relative time"`;
    for (const action of ['reject', 'approve'])
      await assert.rejects(review(srv, S, action, id, { via: 'dashboard', note: 'no' }), (e) => {
        assert.equal(/** @type {{ status?: number }} */ (e).status, 409, action);
        assert.equal(/** @type {Error} */ (e).message, said, action);
        return true;
      });
    for (const action of ['a11y-accept', 'a11y-reject'])
      await assert.rejects(
        a11yReview(srv, S, action, id, { via: 'dashboard' }),
        /no decision is needed/
      );
    const reviewFile = join(f.px, 'reports', 'review.json');
    const kept = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, 'utf8')) : {};
    assert.equal(kept[id], undefined, 'no decision recorded');
    // Another entry still takes a reject.
    const other = await review(srv, S, 'reject', f.ids.a11y, { via: 'dashboard' });
    assert.equal(other?.state, 'rejected');
  } finally {
    await app.stop();
  }
});
