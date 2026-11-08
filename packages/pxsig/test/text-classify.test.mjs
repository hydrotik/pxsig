/**
 * text-classify.test.mjs — text labels (text-aware diffs, PR 3): the `text` tolerances, the env
 * plan the engine compares text within, the run manifest that carries the tolerances, and, end to
 * end in Chromium, a check whose rows gain `textDiff` while every verdict and exit code stays what
 * it is with text off.
 *
 *   node --test packages/pxsig/test/text-classify.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { readText, textTolerances, TEXT_TOLERANCES } from '../src/lib/text/config.mjs';
import { envPlan } from '../src/lib/text/env-plan.mjs';
import { openProject, writeRunManifest } from '../src/lib/workspace.mjs';
import { fixture, rustBin, testEnv, testHome } from './fixture.mjs';
import { env, needs, src } from './env-helpers.mjs';
/** @import { CheckRow } from '../src/types.js' */

test('the text tolerances: defaults, values, and a bad value is a warning and its default', () => {
  assert.deepEqual(TEXT_TOLERANCES, { movePx: 0.5, edgePx: 2, noisePx: 0 });
  assert.deepEqual(readText(true, {}), {
    on: true,
    off: null,
    ignore: [],
    problems: [],
    movePx: 0.5,
    edgePx: 2,
    noisePx: 0,
  });
  const t = readText({ movePx: 1, edgePx: 3, noisePx: 12 }, {});
  assert.deepEqual([t.on, t.movePx, t.edgePx, t.noisePx, t.problems], [true, 1, 3, 12, []]);
  const bad = readText({ movePx: -1, edgePx: '2', noisePx: 1.5 }, {});
  assert.equal(bad.on, true, 'a bad tolerance never turns text capture off');
  assert.deepEqual([bad.movePx, bad.edgePx, bad.noisePx], [0.5, 2, 0]);
  assert.deepEqual(bad.problems, [
    'text.movePx must be a number of px, 0 or more: 0.5 is used',
    'text.edgePx must be a number of px, 0 or more: 2 is used',
    'text.noisePx must be a whole number of px, 0 or more: 0 is used',
  ]);
  assert.deepEqual(textTolerances({ text: { edgePx: 1 } }), { movePx: 0.5, edgePx: 1, noisePx: 0 });
  assert.deepEqual(textTolerances({ text: false }), TEXT_TOLERANCES);
  assert.deepEqual(textTolerances({}), TEXT_TOLERANCES);
});

test("the env plan names each entry's render environment, by its browser", () => {
  const chromium = env();
  const firefox = env({ browser: { name: 'firefox', version: '140.0' } });
  const plan = envPlan(
    [{ id: 'a' }, { id: 'b', browser: 'firefox' }, { id: 'c', browser: 'webkit' }],
    { chromium, firefox }
  );
  assert.deepEqual(plan.byId, { a: chromium.id, b: firefox.id }, 'no env, no entry');
  assert.deepEqual(Object.keys(plan.envs).sort(), [chromium.id, firefox.id].sort());
  assert.deepEqual(envPlan([{ id: 'a' }], null), { envs: {}, byId: {} });
});

test('the run manifest carries the text tolerances for the engine', () => {
  const f = fixture({ withSigs: false });
  const cfgPath = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, text: { movePx: 1 } }));
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  assert.deepEqual(writeRunManifest(P).manifest.text, { movePx: 1, edgePx: 2, noisePx: 0 });
});

// --- end to end, rendering in Chromium -------------------------------------------------------------

/**
 * A stand-in Storybook with one story whose markup the test sets (`html.body`).
 * @param {{ id: string, title: string, name: string, importPath: string }} story
 * @param {{ body: string }} html
 */
