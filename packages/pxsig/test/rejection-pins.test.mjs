/**
 * rejection-pins.test.mjs — what a rejection records and who may clear it, pinned before the
 * reason and the open rejections are added (design: the rejection packet, PR 2): the decision
 * `POST /__pxsig/reject` writes, that no rejection reaches `approvals.ndjson`, that a re-check and
 * a full check clear the decisions, the MCP token's limits, `pxsig_entry` and `pxsig_list
 * rejected`, and the `review` of `/__pxsig/status`. A decision reference (`ref`, opaque) is the one
 * key a decision may gain.
 *
 *   node --test packages/pxsig/test/rejection-pins.test.mjs
 *
 * Needs the Rust binary; the checks also need Chromium (a stand-in Storybook serves them).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { verify } from '../src/lib/approvals.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { tools } from '../src/tools/index.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @typedef {ReturnType<typeof fixture>} Fixture */
/** @typedef {{ state: string, at: string, via?: string, ref?: string }} Decision */

const REF = /^d_[A-Za-z0-9_-]{16}$/;

/**
 * A decision's keys as today, `ref` aside (the one key a decision may gain).
 * @param {Decision | undefined} d
 */
const today = (d) => {
  assert.ok(d, 'a decision');
  const { ref, ...rest } = d;
  assert.ok(ref === undefined || REF.test(ref), `an opaque reference: ${ref}`);
  return Object.keys(rest).sort();
};

/**
 * @param {Fixture} f
 * @param {string} name
 */
const reportJson = (f, name) => {
  const file = join(f.px, 'reports', `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

/** @param {Fixture} f */
const approvalsLog = (f) => {
  const file = join(f.px, 'approvals.ndjson');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

/** @param {Fixture} f */
const verified = (f) => {
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  const { stories } = JSON.parse(readFileSync(join(f.px, 'manifest.json'), 'utf8'));
  return verify(P, { stories });
};

/**
 * Point the fixture's storybook.url at `url`.
 * @param {Fixture} f
 * @param {string} url
 */
const useStorybook = (f, url) => {
  const cfgPath = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url } }, null, 2));
};

test(
  'a rejection: { state, at, via }, nothing in approvals.ndjson, verify unchanged; /status and a re-check',
  { skip: needs },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const id = f.ids.changed;
    const S = await serve(f, { storybook: sb.url });
    try {
      const log = approvalsLog(f);
      const before = verified(f);
      const r = await S.post('reject', { id });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const rv = reportJson(f, 'review')[id];
      assert.deepEqual(today(rv), ['at', 'state', 'via']);
      assert.equal(rv.state, 'rejected');
      assert.equal(rv.via, 'cli');
      assert.ok(!Number.isNaN(Date.parse(rv.at)));
      const a = await S.post('a11y-reject', { id });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      const av = reportJson(f, 'a11y-review')[id];
      assert.deepEqual(today(av), ['at', 'state', 'via']);
      assert.equal(av.state, 'rejected');
      assert.equal(approvalsLog(f), log, 'no line goes to approvals.ndjson');
      assert.deepEqual(verified(f), before, '`approve verify` answers the same');

      // /__pxsig/status: `review` carries today's keys.
      const status = /** @type {{ review: Record<string, Decision> }} */ (
        await (await fetch(`${S.base}/__pxsig/status`)).json()
      );
      assert.deepEqual(today(status.review[id]), ['at', 'state', 'via']);

      // A re-check of the entry clears both of its decisions.
      const q = await S.post('check', { ids: [id] });
      assert.equal(q.status, 202, JSON.stringify(q.body));
      await S.idle();
      assert.equal(reportJson(f, 'review')[id], undefined);
      assert.equal(reportJson(f, 'a11y-review')[id], undefined);
    } finally {
      await S.stop();
    }
  }
);

test(
  'the MCP token: reject and unreview of its own rejection pass, approve is 403',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async (t) => {
    const f = fixture({ t });
    const id = f.ids.changed;
    const S = await serve(f);
    try {
      const token = /** @type {string} */ (readToken(f.repo, S.base, 'mcp'));
      /**
       * @param {string} action
       * @param {unknown} body
       */
      const mcp = (action, body) =>
        fetch(`${S.base}/__pxsig/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-pxsig-token': token },
          body: JSON.stringify(body),
        });
      assert.equal((await mcp('reject', { id })).status, 200);
      const rv = reportJson(f, 'review')[id];
      assert.deepEqual([rv.state, rv.via], ['rejected', 'mcp']);
      assert.equal((await mcp('unreview', { id })).status, 200);
      assert.equal(reportJson(f, 'review')[id], undefined);
      assert.equal((await mcp('a11y-reject', { id })).status, 200);
      assert.equal((await mcp('a11y-unreview', { id })).status, 200);
      assert.equal(reportJson(f, 'a11y-review')[id], undefined);
      assert.equal((await mcp('approve', { id })).status, 403);
      assert.equal(approvalsLog(f), null, 'nothing was approved');
    } finally {
      await S.stop();
    }
  }
);

