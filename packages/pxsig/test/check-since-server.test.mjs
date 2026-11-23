/**
 * check-since-server.test.mjs — `pxsig check --since <ref>` when the pxsig server holds the store:
 * the ref goes with the check (check/via-server.mjs), the server compares with it as the check
 * without a server does (serve/check-compare.mjs), and check.json gets the same `react` either way;
 * the ref and files a request names are checked as the CLI checks its flags (lib/git-ref.mjs), and a
 * bad one is refused before anything is queued.
 *
 *   node --test packages/pxsig/test/check-since-server.test.mjs
 *
 * Needs the engine, Chromium and the React Compiler test fixtures for the checks; the refusals
 * need only the engine.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { filesFault, refFault } from '../src/lib/git-ref.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { raw, serve } from './guard-helpers.mjs';
import { hasCompiler, NO_COMPILER, reactProject } from './react-helpers.mjs';
import { fakeStorybook, needs, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const engine = skipUnless(hasRust, 'Rust binary not built') || skipUnless(hasCompiler, NO_COMPILER);
const skip = needs || engine;
const STORIES = ['primary', 'small'].map((s) => ({
  id: `button--${s}`,
  title: 'Button',
  name: s,
  importPath: 'src/Button/Button.stories.tsx',
}));

/**
 * check.mjs in `dir`, with the server at `url` (a dead port: no server).
 * @param {string} dir
 * @param {string[]} args
 * @param {string} url
 * @returns {Promise<{ code: number | null, out: string, err: string }>}
 */
const check = (dir, args, url = 'http://127.0.0.1:1') =>
  new Promise((ok) => {
    const p = spawn(process.execPath, [join(src, 'check.mjs'), ...args], {
      cwd: dir,
      env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_URL: url },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => ok({ code, out, err }));
  });

/** @param {string} dir */
const checkJson = (dir) =>
  JSON.parse(readFileSync(join(dir, '.pxsig', 'reports', 'check.json'), 'utf8'));
/** @param {string} dir */
const lastRun = (dir) =>
  readFileSync(join(dir, '.pxsig', 'reports', 'history.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .at(-1);

/** `react` without what differs from run to run (times, cache hits) and repository (the commit). */
const comparable = (/** @type {Record<string, any>} */ react) => ({
  ...react,
  summary: { ...react.summary, ms: 0, cached: 0 },
  base: { ...react.base, commit: null },
});

test('a ref or files a check compares with: the rule the CLI and the server share', (t) => {
  const dir = reactProject(t, { babel: null });
  assert.equal(refFault(dir, 'main'), null);
  assert.equal(refFault(dir, 'HEAD~1'), null);
  assert.equal(refFault(dir, 'work'), null);
  for (const bad of ['--output=x', '-h', 'main;touch x', 'main x', 'main\n', '', 'a'.repeat(300)])
    assert.match(String(refFault(dir, bad)), /^since: /, JSON.stringify(bad));
  assert.match(String(refFault(dir, 'no-such-ref')), /`no-such-ref` is not a commit here/);
  assert.match(String(refFault(dir, 42)), /^since: a git ref is needed/);
  assert.equal(filesFault(['src/Button/Button.tsx', 'src/a b.tsx']), null);
  for (const bad of [
    [],
    'src/a.tsx',
    ['/etc/passwd'],
    ['../x.tsx'],
    ['src/../../x'],
    ['-x'],
    ['a\u0000'],
  ])
    assert.match(String(filesFault(bad)), /^changed: /, JSON.stringify(bad));
});

test(
  'the server refuses a bad since or changed before queueing anything',
  { skip: engine },
  async (t) => {
    const dir = reactProject(t);
    const S = await serve(/** @type {any} */ ({ repo: dir }));
    t.after(() => S.stop());
    const headers = { 'x-pxsig-token': /** @type {string} */ (readToken(dir, S.url)) };
    for (const body of [
      { since: '--output=/tmp/x' },
      { since: 'main;touch x' },
      { since: 'no-such-ref' },
      { since: 7 },
      { changed: ['../outside.tsx'] },
      { changed: ['/etc/passwd'] },
      { since: 'main', changed: ['src/Button/Button.tsx'] },
    ]) {
      const r = await raw(S.port, {
        method: 'POST',
        path: '/__pxsig/check',
        headers,
        body: { ids: ['button--primary'], ...body },
      });
      assert.equal(r.status, 400, `${JSON.stringify(body)}: ${r.text}`);
      assert.match(r.json().error, /^(since|changed|git|pass since)/);
      assert.ok(!r.text.includes(dir), 'no absolute path');
      const status = (await raw(S.port, { path: '/__pxsig/status' })).json();
      assert.ok(!status.running && !status.queued, 'nothing queued');
    }
    // The CLI refuses the same ref, with the same words, before it asks the server.
    const cli = await check(dir, ['--since', 'no-such-ref'], S.url);
    assert.equal(cli.code, 2);
    assert.match(cli.err, /`no-such-ref` is not a commit here/);
  }
);

test(
  'check --since through the server: check.json, the history line and the React lines match the check without one',
  { skip },
  async (t) => {
    const sb = await fakeStorybook(STORIES);
    t.after(() => sb.close());
    const config = { storybook: { url: sb.url } };
    const here = reactProject(t, { config, folder: 'react-here' });
    const there = reactProject(t, { config, folder: 'react-there' });
    const args = ['--since', 'main', '--retries', '0'];

    const alone = await check(here, args);
    assert.equal(alone.code, 1, 'two NEW entries' + alone.out + alone.err);

    const S = await serve(/** @type {any} */ ({ repo: there }));
    t.after(() => S.stop());
    const via = await check(there, args, S.url);
    assert.match(via.out, /holds this store: queueing 2 entries there/, via.out + via.err);
    assert.equal(via.code, alone.code, via.out + via.err);

    const line =
      /\n\[check\] react: 1 files, 2 functions · 1 newly skipped by the React Compiler · 1 new findings · \d+\.\d s/;
    assert.match(alone.out, line);
    assert.match(via.out, line, via.out);
    assert.match(via.out, /\n\[check\] {3}Button .+\n/);

    const a = checkJson(here);
    const b = checkJson(there);
    assert.deepEqual(Object.keys(b.react), ['summary', 'alerts', 'base', 'backend']);
    assert.deepEqual(comparable(b.react), comparable(a.react));
    assert.equal(b.react.base.since, 'main');
    assert.deepEqual(b.affected.ids, a.affected.ids);
    assert.equal(b.affected.reason, a.affected.reason);
    assert.deepEqual(lastRun(there).react, lastRun(here).react);
    assert.deepEqual(lastRun(there).react, { alerts: 2, newBailouts: 1 });
    assert.ok(!JSON.stringify(b).includes(there), 'no absolute path in check.json');

    // The quick `pxsig check --since` (pxsig_check) hands the ref over too, and answers its `react`.
    const quick = await new Promise((ok) => {
      const p = spawn(
        process.execPath,
        [join(src, '..', 'bin', 'pxsig.mjs'), 'check', '--since', 'main', '--json'],
        {
          cwd: there,
          env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_URL: S.url },
        }
      );
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => ok(out));
    });
    const answer = JSON.parse(/** @type {string} */ (quick));
    assert.equal(answer.via, 'server', /** @type {string} */ (quick));
    assert.deepEqual(comparable(answer.react), comparable(a.react));
  }
);

