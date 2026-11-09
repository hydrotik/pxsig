/**
 * server-review-event.test.mjs — a decision's `review` event carries what the decision changed in
 * the page's data (the dashboard applies it instead of fetching `/__pxsig/data` again): the entry's
 * decision, and when check.json was rewritten, the entry's row and the recounted summary, equal to
 * what `/__pxsig/data` answers right after. The server runs in process on a fixture project in a
 * temp dir; its broadcasts are recorded.
 *
 *   node --test packages/pxsig/test/server-review-event.test.mjs
 *
 * Needs the Rust binary (an approval's capture); skipped without it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildData } from '../src/report.mjs';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { a11yReview } from '../src/serve/a11y.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { review } from '../src/serve/review.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

/**
 * @typedef {{ id: string, approved?: unknown }} Row
 * @typedef {{ entry?: { state: string } | null, a11y?: unknown, row?: Row | null, summary?: unknown }} ReviewEvent
 * @typedef {{ review: Record<string, unknown>, a11yReview: Record<string, unknown>, check: { rows: Row[], summary: unknown } }} Fetched
 */

test(
  "each decision's review event matches the data a fetch would answer",
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
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
      /** @type {ReviewEvent[]} */
      const events = [];
      srv.broadcast = (event, data = {}) => {
        if (event === 'review') events.push(data);
      };
      const last = () => {
        const ev = events.at(-1);
        assert.ok(ev, 'a review event');
        return ev;
      };
      const id = f.ids.changed;
      /** The data a fetch of `/__pxsig/data` answers now, as far as this test reads it. */
      const data = () => /** @type {Fetched} */ (/** @type {unknown} */ (buildData(S.P)));
      const rowOf = (/** @type {Fetched} */ d) => d.check.rows.find((r) => r.id === id);

      await review(srv, S, 'reject', id);
      let ev = last();
      assert.deepEqual(ev?.entry, data().review[id]);
      assert.ok(!('row' in ev) && !('summary' in ev), 'a reject leaves check.json as it was');

      await review(srv, S, 'approve', id);
      ev = last();
      let d = data();
      assert.equal(ev.entry?.state, 'approved');
      assert.deepEqual(ev.entry, d.review[id]);
      assert.deepEqual(ev.row, rowOf(d));
      assert.ok(ev.row?.approved, 'the row is marked approved');
      assert.deepEqual(ev.summary, d.check.summary);

      await review(srv, S, 'unreview', id);
      ev = last();
      d = data();
      assert.equal(ev.entry, null);
      assert.equal(d.review[id], undefined);
      assert.deepEqual(ev.row, rowOf(d));
      assert.equal(ev.row?.approved, undefined);
      assert.deepEqual(ev.summary, d.check.summary);

      await a11yReview(srv, S, 'a11y-reject', id);
      ev = last();
      assert.deepEqual(ev.a11y, data().a11yReview[id]);
      assert.ok(!('row' in ev), 'an a11y reject leaves check.json as it was');
    } finally {
      await app.stop();
    }
  }
);
