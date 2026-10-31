/**
 * server-flow.test.mjs — the server's check, repair and approval flow against a stand-in Storybook
 * (an index.json and an iframe.html with a minimal preview object), on fixture projects in temp dirs.
 *
 *   node --test packages/pxsig/test/server-flow.test.mjs
 *
 * Covers: checking a story that is not registered yet (registered, then rendered in the same
 * request; never a signature), a story checked alone whose render throws (recorded, not dropped as
 * a setup error), a repair whose re-check could not run (reported as such), and approving a
 * story's entries together (refused unless `approvals.byStory`; then one batch, reflected in
 * check.json). Needs the Rust binary and
 * Chromium; skipped without them.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKER, fixture, hasRust, rustBin } from './fixture.mjs';
import { src, needs, fakeStorybook, serve, rowsOf } from './server-helpers.mjs';
import { BY_STORY_OFF } from '../src/lib/approvals/story.mjs';
import { skipOn, skipUnless } from './strict.mjs';

test(
  'checking a story that is not registered registers it and renders it in the same request; no signature is written',
  { skip: needs },
  async () => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    try {
      const r = await S.post('check', {
        stories: [f.ids.unregistered, 'components-nope--missing'],
      });
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.deepEqual(r.body.registered, [f.ids.unregistered]);
      assert.deepEqual(r.body.queued, [f.ids.unregistered]);
      assert.deepEqual(
        r.body.skipped.map((x) => x.name),
        ['components-nope--missing']
      );
      assert.match(r.body.skipped[0].why, /not in the manifest or the Storybook story index/);
      await S.idle();
      const manifest = JSON.parse(readFileSync(join(f.px, 'manifest.json'), 'utf8'));
      const e = manifest.stories.find(
        (/** @type {{ id: string }} */ x) => x.id === f.ids.unregistered
      );
      assert.ok(e, 'registered in the manifest');
      assert.ok(!existsSync(join(f.repo, e.sig)), 'registering never writes a signature');
      const row = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.unregistered);
      assert.ok(row, `rendered and recorded:\n${S.log()}`);
      assert.equal(row.new, true, 'NEW: waiting for a person to approve its first render');
      const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.ok(
        log.some(
          (l) => l.action === 'register' && l.id === f.ids.unregistered && l.via === 'server'
        )
      );
    } finally {
      S.stop();
      sb.close();
    }
  }
);

test(
  'a story checked alone whose render throws is recorded as a render error, not dropped as a setup error',
  { skip: needs },
  async () => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    try {
      const before = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.error);
      const r = await S.post('check', { ids: [f.ids.error] });
      assert.equal(r.status, 202);
      await S.idle();
      const row = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.error);
      assert.notEqual(row.checkedAt, before.checkedAt, `recorded:\n${S.log()}`);
      assert.match(row.error, /^storybook-error: Storybook error page: Story threw/);
      const report = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
      assert.ok(
        Date.parse(report.generatedAt) >= Date.parse(row.checkedAt) - 5000,
        'a re-check moves the report time'
      );
      assert.ok(
        report.fullCheckAt && Date.parse(report.fullCheckAt) < Date.parse(report.generatedAt),
        'and keeps when the last full check ran'
      );
    } finally {
      S.stop();
      sb.close();
    }
  }
);

test(
  'a check queued behind a running one, whose manifest stopped loading, reports why',
  { skip: needs },
  async () => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    try {
      assert.equal((await S.post('check', { ids: [f.ids.ok, f.ids.drift] })).status, 202);
      // While that check runs, the manifest becomes unreadable; the next check is queued behind it.
      const manifestPath = join(f.px, 'manifest.json');
      const good = readFileSync(manifestPath, 'utf8');
      writeFileSync(manifestPath, '{ not json');
      const r = await S.post('check', { ids: [f.ids.changed] });
      assert.deepEqual(r.body.queued, [f.ids.changed], 'queued while the first check ran');
      await S.idle();
      assert.match(
        S.log(),
        /check failed: setup error: the manifest did not load — .*Nothing was rendered/
      );
      assert.doesNotMatch(S.log(), /missing string param|Storybook is not reachable/);
      // The manifest loads again: the next check's reload clears the project's error.
      writeFileSync(manifestPath, good);
      assert.equal((await S.post('check', { ids: [f.ids.ok] })).status, 202);
      await S.idle();
      // GET /__pxsig/projects answers JSON (docs/server.md).
      const { projects } = /** @type {{ projects: { error: string | null }[] }} */ (
        await (await fetch(`${S.base}/__pxsig/projects`)).json()
      );
      assert.equal(projects[0].error, null, 'an earlier load failure no longer shows');
    } finally {
      S.stop();
      sb.close();
    }
  }
);

