/**
 * server-startup.test.mjs — `pxsig serve` from start to stop, on fixture projects in temp dirs:
 * the order of its startup lines, what SIGTERM removes, and `--watch` (an edit under srcRoot
 * re-checks the entries it affects, against a stand-in Storybook).
 *
 *   node --test packages/pxsig/test/server-startup.test.mjs
 *
 * These pin today's behaviour, so moving the server's code changes none of it. Needs the Rust
 * binary (and Chromium for `--watch`); skipped without them.
 */
import assert from 'node:assert/strict';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tokenFile } from '../src/lib/guard.mjs';
import { serverFile } from '../src/lib/workspace.mjs';
import { fixture, hasRust } from './fixture.mjs';
import { fakeStorybook, needs, serve } from './server-helpers.mjs';
import { skipOn, skipUnless } from './strict.mjs';

/** @param {number} ms */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Wait until `pattern` is in the log (a line can arrive just after the answer that said ready).
 * @param {() => string} log
 * @param {RegExp} pattern
 */
async function logged(log, pattern, ms = 20_000) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(100))
    if (pattern.test(log())) return;
  assert.fail(`no line matching ${pattern} in:\n${log()}`);
}

test(
  'startup prints "Rust engine up", then the dashboard line, then the startup integrity line',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      const integrity = /\[serve\] fixture: .+ \(startup, \d+ ms\)/;
      await logged(S.log, integrity);
      const log = S.log();
      const engine = log.search(/\[serve\] Rust engine up \(pxsig \S+, \d+ threads\)/);
      const dashboard = log.search(
        /\[serve\] pxsig dashboard → http:\/\/127\.0\.0\.1:\d+\/report\//
      );
      const startup = log.search(integrity);
      assert.ok(engine >= 0 && dashboard >= 0, log);
      assert.ok(engine < dashboard, `the engine is up before the dashboard line:\n${log}`);
      assert.ok(dashboard < startup, `the startup integrity line comes after it:\n${log}`);
      assert.match(log, /\(fixture; Ctrl\+C to stop\)/);
    } finally {
      await S.stop();
    }
  }
);

test(
  'SIGTERM removes server.json and both token files, and exits 0',
  {
    skip:
      skipUnless(hasRust, 'Rust binary not built') ||
      skipOn('a signal ends a Windows process without its shutdown'),
  },
  async () => {
    const f = fixture();
    const S = await serve(f);
    const info = serverFile(f.repo);
    const files = [info, tokenFile(f.repo, S.base), tokenFile(f.repo, S.base, 'mcp')];
    try {
      for (const file of files) assert.ok(existsSync(file), 'written once the server listens');
    } finally {
      const exit = await S.stop(); // SIGTERM (server-proc.mjs)
      assert.deepEqual(exit, { code: 0, signal: null }, S.log());
    }
    for (const file of files) assert.ok(!existsSync(file), `removed on SIGTERM:\n${S.log()}`);
  }
);

/**
 * The server's events (`GET /__pxsig/events`) as they arrive.
 * @param {string} base
 */
async function events(base) {
  const ctl = new AbortController();
  /** @type {{ event: string, data: Record<string, unknown> }[]} */
  const seen = [];
  const r = await fetch(`${base}/__pxsig/events`, { signal: ctl.signal });
  void (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      // A 200 event stream has a body.
      for await (const chunk of /** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (
        r.body
      )) {
        buf += dec.decode(chunk, { stream: true });
        for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
          const m = /^event: (.+)\ndata: (.*)$/.exec(buf.slice(0, i));
          if (m) seen.push({ event: m[1], data: JSON.parse(m[2]) });
        }
      }
    } catch {
      // aborted when the test ends
    }
  })();
  return { seen, close: () => ctl.abort() };
}

test(
  '--watch: an edit under srcRoot sends `watch`, then `check` for the entries it affects',
  { skip: needs, timeout: 180_000 },
  async (t) => {
    const f = fixture();
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const S = await serve(f, { storybook: sb.url, args: ['--watch'] });
    t.after(() => S.stop());
    assert.match(S.log(), /\[serve\] fixture: watching src — edits re-check affected entries/);
    const ev = await events(S.base);
    t.after(() => ev.close());
    await logged(() => ev.seen.map((e) => e.event).join(' '), /hello/, 5000);
    const file = 'src/components/Alpha/Alpha.stories.tsx';
    const alpha = f.manifest.stories
      .filter((e) => e.importPath === file)
      .map((e) => e.id)
      .sort();
    assert.ok(alpha.length >= 2, 'the edited file has entries');
    appendFileSync(join(f.repo, file), '// edited\n');
    /** @param {string} state */
    const checkAt = (state) =>
      ev.seen.findIndex((e) => e.event === 'check' && e.data.state === state);
    for (const until = Date.now() + 120_000; checkAt('done') < 0 && checkAt('error') < 0;) {
      if (Date.now() > until) assert.fail(`no check after the edit:\n${S.log()}`);
      await sleep(100);
    }
    const watch = ev.seen.findIndex((e) => e.event === 'watch');
    assert.ok(watch >= 0, `a watch event:\n${JSON.stringify(ev.seen)}`);
    const { files, ...said } = ev.seen[watch].data;
    assert.deepEqual(said, { project: 'fixture', ids: alpha.length });
    // The edited file, workspace-relative; a platform may also name its folder (one debounced list).
    assert.ok(Array.isArray(files) && files.includes(file), JSON.stringify(files));
    const running = checkAt('running');
    assert.ok(watch < running && running < checkAt('done'), JSON.stringify(ev.seen));
    const { ids, ...rest } = ev.seen[running].data;
    assert.deepEqual(rest, { project: 'fixture', state: 'running' });
    // The ids of a check event are a string[] (docs/server.md).
    assert.deepEqual([.../** @type {string[]} */ (ids)].sort(), alpha, 'the affected entries');
    const done = /** @type {string[]} */ (ev.seen[checkAt('done')].data.ids);
    assert.deepEqual([...done].sort(), alpha);
    assert.match(S.log(), new RegExp(`fixture: watch: ${file} → ${alpha.length} entries`));
  }
);
