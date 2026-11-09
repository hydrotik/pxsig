/**
 * server-rejection-packet.test.mjs — the rejection packet through `pxsig serve` and a full check:
 * a reject writes the packet after its answer (a `rejection` event with the record), the server
 * serves its files to its own origin only, an undo removes it, a store whose reports/ git would
 * pick up gets none (and `/__pxsig/data` says why), and a full check refreshes it.
 *
 *   node --test packages/pxsig/test/server-rejection-packet.test.mjs
 *
 * Needs the Rust binary; the not-ignored case needs git; the full check needs Chromium.
 */
import assert from 'node:assert/strict';
import cp, { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRejection, readRejections } from '../src/lib/rejections.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { BROKEN, fixture, hasRust, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const rust = skipUnless(hasRust, 'Rust binary not built');
const hasGit = cp.spawnSync('git', ['--version']).status === 0;
const gitAndRust = skipUnless(hasRust && hasGit, 'Rust binary or git missing');

/** @param {ReturnType<typeof fixture>} f */
const openOf = (f) => readRejections({ store: { reports: join(f.px, 'reports') } });

/**
 * Wait until `ok()` holds (the packet is written after the answer).
 * @param {() => boolean} ok
 * @param {string} what
 */
async function until(ok, what) {
  for (let i = 0; i < 100; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out: ${what}`);
}

test(
  'a reject writes its packet; served to the dashboard only; undo removes it',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const id = f.ids.changed;
    writeFileSync(f.latest(id), BROKEN);
    const S = await serve(f);
    try {
      const events = await fetch(`${S.base}/__pxsig/events`);
      const r = await S.post('reject', { id, note: 'the square is new' });
      assert.equal(r.status, 200);
      const dir = join(f.px, 'reports', 'rejected', id);
      await until(() => existsSync(join(dir, 'rejection.md')), 'the packet');
      await until(() => openOf(f).visual[id]?.packet != null, 'the record');
      assert.equal(openOf(f).visual[id].packet, `reports/rejected/${id}/`);
      // The event that says the packet is there.
      const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (
        events.body?.getReader()
      );
      let seen = '';
      while (!/"packet":"reports\/rejected\//.test(seen))
        seen += new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();

      const file = `${S.base}/p/fixture/reports/rejected/${id}/rejection.md`;
      const own = await fetch(file);
      assert.equal(own.status, 200);
      assert.match(await own.text(), /the square is new/);
      assert.equal(own.headers.get('access-control-allow-origin'), null);
      const crop = await fetch(`${S.base}/p/fixture/reports/rejected/${id}/crops/1.diff.png`);
      assert.equal(crop.headers.get('content-type'), 'image/png');
      /** @type {Record<string, string>[]} */
      const others = [
        { 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'same-site' },
        { origin: 'http://localhost:1' },
      ];
      for (const headers of others) {
        const other = await fetch(file, { headers });
        assert.equal(other.status, 403, JSON.stringify(headers));
        assert.ok(!(await other.text()).includes('square'));
      }
      assert.equal((await fetch(`${S.base}/p/fixture/reports/rejected/../check.json`)).status, 404);
      assert.equal((await fetch(`${S.base}/p/fixture/reports/review.json`)).status, 404);

      // /data: the record says where the packet is.
      const data = /** @type {Record<string, any>} */ (
        await (await fetch(`${S.base}/__pxsig/data?project=fixture`)).json()
      );
      assert.equal(data.rejections.visual[id].packet, `reports/rejected/${id}/`);

      assert.equal((await S.post('unreview', { id })).status, 200);
      assert.ok(!existsSync(dir), 'closed: the packet goes');
      assert.ok(!S.log().includes(f.repo), 'no absolute path in the server log');
    } finally {
      await S.stop();
    }
  }
);

test(
  'a store whose reports/ is not git-ignored gets no packet; /data says why',
  { skip: gitAndRust },
  async (t) => {
    const f = fixture({ t });
    rmSync(join(f.repo, '.git'), { recursive: true, force: true });
    cp.spawnSync('git', ['init', '-q', f.repo]);
    const id = f.ids.changed;
    writeFileSync(f.latest(id), BROKEN);
    const S = await serve(f);
    try {
      assert.equal((await S.post('reject', { id })).status, 200);
      await until(() => openOf(f).visual[id]?.packetError != null, 'the record');
      const data = /** @type {Record<string, any>} */ (
        await (await fetch(`${S.base}/__pxsig/data?project=fixture`)).json()
      );
      assert.equal(data.rejections.visual[id].packet, null);
      assert.equal(
        data.rejections.visual[id].packetError,
        'not written: the store’s reports/ is not git-ignored'
      );
      assert.ok(!existsSync(join(f.px, 'reports', 'rejected')));
    } finally {
      await S.stop();
    }
  }
);

test('a full check refreshes the packet of a rejection still open', { skip: needs }, async (t) => {
  const f = fixture({ t });
  const sb = await fakeStorybook(f.index.stories);
  t.after(() => sb.close());
  const cfgPath = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: sb.url } }, null, 2));
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  const id = f.ids.drift;
  openRejection(P, 'visual', id, { via: 'dashboard', note: 'icon moved' });
  const code = await new Promise((ok) => {
    const p = spawn(
      process.execPath,
      [join(src, 'check.mjs'), '--only', id, '--retries', '0', '--no-a11y'],
      { cwd: f.repo, env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' }, stdio: 'ignore' }
    );
    p.on('close', ok);
  });
  assert.equal(code, 1, 'the render differs');
  const open = readRejections(P).visual[id];
  assert.equal(open.packet, `reports/rejected/${id}/`);
  const facts = JSON.parse(
    readFileSync(join(f.px, 'reports', 'rejected', id, 'rejection.json'), 'utf8')
  );
  assert.deepEqual([facts.note, facts.checks.length], ['icon moved', 1]);
  assert.ok(facts.metrics.changedPx > 0);
});