async function storybook(story, html) {
  const server = createServer((req, res) => {
    res.setHeader('connection', 'close');
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname === '/index.json')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          v: 5,
          entries: {
            [story.id]: {
              type: 'story',
              id: story.id,
              title: story.title,
              name: story.name,
              importPath: `./${story.importPath}`,
              tags: [],
            },
          },
        })
      );
    if (u.pathname === '/iframe.html')
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;color:#111;font:16px/20px sans-serif}#storybook-root{display:inline-block;padding:8px}</style></head>
<body class="sb-show-main"><div id="storybook-root">${html.body}</div>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(story.id)}, phase: 'finished' } };</script></body></html>`
      );
    res.writeHead(404).end();
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
  return {
    url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`,
    close: () => server.close(),
  };
}

const TILE = (/** @type {string} */ figure) =>
  `<p style="margin:0"><span data-testid="figure">${figure}</span><span>new · of 9</span></p>`;

test(
  'a check labels its rows with textDiff, compares text only within one environment, and changes no verdict',
  { skip: needs },
  async () => {
    const f = fixture();
    const id = f.ids.ok;
    const html = { body: TILE('1') };
    const sb = await storybook(
      {
        id,
        title: 'Components/Alpha',
        name: 'Default',
        importPath: 'src/components/Alpha/Alpha.stories.tsx',
      },
      html
    );
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: sb.url } }, null, 2));
    /**
     * @param {string[]} [args]
     * @returns {Promise<{ status: number | null, out: string }>}
     */
    const check = (args = []) =>
      new Promise((ok) => {
        const p = spawn(
          process.execPath,
          [join(src, 'check.mjs'), '--only', id, '--retries', '0', '--no-a11y', ...args],
          { cwd: f.repo, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
        );
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('close', (status) => ok({ status, out }));
      });
    const row = () =>
      /** @type {CheckRow} */ (
        JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows.find(
          (/** @type {CheckRow} */ x) => x.id === id
        )
      );
    /** The row as the verdict sees it: without the labels and what each run stamps. */
    const verdict = (/** @type {CheckRow} */ r) => {
      const { textDiff: _t, checkedAt: _c, renderMs: _m, cached: _k, ...rest } = r;
      return rest;
    };
    try {
      // The fixture's baseline has no environment: text is never compared against it.
      let r = await check();
      assert.deepEqual(row().textDiff, { v: 1, state: 'env-differs' }, r.out);
      // Re-taken from this run's render, with its environment and text record, then checked again.
      const report = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
      const here = report.envs[/** @type {string} */ (row().env)];
      const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
      const plan = join(f.repo, '.env-plan.json');
      writeFileSync(plan, JSON.stringify(envPlan([{ id }], { chromium: here })));
      const b = spawnSync(
        rustBin,
        ['baseline', '--manifest', writeRunManifest(P).path, '--png-dir', P.store.latest].concat([
          '--root',
          P.workspaceRoot,
          '--only',
          id,
          '--env',
          `@${plan}`,
          '--json',
        ]),
        { encoding: 'utf8' }
      );
      assert.equal(b.status, 0, b.stderr);
      r = await check();
      assert.equal(r.status, 0, r.out);
      const same = /** @type {Extract<CheckRow['textDiff'], { state: 'compared' }>} */ (
        row().textDiff
      );
      assert.equal(same.state, 'compared', r.out);
      assert.equal(same.kind, null);
      // #256: the figure gains a trailing space; the unit after it moves right by the space.
      html.body = TILE('1 ');
      const on = await check();
      const labelled = row();
      const td = /** @type {Extract<CheckRow['textDiff'], { state: 'compared' }>} */ (
        labelled.textDiff
      );
      assert.equal(td.kind, 'copy-reflow', JSON.stringify(td));
      const moved = td.changes.find((c) => c.kind === 'moved');
      const copy = td.changes.find((c) => c.kind === 'copy');
      assert.ok(moved && copy, JSON.stringify(td));
      assert.equal(copy.whitespace, true);
      assert.ok(moved.pushed && /** @type {number} */ (moved.dx) > 2, JSON.stringify(moved));
      // Text off: the same verdict and exit code, and no label.
      const off = await check(['--no-text']);
      assert.equal(off.status, on.status, on.out + off.out);
      assert.equal(row().textDiff, undefined);
      assert.deepEqual(verdict(row()), verdict(labelled));
    } finally {
      sb.close();
    }
  }
);
