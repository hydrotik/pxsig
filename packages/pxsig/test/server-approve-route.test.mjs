/**
 * server-approve-route.test.mjs — the server's approve (src/serve/review.mjs) on a fixture in a
 * temp git repository, called in process: the log line's `gitHead` is the repository's short HEAD,
 * read without `spawnSync` (the event loop is not held by git), and the entry's a11y baseline and
 * check row follow the approval as before.
 *
 *   node --test packages/pxsig/test/server-approve-route.test.mjs
 *
 * Needs the Rust binary (the engine writes the baseline); skipped without it.
 */
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { forgetIgnored } from '../src/lib/decisions.mjs';
import { findWorkspace } from '../src/lib/workspace.mjs';
import { createPxsigServer } from '../src/serve/create.mjs';
import { review } from '../src/serve/review.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

/** @import { CheckReport } from '../src/types/t5.js' */

test(
  'approve logs the short HEAD without spawnSync; the a11y baseline and the check row follow',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    rmSync(join(f.repo, '.git'), { recursive: true });
    /** @param {string[]} args */
    const git = (args) =>
      cp
        .execFileSync(
          'git',
          [
            '-C',
            f.repo,
            '-c',
            'user.name=pxsig-test',
            '-c',
            'user.email=test@example.invalid',
            ...args,
          ],
          { encoding: 'utf8' }
        )
        .trim();
    git(['init', '-q']);
    git(['commit', '-q', '--allow-empty', '-m', 'fixture']);
    const head = git(['rev-parse', '--short', 'HEAD']);
    assert.match(head, /^[0-9a-f]{7,}$/);

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
      // Every spawnSync from here on, through lib/spawn.mjs's `cp` namespace.
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

      const id = f.ids.a11y;
      const entry = await review(srv, S, 'approve', id, { via: 'cli' });
      assert.equal(entry?.state, 'approved');
      assert.deepEqual(
        sync.filter((a) => a.includes('rev-parse')),
        [],
        'git rev-parse ran without spawnSync'
      );
      /** @param {string[][]} calls */
      const ignoreAsked = (calls) => calls.filter((a) => a.includes('check-ignore')).length;
      assert.deepEqual(
        [ignoreAsked(sync), ignoreAsked(async)],
        [0, 0],
        'no git check-ignore for an approve without a reason'
      );

      const lines = readFileSync(join(f.px, 'approvals.ndjson'), 'utf8').trim().split('\n');
      const line = JSON.parse(/** @type {string} */ (lines.at(-1)));
      assert.equal(line.id, id);
      assert.equal(line.gitHead, head);
      assert.equal(line.batch, entry?.batch);

      const a11y = JSON.parse(readFileSync(join(f.px, 'a11y.json'), 'utf8'));
      assert.deepEqual(a11y[id], ['color-contrast']);
      assert.equal(entry?.a11yBefore, null);
      const check = /** @type {CheckReport} */ (
        JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'))
      );
      assert.equal(check.rows.find((r) => r.id === id)?.approved?.batch, entry?.batch);
      // With a reason: git is asked once, without blocking (the store's reports/ is not ignored
      // here, so the reason is not kept either).
      forgetIgnored();
      await review(srv, S, 'approve', f.ids.changed, { via: 'cli', reason: 'the new border' });
      assert.deepEqual([ignoreAsked(sync), ignoreAsked(async)], [0, 1]);
      assert.ok(!existsSync(join(f.px, 'reports', 'decisions.ndjson')));
      assert.ok(!readFileSync(join(f.px, 'approvals.ndjson'), 'utf8').includes('the new border'));
    } finally {
      cp.execFile = realExec;
      cp.spawnSync = real;
      syncBuiltinESMExports();
      await app.stop();
    }
  }
);
