// The panel's state and traffic: a burst of server events is one refresh, an unchanged answer
// re-renders nothing and leaves the sidebar alone, and a check that did not start says why.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coalesce, createStore, postCheck, sameList } from '../panel-store.mjs';

const tick = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

test('an update that changes nothing notifies no one and keeps the same state object', () => {
  const store = createStore({ up: false, stories: {} });
  let calls = 0;
  const off = store.subscribe(() => calls++);
  const first = store.get();
  assert.equal(store.update({ up: false, stories: {} }), false);
  assert.equal(store.get(), first);
  assert.equal(calls, 0);
  assert.equal(store.update({ up: true }), true);
  assert.equal(calls, 1);
  assert.notEqual(store.get(), first);
  assert.deepEqual(store.get(), { up: true, stories: {} });
  // An equal but new object from the server is not a change.
  assert.equal(store.update({ stories: {} }), false);
  off();
  store.update({ up: false });
  assert.equal(calls, 1);
});

test('a burst of calls is one run, and a call during a run is one more run after it', async () => {
  let runs = 0;
  /** @type {() => void} */
  let release = () => {};
  const run = () =>
    new Promise((/** @type {(v: void) => void} */ r) => {
      runs++;
      release = r;
    });
  const schedule = coalesce(run, 5);
  for (let i = 0; i < 5; i++) schedule();
  await tick(20);
  assert.equal(runs, 1);
  schedule();
  schedule();
  release();
  await tick(20);
  assert.equal(runs, 2);
  release();
  await tick(20);
  assert.equal(runs, 2);
});

test('the status list is the same when its JSON is', () => {
  const a = sameList([{ storyId: 'a', value: 'status-value:success' }], null);
  assert.equal(a.same, false);
  assert.equal(sameList([{ storyId: 'a', value: 'status-value:success' }], a.key).same, true);
  assert.equal(sameList([{ storyId: 'a', value: 'status-value:warning' }], a.key).same, false);
});

test('a check that did not start says why, in neutral words', async () => {
  /** @type {unknown[]} */
  const seen = [];
  const answer = (/** @type {number} */ status) =>
    /** @type {typeof fetch} */ (
      async (url, init) => {
        seen.push([url, init?.method, init?.body]);
        return new Response('', { status });
      }
    );
  assert.equal(await postCheck('http://s', { story: 'a--b' }, answer(202)), null);
  assert.deepEqual(seen[0], ['http://s/__pxsig/check', 'POST', '{"story":"a--b"}']);
  assert.equal(
    await postCheck('http://s', { all: true }, answer(500)),
    'Check not started: the pxsig server answered 500.'
  );
  const down = /** @type {typeof fetch} */ (
    async () => {
      throw new TypeError('fetch failed');
    }
  );
  assert.equal(
    await postCheck('http://s', { all: true }, down),
    'Check not started: no answer from the pxsig server.'
  );
});