test(
  'engine lines that are not a JSON object are skipped, and the server keeps answering',
  {
    skip: needs || skipOn('the stand-in engine is a script'),
    timeout: 120_000,
  },
  async (t) => {
    const f = fixture();
    // The real engine, behind a script (named as the engine is) that first writes lines that are
    // not answers: `null`, a number, and text that is not JSON.
    mkdirSync(join(f.repo, 'odd-engine'));
    const bin = join(f.repo, 'odd-engine', 'pxsig');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const c = require('node:child_process').spawn(${JSON.stringify(rustBin)}, process.argv.slice(2), {
  stdio: ['inherit', 'pipe', 'inherit'],
});
if (process.argv[2] === 'serve') process.stdout.write('null\\n42\\nnot json\\n');
c.stdout.pipe(process.stdout);
c.on('exit', (code) => process.exit(code ?? 1));
`
    );
    chmodSync(bin, 0o755);
    // After hooks, each registered as soon as its resource exists: they run however the test ends,
    // even when the server stops before it is up.
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const S = await serve(f, { storybook: sb.url, bin });
    t.after(() => S.stop());
    const before = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.ok);
    assert.equal((await S.post('check', { ids: [f.ids.ok] })).status, 202);
    await S.idle();
    const row = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.ok);
    assert.notEqual(row.checkedAt, before.checkedAt, `recorded:\n${S.log()}`);
    assert.doesNotMatch(S.log(), /TypeError|SyntaxError/);
  }
);

test(
  'a repair whose re-check could not run says so, and the dashboard hears why',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const S = await serve(f); // storybook.url does not answer
    /** @type {string[]} */
    const events = [];
    const ctl = new AbortController();
    try {
      const es = await fetch(`${S.base}/__pxsig/events`, { signal: ctl.signal });
      (async () => {
        const dec = new TextDecoder();
        // A 200 event stream has a body.
        for await (const chunk of /** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (
          es.body
        ))
          events.push(dec.decode(chunk));
      })().catch(() => {});
      const r = await S.post('repair', { apply: true, only: ['recheck'] });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      // `only: ['recheck']` plans that step, so it is among the applied ones.
      const rc = /** @type {{ action: string, result: string }} */ (
        r.body.applied.find((x) => x.action === 'recheck')
      );
      assert.match(rc.result, /^not re-checked: setup error: Storybook is not reachable/);
      assert.match(events.join(''), /event: check\ndata: \{"project":"fixture","state":"error"/);
    } finally {
      ctl.abort();
      S.stop();
    }
  }
);

test(
  'approving a story is refused by default; with approvals.byStory it approves each entry waiting, in one batch',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const story = f.ids.changed;
    // A second mode of the same story, also changed; and a third that passes.
    const manifestPath = join(f.px, 'manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const base = m.stories.find((/** @type {{ id: string }} */ e) => e.id === story);
    m.stories.push(
      {
        ...base,
        id: `${story}@light`,
        mode: 'light',
        sig: base.sig.replace('.psig', '@light.psig'),
      },
      {
        ...base,
        id: `${story}__hover`,
        state: 'hover',
        sig: base.sig.replace('.psig', '__hover.psig'),
      }
    );
    writeFileSync(manifestPath, JSON.stringify(m, null, 2));
    writeFileSync(join(f.px, 'renders', 'latest', `${story}@light.png`), CHECKER);
    writeFileSync(join(f.px, 'renders', 'latest', `${story}__hover.png`), CHECKER);
    const checkPath = join(f.px, 'reports', 'check.json');
    const check = JSON.parse(readFileSync(checkPath, 'utf8'));
    const row = check.rows.find((/** @type {{ id: string }} */ r) => r.id === story);
    check.rows.push(
      { ...row, id: `${story}@light`, mode: 'light', pass: false, new: true, reasons: ['new'] },
      {
        ...row,
        id: `${story}__hover`,
        state: 'hover',
        pass: true,
        metrics: { ssim: 1 },
        reasons: [],
      }
    );
    writeFileSync(checkPath, JSON.stringify(check));
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    // Off by default: one entry, one decision.
    let S = await serve(f);
    try {
      const off = await S.post('approve-story', { story });
      assert.equal(off.status, 403, JSON.stringify(off.body));
      assert.equal(off.body.error, BY_STORY_OFF);
      assert.ok(!existsSync(join(f.px, 'approvals.ndjson')), 'nothing was approved');
    } finally {
      S.stop();
    }
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, approvals: { byStory: true } }, null, 2));
    S = await serve(f);
    try {
      const r = await S.post('approve-story', { story });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.approved.sort(), [story, `${story}@light`].sort());
      assert.deepEqual(r.body.skipped, [
        { id: `${story}__hover`, why: 'passes: nothing to approve' },
      ]);
      const review = JSON.parse(readFileSync(join(f.px, 'reports', 'review.json'), 'utf8'));
      assert.equal(review[story].batch, review[`${story}@light`].batch, 'one batch');
      assert.ok(
        existsSync(join(f.repo, base.sig.replace('.psig', '@light.psig'))),
        'the first baseline of the new mode'
      );
      const after = JSON.parse(readFileSync(checkPath, 'utf8'));
      assert.ok(
        after.rows.find((/** @type {{ id: string }} */ x) => x.id === story).approved,
        'the row says it was approved'
      );
      assert.equal(after.summary.approved, 2);
      assert.equal(
        after.summary.failed,
        check.rows.filter(
          (/** @type {{ skipped?: boolean, pass?: boolean }} */ y) => !y.skipped && !y.pass
        ).length - 2,
        'approved rows no longer count as failed'
      );
      // Undo one: its row is back to waiting.
      assert.equal((await S.post('unreview', { id: story })).status, 200);
      assert.equal(
        JSON.parse(readFileSync(checkPath, 'utf8')).rows.find(
          (/** @type {{ id: string }} */ x) => x.id === story
        ).approved,
        undefined
      );
      assert.equal((await S.post('approve-story', { story: 'Bad Story' })).status, 400);
      assert.equal((await S.post('approve-story', { story: 'components-nope--x' })).status, 404);
    } finally {
      S.stop();
    }
  }
);

test(
  'check --only with a story that is not registered registers it and checks it, without the server',
  { skip: needs },
  async () => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    try {
      const cfgPath = join(f.repo, 'pxsig.config.json');
      writeFileSync(
        cfgPath,
        JSON.stringify(
          { ...JSON.parse(readFileSync(cfgPath, 'utf8')), storybook: { url: sb.url } },
          null,
          2
        )
      );
      const out = await new Promise((ok) => {
        const p = spawn(
          process.execPath,
          [
            join(src, 'check.mjs'),
            '--only',
            `${f.ids.unregistered},components-nope--missing`,
            '--retries',
            '0',
          ],
          { cwd: f.repo, env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
        );
        let log = '';
        p.stdout.on('data', (d) => (log += d));
        p.stderr.on('data', (d) => (log += d));
        p.on('exit', (code) => ok({ code, log }));
      });
      assert.match(out.log, /registered components-gamma--new-one: 1 NEW entries/, out.log);
      assert.match(
        out.log,
        /not checked: components-nope--missing: not in the manifest or the Storybook story index/
      );
      assert.equal(out.code, 1, 'a NEW entry fails the check until it is approved');
      const row = rowsOf(f).find((/** @type {{ id: string }} */ x) => x.id === f.ids.unregistered);
      assert.equal(row?.new, true);
      const e = JSON.parse(readFileSync(join(f.px, 'manifest.json'), 'utf8')).stories.find(
        (/** @type {{ id: string }} */ x) => x.id === f.ids.unregistered
      );
      assert.ok(!existsSync(join(f.repo, e.sig)), 'no signature');
    } finally {
      sb.close();
    }
  }
);
