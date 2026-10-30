/**
 * mcp-tools.test.mjs — the MCP tools mcp.test.mjs does not call: pxsig_stale, pxsig_history,
 * pxsig_affected and pxsig_check, over the server's real transport (stdio JSON-RPC), each in its
 * own fixture project.
 *
 *   node --test packages/pxsig/test/mcp-tools.test.mjs
 *
 * pxsig_check runs twice: with no pxsig server (it runs the check itself, and the project's
 * Storybook is a closed port), and through a `pxsig serve` this file starts on its own port, with
 * a stand-in Storybook. Needs the Rust binary (and Chromium for the served check).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

import { fixture, hasRust, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, serve, src } from './server-helpers.mjs';

/** @typedef {ReturnType<typeof fixture>} Fixture */
/** @typedef {{ isError?: boolean, content: { type: string, text: string }[] }} ToolResult */

/**
 * The MCP server in a fixture project, talking to the pxsig server at `url` (a closed port by
 * default). `call` answers a tool's result; `json` its first content block, parsed.
 * @param {Fixture} f
 * @param {{ after: (fn: () => void) => void }} t
 * @param {string} [url]
 */
function mcp(f, t, url = 'http://127.0.0.1:1') {
  const proc = spawn(process.execPath, [join(src, 'mcp.mjs')], {
    cwd: f.repo,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...f.env, PXSIG_URL: url, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
  });
  t.after(() => proc.kill());
  /** @type {Map<number, (m: { result: ToolResult }) => void>} */
  const pending = new Map();
  createInterface({ input: proc.stdout }).on('line', (line) => {
    // A JSON-RPC reply the server wrote: one object per line.
    const m = JSON.parse(line);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  let seq = 0;
  /**
   * @param {string} name
   * @param {Record<string, unknown>} [args]
   * @returns {Promise<ToolResult>}
   */
  const call = (name, args = {}) =>
    new Promise((ok) => {
      const id = ++seq;
      pending.set(id, (m) => ok(m.result));
      proc.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`
      );
    });
  /**
   * @param {string} name
   * @param {Record<string, unknown>} [args]
   */
  const json = async (name, args = {}) => {
    const r = await call(name, args);
    assert.equal(r.isError, undefined, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  return { call, json };
}

const skip = !hasRust && 'Rust binary not built';

test(
  'pxsig_affected traces edited files to their entries, and needs files or since',
  { skip },
  async (t) => {
    const f = fixture({ withSigs: false, t });
    const { call, json } = mcp(f, t);
    const a = await json('pxsig_affected', { files: ['src/components/Beta/Beta.stories.tsx'] });
    const beta = f.manifest.stories
      .filter((e) => e.id.startsWith('components-beta--'))
      .map((e) => e.id);
    assert.deepEqual([.../** @type {string[]} */ (a.ids)].sort(), beta.sort());
    assert.equal(a.entries, beta.length);
    assert.equal(a.all, false);
    assert.deepEqual(a.changedFiles, ['src/components/Beta/Beta.stories.tsx']);
    const none = await call('pxsig_affected', {});
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /give files or since/);
  }
);

test(
  'pxsig_stale lists verdicts older than an edit, and rows whose size differs from the render',
  { skip },
  async (t) => {
    const f = fixture({ withSigs: false, t });
    // drift's row records 64×64; its render on disk is 128×128.
    const checkPath = join(f.px, 'reports', 'check.json');
    const report = JSON.parse(readFileSync(checkPath, 'utf8'));
    report.rows.find((/** @type {{ id: string }} */ r) => r.id === f.ids.drift).pixels = {
      width: 64,
      height: 64,
    };
    writeFileSync(checkPath, JSON.stringify(report));
    const { json } = mcp(f, t);
    const s = await json('pxsig_stale');
    assert.equal(s.of, report.rows.length);
    // Beta's story file was edited after `stale`'s verdict (and after the last full check, which
    // is `quiet`'s verdict: its row has no time of its own); every other verdict is newer.
    assert.deepEqual(s.byFile, {
      'src/components/Beta/Beta.stories.tsx': 1,
      'src/components/Delta/Delta.stories.tsx': 1,
    });
    assert.equal(s.stale, 2);
    assert.deepEqual(s.inconsistentSample, [{ id: f.ids.drift, row: '64x64', render: '128x128' }]);
    assert.deepEqual(
      [.../** @type {string[]} */ (s.ids)].sort(),
      [f.ids.drift, f.ids.quiet, f.ids.stale].sort()
    );
    assert.match(s.hint, /pxsig_check \{ ids \}/);
    // An edit now makes Alpha's verdicts stale too.
    const now = new Date();
    utimesSync(join(f.repo, 'src/components/Alpha/Alpha.stories.tsx'), now, now);
    const after = await json('pxsig_stale', { limit: 1 });
    assert.equal(after.byFile['src/components/Alpha/Alpha.stories.tsx'], 2);
    assert.equal(after.ids.length, 1, 'limit');
  }
);

test('pxsig_history answers the last runs, newest last, with their failures', async (t) => {
  const f = fixture({ withSigs: false, t });
  const { json } = mcp(f, t);
  assert.deepEqual(await json('pxsig_history'), { runs: [] }, 'no history yet');
  const line = (/** @type {number} */ n, /** @type {Record<string, unknown>} */ extra = {}) =>
    JSON.stringify({
      at: `2026-10-0${n}T00:00:00.000Z`,
      summary: { stories: 2, failed: 1 },
      rows: { a: [1, 1, 0, 0], [`b${n}`]: [0, 0.5, 9, 0] },
      ...extra,
    });
  writeFileSync(
    join(f.px, 'reports', 'history.ndjson'),
    `${[line(1), line(2), line(3, { wouldFail: true, enforcement: ['visual'] })].join('\n')}\n`
  );
  const h = await json('pxsig_history', { limit: 2 });
  assert.deepEqual(h.runs, [
    { at: '2026-10-02T00:00:00.000Z', entries: 2, failed: 1, failedIds: ['b2'] },
    {
      at: '2026-10-03T00:00:00.000Z',
      entries: 2,
      failed: 1,
      failedIds: ['b3'],
      wouldFail: true,
      enforcement: ['visual'],
    },
  ]);
});

test(
  'pxsig_check without a pxsig server runs the check itself; an unreachable Storybook is a setup error',
  { skip, timeout: 120_000 },
  async (t) => {
    const f = fixture({ withSigs: false, t });
    const { call, json } = mcp(f, t);
    assert.deepEqual(await json('pxsig_check'), {
      checked: 0,
      note: 'nothing selected (the files affect no entries?)',
    });
    const before = readFileSync(join(f.px, 'reports', 'check.json'), 'utf8');
    const r = await call('pxsig_check', { ids: [f.ids.ok], timeout_s: 60 });
    assert.equal(r.isError, true, r.content[0].text);
    assert.match(
      r.content[0].text,
      /^Error: check setup error:\n[\s\S]*Storybook is not reachable at http:\/\/127\.0\.0\.1:1 [\s\S]*Nothing was rendered/
    );
    assert.equal(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'), before);
  }
);

test(
  'pxsig_check through a running pxsig server re-renders the selection and reports its results',
  { skip: needs, timeout: 120_000 },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    t.after(() => (S.stop(), sb.close()));
    const { json } = mcp(f, t, S.base);
    const before = new Map(
      JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows.map(
        (/** @type {{ id: string, checkedAt: string }} */ r) => [r.id, r.checkedAt]
      )
    );
    const r = await json('pxsig_check', {
      ids: [f.ids.ok, f.ids.error],
      stories: ['components-nope--missing'],
      timeout_s: 90,
    });
    assert.equal(r.via, 'server', JSON.stringify(r));
    assert.equal(r.checked, 2);
    assert.deepEqual(
      r.skipped.map((/** @type {{ name: string }} */ x) => x.name),
      ['components-nope--missing']
    );
    assert.ok(
      r.problems.some((/** @type {{ id: string }} */ p) => p.id === f.ids.error),
      JSON.stringify(r.problems)
    );
    const rows = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows;
    for (const id of [f.ids.ok, f.ids.error])
      assert.notEqual(
        rows.find((/** @type {{ id: string }} */ x) => x.id === id).checkedAt,
        before.get(id),
        `${id} re-checked:\n${S.log()}`
      );
    const untouched = rows.find((/** @type {{ id: string }} */ x) => x.id === f.ids.drift);
    assert.equal(untouched.checkedAt, before.get(f.ids.drift), 'only the selection');
  }
);
