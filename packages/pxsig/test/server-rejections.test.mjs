/**
 * server-rejections.test.mjs — a rejection's reason through `pxsig serve`, on a fixture project in
 * a temp dir: the note on reject and a11y-reject, the open rejection that outlives a re-check until
 * the entry passes, the closes a decision makes (approve, accept, undo, dismiss), an assistant's
 * note and the rejections it may not clear, `/__pxsig/data` with the reasons, `/__pxsig/status`
 * and the static report without them, and a full check.
 *
 *   node --test packages/pxsig/test/server-rejections.test.mjs
 *
 * Needs the Rust binary; the checks also need Chromium (a stand-in Storybook serves them).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readToken } from '../src/lib/guard.mjs';
import { openRejection, readRejections } from '../src/lib/rejections.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { prebuiltDashboardDir, useDashboard, writeStaticReport } from '../src/report.mjs';
import { fixture, hasRust, rustBin, tempDir } from './fixture.mjs';
import { fakeStorybook, needs, serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @typedef {ReturnType<typeof fixture>} Fixture */

const REF = /^d_[A-Za-z0-9_-]{16}$/;
const rust = skipUnless(hasRust, 'Rust binary not built');

/**
 * @param {Fixture} f
 * @param {string} name
 * @returns {Record<string, any>}
 */