test('a full check removes review.json and a11y-review.json', { skip: needs }, async (t) => {
  const f = fixture({ t });
  const sb = await fakeStorybook(f.index.stories);
  t.after(() => sb.close());
  useStorybook(f, sb.url);
  const at = new Date().toISOString();
  const decision = JSON.stringify({ [f.ids.changed]: { state: 'rejected', at, via: 'cli' } });
  writeFileSync(join(f.px, 'reports', 'review.json'), decision);
  writeFileSync(join(f.px, 'reports', 'a11y-review.json'), decision);
  const code = await new Promise((ok) => {
    const p = spawn(
      process.execPath,
      [join(src, 'check.mjs'), '--only', f.ids.ok, '--retries', '0', '--no-a11y'],
      { cwd: f.repo, env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' }, stdio: 'ignore' }
    );
    p.on('close', ok);
  });
  assert.ok(code === 0 || code === 1, `the check ran (exit ${code})`);
  assert.ok(!existsSync(join(f.px, 'reports', 'review.json')));
  assert.ok(!existsSync(join(f.px, 'reports', 'a11y-review.json')));
});

test(
  'pxsig_entry with no images: the JSON and baseline, current, diff; pxsig_list rejected',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async (t) => {
    const f = fixture({ t });
    const id = f.ids.changed;
    const decision = { state: 'rejected', at: new Date().toISOString(), via: 'dashboard' };
    writeFileSync(join(f.px, 'reports', 'review.json'), JSON.stringify({ [id]: decision }));
    const was = process.env.PXSIG_WORKSPACE;
    process.env.PXSIG_WORKSPACE = f.repo;
    t.after(() => {
      if (was === undefined) delete process.env.PXSIG_WORKSPACE;
      else process.env.PXSIG_WORKSPACE = was;
    });
    /** @param {string} name */
    const tool = (name) =>
      /** @type {{ run: (a: Record<string, unknown>) => Promise<any> }} */ (
        tools.find((x) => x.name === name)
      );
    const r = await tool('pxsig_entry').run({ id });
    /** @type {{ type: string, text?: string }[]} */
    const content = r.content;
    const json = JSON.parse(/** @type {string} */ (content[0].text));
    assert.equal(json.id, id);
    assert.deepEqual(json.review, decision, 'the decision passes through whole');
    const labels = content
      .slice(1)
      .filter((c) => c.type === 'text')
      .map((c) => /** @type {string} */ (c.text).split(/[ :(]/)[0]);
    assert.deepEqual(labels, ['baseline', 'current', 'diff']);
    assert.equal(
      content.filter((c) => c.type === 'image').length,
      2,
      'no diff image in the fixture'
    );
    const list = await tool('pxsig_list').run({ state: 'rejected' });
    assert.deepEqual(
      list.entries.map((/** @type {{ id: string }} */ e) => e.id),
      [id]
    );
  }
);
