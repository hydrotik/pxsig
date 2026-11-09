/**
 * rejection-notes-local.test.mjs — a rejection's note is kept only when the store's reports/ is
 * git-ignored (lib/decisions.mjs `reportsIgnored`): an ignored store keeps it; otherwise the
 * rejection still opens with `note: null`, and the server's answer says the note was not kept
 * (`entry.noteKept: false`, `notice`, store-relative); git is asked only when a note is given.
 *
 *   node --test packages/pxsig/test/rejection-notes-local.test.mjs
 *
 * Needs git; the server's cases also need the Rust binary.
 */
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { forgetIgnored } from '../src/lib/decisions.mjs';
import { openRejection, readRejections } from '../src/lib/rejections.mjs';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { a11yReview } from '../src/serve/a11y.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { review } from '../src/serve/review.mjs';
import { fixture, hasRust, tempDir } from './fixture.mjs';
import { serve } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const NOTE = 'the focus line is too faint';
const NOTICE = 'Note not kept: .pxsig/reports/ is not git-ignored. pxsig doctor shows the fix.';
const hasGit = cp.spawnSync('git', ['--version']).status === 0;
const git = skipUnless(hasGit, 'git missing');
const server = skipUnless(hasGit && hasRust, 'Rust binary or git missing');

/**
 * A store in a fresh git repository; `ignored` gives it the .gitignore `pxsig init` writes.
 * @param {import('node:test').TestContext} t
 * @param {boolean} ignored
 */
function store(t, ignored) {
  const root = tempDir('notes', t);
  cp.spawnSync('git', ['init', '-q', root]);
  const px = join(root, '.pxsig');
  mkdirSync(px, { recursive: true });
  if (ignored) writeFileSync(join(px, '.gitignore'), 'reports/\n');
  forgetIgnored();
  return { workspaceRoot: root, store: { root: px, reports: join(px, 'reports') } };
}

/** @param {{ store: { reports: string } }} P */
const files = (P) =>
  ['rejections.json', 'rejections.ndjson'].map((n) =>
    readFileSync(join(P.store.reports, n), 'utf8')
  );

test('an ignored store keeps the note', { skip: git }, (t) => {
  const P = store(t, true);
  const r = openRejection(P, 'visual', 'ui-a--one', { via: 'dashboard', note: NOTE });
  assert.equal(r.note, NOTE);
  assert.equal(readRejections(P).visual['ui-a--one'].notes[0].note, NOTE);
  for (const text of files(P)) assert.ok(text.includes(NOTE));
});

test(
  'a store that does not ignore reports/ keeps the rejection with note null',
  { skip: git },
  (t) => {
    const P = store(t, false);
    const r = openRejection(P, 'a11y', 'ui-a--one', { via: 'dashboard', note: NOTE });
    assert.deepEqual([r.note, r.via, r.notes.length], [null, 'dashboard', 1]);
    assert.equal(readRejections(P).a11y['ui-a--one'].note, null);
    for (const text of files(P)) assert.ok(!text.includes(NOTE));
    // The caller's answer wins: told not ignored, even an ignored store keeps no note.
    const Q = store(t, true);
    assert.equal(
      openRejection(Q, 'visual', 'ui-b--two', { via: 'cli', note: NOTE, ignored: false }).note,
      null
    );
  }
);

test(
  'the server answers that the note was not kept, in the field and its log',
  { skip: server },
  async (t) => {
    const f = fixture({ t });
    rmSync(join(f.repo, '.git'), { recursive: true });
    cp.spawnSync('git', ['init', '-q', f.repo]);
    const S = await serve(f);
    try {
      const v = await S.post('reject', { id: f.ids.changed, note: NOTE });
      assert.equal(v.status, 200, JSON.stringify(v.body));
      assert.equal(v.body.notice, NOTICE);
      assert.deepEqual(
        [v.body.entry?.state, v.body.entry?.noteKept, v.body.entry?.note],
        ['rejected', false, undefined]
      );
      const a = await S.post('a11y-reject', { id: f.ids.a11y, note: NOTE });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.deepEqual([a.body.notice, a.body.entry?.noteKept], [NOTICE, false]);
      // No note: nothing to say.
      const n = await S.post('reject', { id: f.ids.a11y });
      assert.deepEqual(
        [n.status, n.body.notice, n.body.entry?.noteKept],
        [200, undefined, undefined]
      );
      assert.ok(S.log().includes(NOTICE), S.log());
      const open = JSON.parse(readFileSync(join(f.px, 'reports', 'rejections.json'), 'utf8'));
      assert.deepEqual([open.visual[f.ids.changed].note, open.a11y[f.ids.a11y].note], [null, null]);
      for (const n of ['rejections.json', 'rejections.ndjson', 'review.json', 'a11y-review.json'])
        assert.ok(!readFileSync(join(f.px, 'reports', n), 'utf8').includes(NOTE), n);
    } finally {
      await S.stop();
    }
  }
);

test('git is asked only for a reject with a note, never blocking', { skip: server }, async () => {
  const f = fixture();
  rmSync(join(f.repo, '.git'), { recursive: true });
  cp.spawnSync('git', ['init', '-q', f.repo]);
  const app = createPxsigServer({
    ws: findWorkspace({ cwd: f.repo }),
    flags: {},
    port: 0,
    open: false,
  });
  const real = cp.spawnSync;
  const realExec = cp.execFile;
  /** @type {string[][]} */
  const sync = [];
  /** @type {string[][]} */
  const async = [];
  try {
    await app.start();
    const { srv } = app;
    const S = [...srv.states.values()][0];
    await S.integrityDone;
    forgetIgnored();
    cp.spawnSync = /** @type {typeof cp.spawnSync} */ (
      (/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {object} */ o) =>
        (sync.push([cmd, ...(args ?? [])]), real(cmd, args, o))
    );
    cp.execFile = /** @type {typeof cp.execFile} */ (
      /** @type {unknown} */ (
        (/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {any[]} */ ...rest) =>
          (async.push([cmd, ...(args ?? [])]), realExec(cmd, args, ...rest))
      )
    );
    syncBuiltinESMExports();
    /** @param {string[][]} calls */
    const asked = (calls) => calls.filter((a) => a.includes('check-ignore')).length;
    await review(srv, S, 'reject', f.ids.changed, { via: 'cli' });
    await a11yReview(srv, S, 'a11y-reject', f.ids.a11y, { via: 'cli', note: ' \n ' });
    assert.deepEqual([asked(sync), asked(async)], [0, 0], 'no git check-ignore without a note');
    const entry = await review(srv, S, 'reject', f.ids.changed, { via: 'cli', note: NOTE });
    assert.deepEqual([asked(sync), asked(async)], [0, 1], 'once, without blocking');
    assert.equal(entry?.noteKept, false);
  } finally {
    cp.execFile = realExec;
    cp.spawnSync = real;
    syncBuiltinESMExports();
    await app.stop();
  }
});
