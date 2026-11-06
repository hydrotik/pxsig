/**
 * server-react.test.mjs — the React analysis in `pxsig serve` (serve/react.mjs): the run after the
 * startup integrity pass, `data.react`, the `react` events of Analyse, and the dashboard link the
 * runs a person starts need (Analyse, Skip, Measure renders, Cancel); React switched off. A
 * spawned server in the React fixture project (react-helpers.mjs), with no Storybook.
 *
 *   node --test packages/pxsig/test/server-react.test.mjs
 */
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { NEEDS_LINK_CODE } from '../src/lib/guard.mjs';
import { hasRust } from './fixture.mjs';
import { dashboardCookie, raw, serve } from './guard-helpers.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { hasCompiler, reactProject } from './react-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ReactData } from '../src/types/react.js' */

const skip = skipUnless(
  hasRust && hasCompiler,
  'the engine or the React Compiler test fixtures are missing'
);

/**
 * `pxsig serve` in a React fixture project.
 * @param {string} dir
 */
const serveAt = (dir) =>
  serve(/** @type {Parameters<typeof serve>[0]} */ (/** @type {unknown} */ ({ repo: dir })));

/**
 * `data.react` once `ok` holds (the startup run goes on after the server answers).
 * @param {number} port
 * @param {(r: ReactData) => boolean} ok
 * @returns {Promise<ReactData>}
 */
async function reactWhen(port, ok) {
  /** @type {ReactData | undefined} */
  let r;
  for (let i = 0; i < 150; i++) {
    r = /** @type {{ react?: ReactData }} */ ((await raw(port, { path: '/__pxsig/data' })).json())
      .react;
    if (r && ok(r)) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`data.react never got there: ${JSON.stringify(r)}`);
}

/**
 * The server's events from now on, as `[event, data]`, until `stop()`.
 * @param {number} port
 */
function events(port) {
  /** @type {[string, Record<string, unknown>][]} */
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

test(
  'the server analyses after its startup pass; data.react; Analyse sends react events; the runs need the link',
  { skip },
  async (t) => {
    const dir = reactProject(t);
    const S = await serveAt(dir);
    t.after(() => S.stop());
    const ready = await reactWhen(S.port, (r) => r.status.compiler === 'ready' && !!r.report);
    assert.equal(ready.source, 'server');
    assert.deepEqual(ready.status.missing, []);
    assert.equal(ready.status.off, null);
    assert.deepEqual(
      ready.report?.alerts.map((a) => a.change),
      ['new-bailout', 'new-finding']
    );

    // Without the link: the four runs a person starts are refused, and nothing starts.
    const browser = { origin: S.url, 'sec-fetch-site': 'same-origin' };
    for (const [path, body] of /** @type {const} */ ([
      ['/__pxsig/react/analyse', {}],
      ['/__pxsig/react/skip', {}],
      ['/__pxsig/check/cancel', {}],
      ['/__pxsig/check', { ids: ['button--primary'], renders: true }],
    ])) {
      const r = await raw(S.port, { method: 'POST', path, headers: browser, body });
      assert.equal(r.status, 403, `${path}: ${r.text}`);
      assert.equal(r.json().code, NEEDS_LINK_CODE, path);
      assert.match(r.json().error, /needs the dashboard link/);
    }
    // The CLI's token is not the link either.
    const token = /** @type {string} */ (readToken(dir, S.url));
    const cli = await raw(S.port, {
      method: 'POST',
      path: '/__pxsig/react/analyse',
      headers: { 'x-pxsig-token': token },
      body: {},
    });
    assert.equal(cli.status, 403);

    // With the link: Analyse runs (cached now), with its events, and data follows.
    const cookie = await dashboardCookie(S, token);
    const linked = { ...browser, cookie };
    const ev = events(S.port);
    t.after(() => ev.stop());
    await new Promise((r) => setTimeout(r, 200));
    const go = await raw(S.port, {
      method: 'POST',
      path: '/__pxsig/react/analyse',
      headers: linked,
      body: {},
    });
    assert.equal(go.status, 202, go.text);
    for (let i = 0; i < 100 && !ev.seen.some(([e, d]) => e === 'react' && d.state === 'done'); i++)
      await new Promise((r) => setTimeout(r, 100));
    const react = ev.seen.filter(([e]) => e === 'react').map(([, d]) => d);
    assert.equal(react[0].state, 'running');
    assert.equal(react[0].trigger, 'analyse');
    const done = react.find((d) => d.state === 'done');
    assert.ok(done, JSON.stringify(react));
    assert.equal(/** @type {{ alerts: number }} */ (done.summary).alerts, 2);
    const last = react.filter((d) => d.state === 'running').at(-1);
    assert.deepEqual(last?.files, { done: 1, total: 1 });
    assert.equal(last?.cached, 1);

    // Skip with nothing running, Cancel with no check: answered, nothing done.
    const skipped = await raw(S.port, {
      method: 'POST',
      path: '/__pxsig/react/skip',
      headers: linked,
      body: {},
    });
    assert.deepEqual([skipped.status, skipped.json().skipped], [200, false]);
    const cancel = await raw(S.port, {
      method: 'POST',
      path: '/__pxsig/check/cancel',
      headers: linked,
      body: {},
    });
    assert.deepEqual([cancel.status, cancel.json().error], [409, 'no check is running']);
  }
);

test('React off in the config: data.react says where; Analyse is refused', { skip }, async (t) => {
  const dir = reactProject(t, { config: { react: { compiler: false } } });
  const S = await serveAt(dir);
  t.after(() => S.stop());
  const r = await reactWhen(S.port, () => true);
  assert.equal(r.status.compiler, 'off');
  assert.equal(r.status.renders, 'ready');
  assert.deepEqual(r.status.off, { where: 'config', key: 'react.compiler' });
  assert.equal(r.report, null);
  const cookie = await dashboardCookie(S, /** @type {string} */ (readToken(dir, S.url)));
  const go = await raw(S.port, {
    method: 'POST',
    path: '/__pxsig/react/analyse',
    headers: { origin: S.url, 'sec-fetch-site': 'same-origin', cookie },
    body: {},
  });
  assert.deepEqual(
    [go.status, go.json().error],
    [409, 'compiler analysis is off (react.compiler: false)']
  );
});

test(
  'the compiler not installed: data.react names the packages; everything off: where',
  { skip },
  async (t) => {
    const none = reactProject(t, { babel: null });
    const S = await serveAt(none);
    t.after(() => S.stop());
    const r = await reactWhen(S.port, () => true);
    assert.equal(r.status.compiler, 'not-installed');
    assert.deepEqual(r.status.missing, ['babel-plugin-react-compiler', '@babel/core']);
    const off = reactProject(t, { config: { react: false } });
    const O = await serveAt(off);
    t.after(() => O.stop());
    const o = await reactWhen(O.port, () => true);
    assert.deepEqual([o.status.compiler, o.status.renders], ['off', 'off']);
    assert.deepEqual(o.status.off, { where: 'config', key: 'react' });
  }
);
