/**
 * mcp-react.test.mjs — the MCP side of the React analysis: pxsig_react (react.json read and
 * reduced, or a run), the `react` pxsig_check adds when it compares with a ref (checkReact), and
 * `renders` in pxsig_entry. In-process, in the React fixture project (react-helpers.mjs).
 *
 *   node --test packages/pxsig/test/mcp-react.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ctxOf, tools } from '../src/tools/index.mjs';
import { checkReact } from '../src/tools/react.mjs';
import { hasRust } from './fixture.mjs';
import { hasCompiler, reactProject } from './react-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ReactToolArgs, ReactToolResult } from '../src/types/react.js' */

const skip = skipUnless(
  hasRust && hasCompiler,
  'the engine or the React Compiler test fixtures are missing'
);

/**
 * Run `fn` with the fixture project as the workspace, as the MCP server started there sees it.
 * (Not process.chdir: the worker threads inherit the suite's relative `--import`.)
 * @template T
 * @param {string} dir
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function inWorkspace(dir, fn) {
  const was = { ws: process.env.PXSIG_WORKSPACE, project: process.env.PXSIG_PROJECT };
  process.env.PXSIG_WORKSPACE = dir;
  delete process.env.PXSIG_PROJECT;
  try {
    return await fn();
  } finally {
    if (was.ws === undefined) delete process.env.PXSIG_WORKSPACE;
    else process.env.PXSIG_WORKSPACE = was.ws;
    if (was.project !== undefined) process.env.PXSIG_PROJECT = was.project;
  }
}

/**
 * Run a tool as the MCP server does, in the fixture project.
 * @param {string} dir
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
const call = (dir, name, args) =>
  inWorkspace(dir, () => {
    const tool = /** @type {{ run: (a: Record<string, unknown>) => Promise<unknown> }} */ (
      tools.find((t) => t.name === name)
    );
    return tool.run(args);
  });

/**
 * @param {string} dir
 * @param {ReactToolArgs} [args]
 */
const react = async (dir, args = {}) =>
  /** @type {ReactToolResult} */ (await call(dir, 'pxsig_react', { ...args }));

test('pxsig_react: none yet, then a run, then the same results read back', { skip }, async (t) => {
  const dir = reactProject(t);
  assert.deepEqual(await react(dir), {
    ran: false,
    why: 'none',
    text: 'no .pxsig/reports/react.json yet: pxsig_react with run: true, or pxsig check --since <ref>, writes one',
  });
  const r = await react(dir, { run: true });
  assert.ok(r.ran, JSON.stringify(r));
  assert.deepEqual(r.base, { since: 'main', commit: r.base?.commit });
  assert.deepEqual(
    r.alerts.map((a) => [a.id, a.change, a.level]),
    [
      ['src/Button/Button.tsx#Button', 'new-bailout', 'warning'],
      ['src/Button/Button.tsx#Card', 'new-finding', 'note'],
    ]
  );
  assert.match(r.alerts[0].text, /^Button \(src\/Button\/Button\.tsx\): compiled at main/);
  const button = r.functions.find((f) => f.id === 'src/Button/Button.tsx#Button');
  assert.deepEqual(button, {
    id: 'src/Button/Button.tsx#Button',
    change: 'new-bailout',
    alert: true,
    now: 'bailout',
    before: 'compiled',
    rules: [{ rule: 'refs', line: 4, stops: true }],
  });
  assert.equal(r.more, 0);
  assert.equal(r.heldBy, undefined);
  // Read back: what the run wrote, reduced the same way.
  const read = await react(dir);
  assert.ok(read.ran);
  assert.deepEqual({ ...read, at: null }, { ...r, at: null });
  // Alerts first, then cut at `limit`.
  const one = await react(dir, { limit: 1 });
  assert.ok(one.ran);
  assert.deepEqual(
    [one.functions.map((f) => f.alert), one.more],
    [[true], one.summary.functions - 1]
  );
});

test('pxsig_react run: the compiler absent, or React off, says why', { skip }, async (t) => {
  const none = reactProject(t, { babel: null });
  const r = await react(none, { run: true });
  assert.equal(r.ran, false);
  assert.equal(!r.ran && r.why, 'not-installed');
  const off = reactProject(t, { config: { react: false } });
  const o = await react(off, { run: true });
  assert.deepEqual([o.ran, !o.ran && o.why], [false, 'off']);
});

test("pxsig_check's react: only with since or changed files", { skip }, async (t) => {
  const dir = reactProject(t);
  await inWorkspace(dir, async () => {
    const C = ctxOf(null);
    assert.equal(await checkReact(C, {}), null);
    assert.equal(await checkReact(C, { changed_files: [] }), null);
    const since = await checkReact(C, { since: 'main' });
    assert.ok(since && 'summary' in since, JSON.stringify(since));
    assert.deepEqual(
      since.alerts.map((a) => a.change),
      ['new-bailout', 'new-finding']
    );
    const files = await checkReact(C, { changed_files: ['src/Button/Button.tsx'] });
    assert.ok(files && 'summary' in files);
    assert.equal(files.base?.since, 'HEAD');
  });
  const none = reactProject(t, { babel: null });
  await inWorkspace(none, async () =>
    assert.deepEqual(await checkReact(ctxOf(null), { since: 'main' }), {
      skipped: 'not-installed',
    })
  );
});

test("pxsig_entry carries the row's render counts", { skip }, async (t) => {
  const dir = reactProject(t);
  const renders = {
    v: 1,
    build: 'production',
    react: '19.3.0',
    mount: { commits: 2, rendered: 9 },
    top: [{ name: 'Button', renders: 2, compiled: false }],
    settled: true,
  };
  const reports = join(dir, '.pxsig', 'reports');
  mkdirSync(reports, { recursive: true });
  writeFileSync(
    join(reports, 'check.json'),
    JSON.stringify({
      generatedAt: '2026-11-05T12:00:00.000Z',
      rows: [
        { id: 'button--primary', story: 'button--primary', mode: 'default', pass: true, renders },
        { id: 'button--small', story: 'button--small', mode: 'default', pass: true },
      ],
    })
  );
  /** @param {string} id */
  const entry = async (id) => {
    const out = /** @type {{ content: { text: string }[] }} */ (
      await call(dir, 'pxsig_entry', { id, images: [] })
    );
    return JSON.parse(out.content[0].text);
  };
  assert.deepEqual((await entry('button--primary')).renders, renders);
  assert.equal('renders' in (await entry('button--small')), false);
});
