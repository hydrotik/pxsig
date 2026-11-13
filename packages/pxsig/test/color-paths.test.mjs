/**
 * color-paths.test.mjs — the color rule on every path that makes a verdict: `pxsig check` (no
 * server), a re-check through `pxsig serve`, and the MCP tool pxsig_check through that server. Each
 * renders an entry with the stand-in Storybook, recolors that render (the box's blue moved at
 * about the same lightness, ΔE00 12.8, under every luminance rule) into its baseline, and checks it
 * again: the row fails with a color reason and records the rule it was judged by.
 *
 *   node --test packages/pxsig/test/color-paths.test.mjs
 *
 * Needs the Rust binary and Chromium.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { PNG } from 'pngjs';

import { fixture, rustBin } from './fixture.mjs';
import { fakeStorybook, needs, rowsOf, serve, src } from './server-helpers.mjs';

/** @typedef {ReturnType<typeof fixture>} Fixture */
/** @typedef {{ id: string, pass: boolean, reasons?: string[], gate?: { color?: unknown }, color?: unknown }} Row */

const BOX = [42, 74, 122]; // the stand-in Storybook's box (#2a4a7a)
const TINT = [42, 84, 100];

/**
 * The entry's baseline, made from its latest render with the box recolored.
 * @param {Fixture} f
 * @param {string} id
 */
function tintBaseline(f, id) {
  const png = join(f.px, 'renders', 'latest', `${id}.png`);
  const img = PNG.sync.read(readFileSync(png));
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4)
    if (BOX.every((c, k) => img.data[i + k] === c)) {
      img.data.set(TINT, i);
      n++;
    }
  assert.ok(n > 1000, `the render shows the box (${n} px)`);
  const tinted = join(f.px, 'renders', `${id}.tinted.png`);
  writeFileSync(tinted, PNG.sync.write(img));
  const sig = JSON.parse(readFileSync(join(f.px, 'manifest.json'), 'utf8')).stories.find(
    (/** @type {{ id: string }} */ e) => e.id === id
  ).sig;
  const r = spawnSync(
    rustBin,
    ['capture', tinted, '--out', join(f.repo, sig), '--grid', '16', '--detail'],
    {
      encoding: 'utf8',
    }
  );
  assert.equal(r.status, 0, r.stderr);
}

/** @param {Row | undefined} row */
function assertColorFail(row) {
  assert.ok(row, 'the entry has a row');
  assert.equal(row.pass, false, JSON.stringify(row));
  assert.ok(
    row.reasons?.length && row.reasons.every((x) => x.startsWith('color ')),
    `only the color rule fails it: ${JSON.stringify(row.reasons)}`
  );
  assert.deepEqual(row.gate?.color, { deltaE: 3, minArea: 64, cellDeltaE: 5, minCells: 3 });
  assert.ok(row.color && typeof row.color === 'object', 'its measurements are recorded');
}

/** @param {Fixture} f @param {string} url */
function useStorybook(f, url) {
  const p = join(f.repo, 'pxsig.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...cfg, storybook: { url } }, null, 2));
}

/**
 * `pxsig check --full --only <id> --no-server`: spawned without blocking, as the stand-in Storybook answers
 * from this process.
 * @param {Fixture} f
 * @param {string} id
 */
async function cliCheck(f, id) {
  const p = spawn(
    process.execPath,
    [join(src, 'check.mjs'), '--full', '--only', id, '--retries', '0', '--no-server'],
    {
      cwd: f.repo,
      env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_URL: 'http://127.0.0.1:1' },
    }
  );
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  const code = await new Promise((ok) => p.on('close', ok));
  assert.ok(code === 0 || code === 1, `${code}\n${out}`);
}

test(
  'pxsig check: a recolored baseline fails on the color rule',
  { skip: needs, timeout: 120_000 },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    useStorybook(f, sb.url);
    await cliCheck(f, f.ids.ok);
    tintBaseline(f, f.ids.ok);
    await cliCheck(f, f.ids.ok);
    assertColorFail(rowsOf(f).find((/** @type {Row} */ x) => x.id === f.ids.ok));
  }
);

test(
  'pxsig serve: a re-check of a recolored baseline fails on the color rule',
  { skip: needs, timeout: 120_000 },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    t.after(async () => (await S.stop(), sb.close()));
    assert.equal((await S.post('check', { ids: [f.ids.ok] })).status, 202);
    await S.idle();
    tintBaseline(f, f.ids.ok);
    assert.equal((await S.post('check', { ids: [f.ids.ok] })).status, 202);
    await S.idle();
    assertColorFail(rowsOf(f).find((/** @type {Row} */ x) => x.id === f.ids.ok));
  }
);

test(
  'pxsig_check (MCP, through the server): a recolored baseline fails on the color rule',
  { skip: needs, timeout: 180_000 },
  async (t) => {
    const f = fixture({ t });
    const sb = await fakeStorybook(f.index.stories);
    const S = await serve(f, { storybook: sb.url });
    t.after(async () => (await S.stop(), sb.close()));
    assert.equal((await S.post('check', { ids: [f.ids.ok] })).status, 202);
    await S.idle();
    tintBaseline(f, f.ids.ok);
    const proc = spawn(process.execPath, [join(src, 'mcp.mjs')], {
      cwd: f.repo,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...f.env, PXSIG_URL: S.base, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
    });
    t.after(() => proc.kill());
    const answer = new Promise((ok) => {
      createInterface({ input: proc.stdout }).on('line', (line) => {
        const m = JSON.parse(line);
        if (m.id === 1) ok(m.result);
      });
    });
    proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pxsig_check', arguments: { ids: [f.ids.ok], timeout_s: 90 } } })}\n`
    );
    const r = /** @type {{ isError?: boolean, content: { text: string }[] }} */ (await answer);
    assert.ok(!r.isError, r.content[0].text);
    assert.equal(JSON.parse(r.content[0].text).via, 'server');
    assertColorFail(rowsOf(f).find((/** @type {Row} */ x) => x.id === f.ids.ok));
  }
);
