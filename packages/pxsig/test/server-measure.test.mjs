/**
 * server-measure.test.mjs — a dashboard check that counts React renders (Measure renders,
 * `renders: true`), its progress events, and Cancel (`check/cancel`): the entries rendered by
 * then get their new results, the others keep their last ones. Against a stand-in Storybook
 * (no React on its pages: the counts are null), on a fixture project.
 *
 *   node --test packages/pxsig/test/server-measure.test.mjs
 *
 * Needs the Rust binary and Chromium; skipped without them.
 */
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { readToken } from '../src/lib/guard.mjs';
import { fixture } from './fixture.mjs';
import { dashboardCookie } from './guard-helpers.mjs';
import { fakeStorybook, needs, rowsOf, serve } from './server-helpers.mjs';

/**
 * The server's events from now on, as `[event, data]`.
 * @param {number} port
 */
function events(port) {
  /** @type {[string, Record<string, any>][]} */
  const seen = [];
  let buf = '';
  const req = request({ host: '127.0.0.1', port, path: '/__pxsig/events' }, (res) =>
    res.on('data', (c) => {
      buf += c;
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev) seen.push([ev, data ? JSON.parse(data) : {}]);
      }
    })
  );
  req.on('error', () => {});
  req.end();
  return { seen, stop: () => req.destroy() };
}

/**
 * @param {() => boolean} ok
 * @param {string} what
 */
async function until(ok, what) {
  for (let i = 0; i < 600 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
}

test(
  'Measure renders counts renders and reports progress; Cancel keeps what was rendered',
  { skip: needs },
  async (t) => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    t.after(async () => {
      await S.stop();
      sb.close();
    });
    const cookie = await dashboardCookie(
      { port: S.port, url: S.base, log: S.log, stop: S.stop },
      /** @type {string} */ (readToken(f.repo, S.base))
    );
    /**
     * As the dashboard page opened with the link posts.
     * @param {string} action
     * @param {unknown} body
     */
    const page = async (action, body) => {
      const r = await fetch(`${S.base}/__pxsig/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: S.base,
          'sec-fetch-site': 'same-origin',
          cookie,
        },
        body: JSON.stringify(body),
      });
      // The server answers JSON (docs/server.md).
      return {
        status: r.status,
        body: /** @type {{ queued: string[], cancelling?: boolean, error?: string }} */ (
          await r.json()
        ),
      };
    };
    const ev = events(S.port);
    t.after(() => ev.stop());
    await new Promise((r) => setTimeout(r, 200));

    // Measure renders: the run says so, reports its progress, and every row it rendered has counts
    // (null here: no React on the stand-in's pages).
    const ids = [f.ids.ok, f.ids.flaky];
    const m = await page('check', { ids, renders: true });
    assert.equal(m.status, 202, JSON.stringify(m.body));
    await S.idle();
    const running = ev.seen.find(([e, d]) => e === 'check' && d.state === 'running');
    assert.equal(running?.[1].renders, true);
    const progress = ev.seen.filter(([e, d]) => e === 'check' && d.state === 'progress');
    assert.deepEqual(progress.at(-1)?.[1], {
      project: 'fixture',
      state: 'progress',
      done: 2,
      total: 2,
    });
    for (const id of ids)
      assert.equal(
        rowsOf(f).find((/** @type {{ id: string }} */ r) => r.id === id).renders,
        null,
        id
      );
    // An ordinary re-check counts nothing (react.renders is off in the fixture).
    const plain = await page('check', { ids: [f.ids.ok] });
    assert.equal(plain.status, 202);
    await S.idle();
    assert.equal(
      'renders' in rowsOf(f).find((/** @type {{ id: string }} */ r) => r.id === f.ids.ok),
      false
    );

    // Cancel after the first entry: the entries rendered by then are recorded, the rest keep
    // their rows as they were.
    const before = new Map(
      rowsOf(f).map((/** @type {{ id: string }} */ r) => [r.id, JSON.stringify(r)])
    );
    const from = ev.seen.length;
    const all = await page('check', { all: true });
    assert.equal(all.status, 202);
    const total = all.body.queued.length;
    await until(
      () => ev.seen.slice(from).some(([e, d]) => e === 'check' && d.state === 'progress'),
      'a progress event'
    );
    const c = await page('check/cancel', {});
    assert.deepEqual([c.status, c.body.cancelling], [200, true]);
    await S.idle();
    const end = ev.seen.slice(from).find(([e, d]) => e === 'check' && d.state === 'cancelled');
    assert.ok(end, JSON.stringify(ev.seen.slice(from).map(([e, d]) => [e, d.state])));
    const { done, ids: recorded } = end[1];
    assert.equal(end[1].total, total);
    assert.ok(done >= 1 && done < total, `${done} of ${total}`);
    assert.equal(recorded.length, done);
    for (const r of rowsOf(f)) {
      const was = before.get(r.id);
      if (recorded.includes(r.id)) continue;
      assert.equal(JSON.stringify(r), was, `${r.id} kept its last result`);
    }
    assert.ok(
      ev.seen.slice(from).some(([e]) => e === 'data'),
      'the pages hear the new rows'
    );
  }
);
