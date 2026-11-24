/**
 * server-record-repair.test.mjs — "Repair baseline records" through `pxsig serve`
 * (src/serve/record-repair.mjs): the plan reads with no token; the repair is a decision, refused
 * without the dashboard link's cookie and with an assistant's token, and written with the link.
 *
 *   node --test packages/pxsig/test/server-record-repair.test.mjs
 *
 * Needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLog } from '../src/lib/approvals.mjs';
import { NEEDS_LINK_CODE, readToken, TOKEN_HEADER } from '../src/lib/guard.mjs';
import { hasRust } from './fixture.mjs';
import { dashboardCookie, raw, serve } from './guard-helpers.mjs';
import { DOT, f0, store } from './record-repair-helpers.mjs';
import { skipUnless } from './strict.mjs';

test(
  'the plan reads; the repair needs the dashboard link and writes only the listed eligible entries',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async (t) => {
    const { f, P } = store(t, { [f0('ok')]: { record: DOT } });
    const S = await serve(f);
    t.after(() => S.stop());
    const got = await raw(S.port, { path: '/__pxsig/record-repair-plan' });
    assert.equal(got.status, 200, got.text);
    const plan =
      /** @type {{ plan: import('../src/lib/approvals/record-repair.mjs').RepairPlan }} */ (
        /** @type {unknown} */ (got.json())
      ).plan;
    assert.deepEqual(
      plan.eligible.map((x) => x.id),
      [f.ids.ok]
    );
    const items = plan.eligible.map((x) => ({
      id: x.id,
      file: x.file,
    }));
    const page = { origin: S.url, 'sec-fetch-site': 'same-origin' };
    /** @param {Record<string, string>} headers @param {unknown} [body] */
    const post = (headers, body = { items }) =>
      raw(S.port, { method: 'POST', path: '/__pxsig/record-repair', headers, body });
    const lines = readLog(P).length;
    const noLink = await post(page);
    assert.equal(noLink.status, 403);
    assert.equal(noLink.json().code, NEEDS_LINK_CODE);
    const agent = await post({ [TOKEN_HEADER]: String(readToken(f.repo, S.url, 'mcp')) });
    assert.equal(agent.status, 403, 'an assistant cannot repair');
    assert.equal(readLog(P).length, lines, 'nothing logged');
    const cookie = await dashboardCookie(S, String(readToken(f.repo, S.url)));
    const bad = await post({ ...page, cookie }, { items: [{ id: f.ids.ok, file: 'x' }] });
    assert.equal(bad.status, 400);
    const ok = await post({ ...page, cookie });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json().repaired, [f.ids.ok]);
    const line = readLog(P).at(-1);
    assert.deepEqual([line?.id, line?.kind, line?.via], [f.ids.ok, 'record-repair', 'dashboard']);
    // The same list again: the bytes changed since it was listed, nothing is written.
    const again = await post({ ...page, cookie });
    assert.deepEqual(again.json().repaired, []);
    assert.deepEqual(again.json().notWritten, [{ id: f.ids.ok, why: 'no longer eligible' }]);
  }
);
