/**
 * server-project-choice.test.mjs — the project a server request means (serve/projects.mjs
 * `stateFor`): named, the only one, or the one owning the entry or story id. With several projects
 * and none of those, the request is refused: the server never picks one, for a read or a write (a
 * bare `/report/` is opened on the first project by the dashboard, which names it in the URL).
 *
 *   node --test packages/pxsig/test/server-project-choice.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateFor } from '../src/serve/projects.mjs';
/** @import { ServeContext } from '../src/types/serve.js' */

/** @param {string} name @param {string[]} ids */
const state = (name, ids) => ({
  name,
  manifest: { stories: ids.map((id) => ({ id, story: id })) },
});
/** @param {ReturnType<typeof state>[]} list */
const srv = (list) =>
  /** @type {ServeContext} */ (
    /** @type {unknown} */ ({ states: new Map(list.map((S) => [S.name, S])) })
  );

test('several projects: a request names one, or an id one project owns; none is refused', () => {
  const s = srv([state('demo', ['a--one']), state('docs', ['b--one'])]);
  assert.equal(stateFor(s, { project: 'docs' }).name, 'docs');
  assert.equal(stateFor(s, { id: 'b--one' }).name, 'docs');
  assert.equal(stateFor(s, { story: 'a--one' }).name, 'demo');
  for (const q of [{}, undefined, { id: 'c--none' }])
    assert.throws(
      () => stateFor(s, q),
      (/** @type {Error & { status?: number }} */ e) =>
        e.status === 400 && e.message === 'name a project (projects: demo, docs)'
    );
  assert.throws(
    () => stateFor(s, { project: 'nope' }),
    (/** @type {Error & { status?: number }} */ e) => e.status === 404
  );
  // One project: it needs no name.
  assert.equal(stateFor(srv([state('demo', [])])).name, 'demo');
});
