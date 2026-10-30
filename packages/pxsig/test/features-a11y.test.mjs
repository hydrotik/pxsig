// Accepting a11y violations through the server: the accepted list, undo, and the log. Temp folders
// only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { readToken } from '../src/lib/guard.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { src } from './features-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { AddressInfo } from 'node:net' */

test(
  'the server: accepting a11y violations updates the accepted list; undo restores it; both are logged',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const id = f.ids.a11y;
    const checkPath = join(f.px, 'reports', 'check.json');
    const check = JSON.parse(readFileSync(checkPath, 'utf8'));
    const row = check.rows.find((/** @type {{ id: string }} */ r) => r.id === id);
    row.a11y = {
      violations: [
        { id: 'color-contrast', impact: 'serious', help: 'x', nodes: 1, targets: [] },
        { id: 'aria-hidden-focus', impact: 'serious', help: 'y', nodes: 1, targets: [] },
      ],
      new: 1,
      baseline: ['aria-hidden-focus'],
    };
    writeFileSync(checkPath, JSON.stringify(check));
    const a11yPath = join(f.px, 'a11y.json');
    writeFileSync(a11yPath, JSON.stringify({ [id]: ['aria-hidden-focus'] }));
    const port = await new Promise((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        // Listening on TCP: the address is an AddressInfo.
        const p = /** @type {AddressInfo} */ (s.address()).port;
        s.close(() => ok(p));
      });
    });
    const proc = spawn(
      process.execPath,
      [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
      { cwd: f.repo, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
    );
    try {
      await /** @type {Promise<void>} */ (
        new Promise((ok, fail) => {
          let log = '';
          const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
          proc.stdout.on(
            'data',
            (d) => ((log += d), /dashboard →/.test(log) && (clearTimeout(t), ok()))
          );
          proc.stderr.on('data', (d) => (log += d));
        })
      );
      /** @param {string} action */
      const post = async (action) => {
        const r = await fetch(`http://127.0.0.1:${port}/__pxsig/${action}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // The server wrote its token when it started.
            'x-pxsig-token': /** @type {string} */ (readToken(f.repo, `http://127.0.0.1:${port}`)),
          },
          body: JSON.stringify({ id }),
        });
        return { status: r.status, body: await r.json() };
      };
      const accepted = await post('a11y-accept');
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.deepEqual(JSON.parse(readFileSync(a11yPath, 'utf8'))[id], [
        'aria-hidden-focus',
        'color-contrast',
      ]);
      assert.equal(
        JSON.parse(readFileSync(join(f.px, 'reports', 'a11y-review.json'), 'utf8'))[id].state,
        'accepted'
      );
      assert.equal((await post('a11y-unreview')).status, 200);
      assert.deepEqual(
        JSON.parse(readFileSync(a11yPath, 'utf8'))[id],
        ['aria-hidden-focus'],
        'undo restored the accepted list'
      );
      const log = readFileSync(join(f.px, 'a11y-decisions.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.deepEqual(
        log.map((l) => l.action),
        ['accept', 'undo']
      );
      assert.equal((await post('a11y-reject')).status, 200);
      assert.deepEqual(
        JSON.parse(readFileSync(a11yPath, 'utf8'))[id],
        ['aria-hidden-focus'],
        'reject leaves the accepted list alone'
      );
      // Unaccept takes a rule off the list, and the report shows it as new straight away.
      const r = await fetch(`http://127.0.0.1:${port}/__pxsig/a11y-unaccept`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The server wrote its token when it started.
          'x-pxsig-token': /** @type {string} */ (readToken(f.repo, `http://127.0.0.1:${port}`)),
        },
        body: JSON.stringify({ id, rule: 'aria-hidden-focus' }),
      });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(readFileSync(a11yPath, 'utf8'))[id], []);
      const row2 = JSON.parse(readFileSync(checkPath, 'utf8')).rows.find(
        (/** @type {{ id: string }} */ x) => x.id === id
      );
      assert.equal(row2.a11y.new, 2);
      const again = await fetch(`http://127.0.0.1:${port}/__pxsig/a11y-unaccept`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The server wrote its token when it started.
          'x-pxsig-token': /** @type {string} */ (readToken(f.repo, `http://127.0.0.1:${port}`)),
        },
        body: JSON.stringify({ id, rule: 'aria-hidden-focus' }),
      });
      assert.equal(again.status, 409, 'a rule that is not on the list is refused');
      assert.equal(
        readFileSync(join(f.px, 'a11y-decisions.ndjson'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l).action)
          .at(-1),
        'unaccept'
      );
    } finally {
      proc.kill();
    }
  }
);