test(
  'queued checks are batched by ref: two refs queued behind a running check give two runs, each with its own',
  { skip },
  async (t) => {
    const sb = await fakeStorybook(STORIES);
    t.after(() => sb.close());
    const dir = reactProject(t, { config: { storybook: { url: sb.url } } });
    const S = await serve(/** @type {any} */ ({ repo: dir }));
    t.after(() => S.stop());
    const headers = { 'x-pxsig-token': /** @type {string} */ (readToken(dir, S.url)) };
    // Each run's end, with check.json's React base as that run wrote it (the next run takes seconds).
    /** @type {{ ids: string[], since: string | null | undefined }[]} */
    const runs = [];
    let buf = '';
    const ev = request({ host: '127.0.0.1', port: S.port, path: '/__pxsig/events' }, (res) =>
      res.on('data', (c) => {
        buf += c;
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = /^event: check\ndata: (.+)$/m.exec(block)?.[1];
          const d = data ? JSON.parse(data) : null;
          if (d?.state === 'done')
            runs.push({ ids: d.ids, since: checkJson(dir).react?.base?.since ?? null });
        }
      })
    );
    ev.on('error', () => {});
    ev.end();
    t.after(() => ev.destroy());
    await new Promise((r) => setTimeout(r, 200));
    const post = (/** @type {Record<string, unknown>} */ body) =>
      raw(S.port, {
        method: 'POST',
        path: '/__pxsig/check',
        headers,
        body: { ids: ['button--primary', 'button--small'], ...body },
      });
    // The first runs at once; the two compared ones queue behind it, one batch each.
    for (const body of [{}, { since: 'main' }, { since: 'HEAD~1' }])
      assert.equal((await post(body)).status, 202);
    for (let i = 0; i < 600 && runs.length < 3; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(
      runs.map((r) => r.since),
      [null, 'main', 'HEAD~1'],
      `three runs, each compared with its own ref: ${JSON.stringify(runs)}\n${S.log()}`
    );
    for (const r of runs) assert.deepEqual([...r.ids].sort(), ['button--primary', 'button--small']);
    // Both refs name the same commit here: the same React result, each under its own ref.
    const last = checkJson(dir).react;
    assert.equal(last.summary.newBailouts, 1);
    assert.equal(last.base.since, 'HEAD~1');
  }
);