const report = (f, name) => {
  const file = join(f.px, 'reports', `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

/**
 * @param {Fixture} f
 * @param {string} name
 * @returns {Record<string, any>[]}
 */
const lines = (f, name) => {
  const file = join(f.px, name);
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];
};

/** @param {Fixture} f */
const projectOf = (f) =>
  openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });

/**
 * The fix, in the fixture: the entry's baseline becomes its latest render (the engine's capture and
 * pack, as a component change that renders like the baseline would).
 * @param {Fixture} f
 * @param {string} id
 */
const renderMatchesBaseline = (f, id) => {
  const json = join(f.repo, '.tmp', `${id}.fix.pxsig.json`);
  let r = spawnSync(rustBin, ['capture', f.latest(id), '--out', json, '--grid', '16'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const args = ['pack', json, '--out', f.sig(id), '--entry', JSON.stringify({ id })];
  r = spawnSync(rustBin, [...args, '--image', f.latest(id)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

test(
  'reject with a reason → a re-check keeps it open → the fix passes → closed, the reason in the log',
  { skip: needs },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const id = f.ids.changed;
    const S = await serve(f, { storybook: sb.url });
    try {
      const recheck = async () => {
        assert.equal((await S.post('check', { ids: [id] })).status, 202);
        await S.idle();
      };
      await recheck();
      const r = await S.post('reject', { id, note: '  the block\nis too dark  ' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const entry = /** @type {{ entry: Record<string, string> }} */ (
        /** @type {unknown} */ (r.body)
      ).entry;
      assert.equal(entry.note, 'the block is too dark');
      assert.match(entry.ref, REF);
      assert.deepEqual(report(f, 'review')[id], entry);
      // The packet is written after the answer: wait for the record to settle before comparing.
      for (let i = 0; i < 200; i++) {
        const o = report(f, 'rejections').visual[id];
        if (o?.packet != null || o?.packetError != null) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const open = report(f, 'rejections').visual[id];
      assert.equal(open.note, 'the block is too dark');
      assert.equal(open.via, 'cli');
      assert.equal(open.ref, entry.ref);

      // /data carries the open rejections with their reasons; /status none of the reasons.
      const data = /** @type {Record<string, any>} */ (
        await (await fetch(`${S.base}/__pxsig/data?project=fixture`)).json()
      );
      assert.deepEqual(data.rejections.visual[id], open);
      assert.equal(data.review[id].note, 'the block is too dark');
      const status = await (await fetch(`${S.base}/__pxsig/status`)).text();
      assert.ok(!status.includes('too dark'), 'no reason in /status');
      assert.equal(JSON.parse(status).review[id].state, 'rejected');

      // A re-check clears the decision; the rejection stays open with the check.
      await recheck();
      assert.equal(report(f, 'review')[id], undefined);
      const still = report(f, 'rejections').visual[id];
      assert.equal(still.note, 'the block is too dark');
      assert.deepEqual(
        still.checks.map((/** @type {{ pass: boolean }} */ c) => c.pass),
        [false]
      );

      // The fix: the next check passes and closes it.
      renderMatchesBaseline(f, id);
      await recheck();
      assert.equal(
        report(f, 'check').rows.find((/** @type {{ id: string }} */ x) => x.id === id).pass,
        true
      );
      assert.deepEqual(report(f, 'rejections').visual, {});
      const log = lines(f, 'reports/rejections.ndjson');
      assert.deepEqual(
        log.map((e) => [e.event, e.as ?? null]),
        [
          ['rejected', null],
          ['checked', null],
          ['closed', 'passed'],
        ]
      );
      assert.equal(log[0].note, 'the block is too dark', 'the reason stays in the log');
      assert.ok(!existsSync(join(f.px, 'approvals.ndjson')), 'nothing was approved');
    } finally {
      await S.stop();
    }
  }
);

test(
  "an assistant's note is its own; it may not clear a person's rejection; dismiss is a person's",
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const S = await serve(f);
    try {
      const token = /** @type {string} */ (readToken(f.repo, S.base, 'mcp'));
      /**
       * @param {string} action
       * @param {unknown} body
       */
      const mcp = async (action, body) => {
        const r = await fetch(`${S.base}/__pxsig/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-pxsig-token': token },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: /** @type {Record<string, string>} */ (await r.json()) };
      };
      const own = f.ids.ok;
      assert.equal((await mcp('reject', { id: own, note: 'looks off' })).status, 200);
      assert.deepEqual(
        [report(f, 'review')[own].via, report(f, 'review')[own].note],
        ['mcp', 'looks off']
      );
      assert.equal(report(f, 'rejections').visual[own].notes[0].via, 'mcp', 'labelled mcp');

      const id = f.ids.changed;
      assert.equal((await S.post('reject', { id, note: 'too tight' })).status, 200);
      assert.equal((await mcp('reject', { id, note: 'checked: still tight' })).status, 200);
      const rv = report(f, 'review')[id];
      assert.deepEqual([rv.via, rv.note], ['cli', 'too tight'], "the person's decision stands");
      assert.deepEqual(
        report(f, 'rejections').visual[id].notes.map((/** @type {{ via: string }} */ n) => n.via),
        ['mcp', 'cli']
      );
      const refused = await mcp('unreview', { id });
      assert.equal(refused.status, 403);
      assert.match(refused.body.error, /^clearing a person's rejection needs a person/);
      assert.equal(report(f, 'review')[id].state, 'rejected');
      assert.equal((await mcp('rejection-dismiss', { id, kind: 'visual' })).status, 403);

      // Its own rejection it may clear: the open one closes as undone.
      assert.equal((await mcp('unreview', { id: own })).status, 200);
      assert.equal(report(f, 'rejections').visual[own], undefined);

      // Dismiss: not while the decision stands; after a re-check (the decision cleared), a person's.
      const dismiss = (/** @type {unknown} */ body) => S.post('rejection-dismiss', body);
      assert.equal((await dismiss({ id, kind: 'visual' })).status, 409);
      assert.equal((await dismiss({ id, kind: 'pixels' })).status, 400);
      assert.equal((await dismiss({ id: '../x', kind: 'visual' })).status, 400);
      const rvPath = join(f.px, 'reports', 'review.json');
      writeFileSync(rvPath, JSON.stringify({ ...report(f, 'review'), [id]: undefined }));
      assert.equal((await mcp('unreview', { id })).status, 403, "the open rejection is a person's");
      assert.ok(report(f, 'rejections').visual[id]);
      const ok = await dismiss({ id, kind: 'visual' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(report(f, 'rejections').visual[id], undefined);
      assert.equal((await dismiss({ id, kind: 'visual' })).status, 404);
      const closes = lines(f, 'reports/rejections.ndjson').filter((e) => e.event === 'closed');
      assert.deepEqual(
        closes.map((e) => [e.id, e.as, e.via]),
        [
          [own, 'undone', 'mcp'],
          [id, 'dismissed', 'cli'],
        ]
      );
      for (const e of closes) assert.match(e.ref, REF);
    } finally {
      await S.stop();
    }
  }
);

test(
  'approve, accept and undo close the open rejection; the logs keep the decision reference',
  { skip: rust },
  async (t) => {
    const f = fixture({ t });
    const S = await serve(f);
    try {
      const v = f.ids.drift;
      assert.equal((await S.post('reject', { id: v, note: 'keep the old icon' })).status, 200);
      const approved = await S.post('approve', { id: v });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(report(f, 'rejections').visual[v], undefined);
      const line = /** @type {Record<string, string>} */ (lines(f, 'approvals.ndjson').at(-1));
      assert.match(line.ref, REF);
      assert.equal(report(f, 'review')[v].ref, line.ref);
      assert.ok(!JSON.stringify(lines(f, 'approvals.ndjson')).includes('old icon'), 'no reason');

      const a = f.ids.a11y;
      assert.equal((await S.post('a11y-reject', { id: a, note: 'text too faint' })).status, 200);
      assert.equal(report(f, 'a11y-review')[a].note, 'text too faint');
      assert.equal(report(f, 'rejections').a11y[a].note, 'text too faint');
      assert.equal((await S.post('a11y-accept', { id: a })).status, 200);
      assert.equal(report(f, 'rejections').a11y[a], undefined);
      const accept = /** @type {Record<string, string>} */ (
        lines(f, 'a11y-decisions.ndjson').at(-1)
      );
      assert.equal(accept.action, 'accept');
      assert.match(accept.ref, REF);
      assert.equal(report(f, 'a11y-review')[a].ref, accept.ref);

      const u = f.ids.changed;
      assert.equal((await S.post('reject', { id: u })).status, 200);
      assert.equal(report(f, 'rejections').visual[u].note, null, 'no reason given');
      assert.equal((await S.post('unreview', { id: u })).status, 200);
      assert.equal(report(f, 'rejections').visual[u], undefined);
      assert.deepEqual(
        lines(f, 'reports/rejections.ndjson')
          .filter((e) => e.event === 'closed')
          .map((e) => [e.id, e.as]),
        [
          [v, 'approved'],
          [a, 'accepted'],
          [u, 'undone'],
        ]
      );
      const committed = [...lines(f, 'approvals.ndjson'), ...lines(f, 'a11y-decisions.ndjson')].map(
        (l) => JSON.stringify(l)
      );
      for (const l of committed) assert.ok(!/old icon|too faint/.test(l), l);
    } finally {
      await S.stop();
    }
  }
);

test('a static report carries no reasons and no open rejections', { skip: rust }, (t) => {
  const f = fixture({ t });
  const id = f.ids.changed;
  const P = projectOf(f);
  writeFileSync(
    join(f.px, 'reports', 'review.json'),
    JSON.stringify({ [id]: { state: 'rejected', at: 't', via: 'dashboard', note: 'secret why' } })
  );
  writeFileSync(
    join(f.px, 'reports', 'a11y-review.json'),
    JSON.stringify({ [id]: { state: 'rejected', at: 't', via: 'dashboard', note: 'secret a11y' } })
  );
  openRejection(P, 'visual', id, { via: 'dashboard', note: 'secret why' });
  const dash = tempDir('dash', t);
  mkdirSync(join(dash, 'assets'));
  writeFileSync(
    join(dash, 'index.html'),
    '<!doctype html><html><body><!--pxsig:data--></body></html>'
  );
  useDashboard(dash);
  t.after(() => useDashboard(prebuiltDashboardDir));
  const out = tempDir('site', t);
  const { data } = writeStaticReport(P, out);
  assert.ok(!('rejections' in data));
  assert.deepEqual(data.review, { [id]: { state: 'rejected', at: 't', via: 'dashboard' } });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.ok(!html.includes('secret'), 'no reason in the page');
  assert.ok(readRejections(P).visual[id], 'the live session keeps it');
});

test(
  'a full check: the decisions go, an open rejection gains the check, a removed entry closes',
  { skip: needs },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: sb.url } }, null, 2));
    const P = projectOf(f);
    const id = f.ids.drift;
    writeFileSync(
      join(f.px, 'reports', 'review.json'),
      JSON.stringify({ [id]: { state: 'rejected', at: 't', via: 'dashboard', note: 'icon' } })
    );
    openRejection(P, 'visual', id, { via: 'dashboard', note: 'icon' });
    openRejection(P, 'visual', 'components-omega--gone', { via: 'dashboard', note: 'old' });
    const code = await new Promise((ok) => {
      const p = spawn(
        process.execPath,
        [join(src, 'check.mjs'), '--only', id, '--retries', '0', '--no-a11y'],
        { cwd: f.repo, env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' }, stdio: 'ignore' }
      );
      p.on('close', ok);
    });
    assert.equal(code, 1, 'the render differs');
    assert.ok(!existsSync(join(f.px, 'reports', 'review.json')));
    const open = readRejections(P).visual;
    assert.deepEqual(Object.keys(open), [id]);
    assert.equal(open[id].note, 'icon');
    assert.deepEqual(
      open[id].checks.map((c) => c.pass),
      [false]
    );
  }
);
