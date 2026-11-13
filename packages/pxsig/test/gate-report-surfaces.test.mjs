/**
 * gate-report-surfaces.test.mjs — the gate report through each surface that hands it out, on the
 * same project (gate-report-helpers.mjs) with the real engine's `diff`:
 *
 *   - `pxsig report <id>`: writes reports/gate-report/<id>/, prints the issue link and no absolute
 *     path, opens no network connection (every socket refused in the process); `--no-image` writes
 *     no image; a second id is a usage error; without an id it is still the static dashboard.
 *   - MCP `pxsig_gate_report`: the text, the store-relative folder and the link; it says nothing
 *     was posted and to ask the person first; its description says so too.
 *   - `pxsig serve`: GET /__pxsig/gate-report (the image as a PNG data URL, or none; 409 with
 *     nothing to report) and POST /__pxsig/gate-report/self-check (answered once the re-check ran,
 *     with no path in it).
 *
 *   node --test packages/pxsig/test/gate-report-surfaces.test.mjs
 *
 * Needs the Rust binary.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { tools } from '../src/tools/index.mjs';
import { hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { ID, reportProject } from './gate-report-helpers.mjs';
import { serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

const rust = skipUnless(hasRust, 'Rust binary not built');
const cli = join(src, '..', 'bin', 'pxsig.mjs');

/** Loaded first in the CLI's process: any socket it opens fails the command, and says so. */
const offline = join(tempDir('offline'), 'offline.mjs');
writeFileSync(
  offline,
  `import net from 'node:net';
const refuse = () => { process.stderr.write('NETWORK USED\\n'); process.exit(97); };
net.Socket.prototype.connect = refuse;
globalThis.fetch = refuse;
`
);

/**
 * `pxsig <args>` in `cwd`, with no network.
 * @param {string} cwd
 * @param {string[]} args
 */
const pxsig = (cwd, args) =>
  spawnSync(process.execPath, ['--import', offline, cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: testEnv(testHome, { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' }),
  });

test('pxsig report <id>: the files, the link, no path, no network', { skip: rust }, (t) => {
  const { root, px } = reportProject(t);
  const r = pxsig(root, ['report', ID, '--plain']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes('NETWORK USED'));
  assert.match(
    r.stdout,
    /https:\/\/github\.com\/hydrotik\/pxsig\/issues\/new\?template=gate\.yml&/
  );
  assert.match(r.stdout, /entry-1 · mode dark/);
  assert.match(r.stdout, /Nothing was posted\./);
  assert.ok(!r.stdout.includes(root), 'no absolute path');
  const dir = join(px, 'reports', 'gate-report', ID);
  for (const f of ['report.md', 'report.json', 'image.png']) assert.ok(existsSync(join(dir, f)), f);

  const j = pxsig(root, ['report', ID, '--no-image', '--json']);
  assert.equal(j.status, 0, j.stderr);
  const out = JSON.parse(j.stdout);
  assert.equal(out.image, null);
  assert.equal(out.folder, `reports/gate-report/${ID}/`);
  assert.ok(!existsSync(join(dir, 'image.png')), 'image-free: the image is gone');
  assert.match(out.text, /baseline #1f7a43 → render #7a1f6a/);

  const k = pxsig(root, ['report', ID, '--keep-id', '--full', '--json']);
  assert.equal(JSON.parse(k.stdout).text.includes(ID), true);

  const two = pxsig(root, ['report', ID, 'other--entry']);
  assert.equal(two.status, 2);
  assert.match(two.stderr, /usage: pxsig report <id>/);
  const none = pxsig(root, ['report', 'nope--entry']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no check result for nope--entry/);
});

test(
  'pxsig_gate_report: text, store-relative folder, link; it never posts and says to ask',
  {
    skip: rust,
  },
  async (t) => {
    const { root, P } = reportProject(t);
    const tool =
      /** @type {{ description: string, run: (a: object) => Promise<Record<string, unknown>> }} */ (
        /** @type {unknown} */ (tools.find((x) => x.name === 'pxsig_gate_report'))
      );
    assert.match(tool.description, /Never posts anything/);
    assert.match(tool.description, /ask the person before anything is posted/);
    const prev = process.env.PXSIG_BIN;
    const cwd = process.cwd();
    process.env.PXSIG_BIN = rustBin;
    process.chdir(root);
    try {
      const r = await tool.run({ id: ID });
      assert.equal(r.folder, `reports/gate-report/${ID}/`);
      assert.equal(r.image, `reports/gate-report/${ID}/image.png`);
      assert.match(
        String(r.url),
        /^https:\/\/github\.com\/hydrotik\/pxsig\/issues\/new\?template=gate\.yml/
      );
      assert.match(
        String(r.note),
        /Nothing was posted\. .*Ask the person before anything is posted/
      );
      assert.ok(!JSON.stringify(r).includes(root), 'no absolute path');
      assert.ok(existsSync(join(P.store.root, String(r.image))));
      await assert.rejects(tool.run({ id: '../x' }), /bad id/);
    } finally {
      process.chdir(cwd);
      if (prev === undefined) delete process.env.PXSIG_BIN;
      else process.env.PXSIG_BIN = prev;
    }
  }
);

test('the server: GET gate-report and POST gate-report/self-check', { skip: rust }, async (t) => {
  const { root } = reportProject(t);
  const S = await serve({ repo: root, env: testEnv(testHome) });
  try {
    const get = async (/** @type {string} */ q) => {
      const r = await fetch(`${S.base}/__pxsig/gate-report?${q}`);
      return { status: r.status, body: /** @type {Record<string, unknown>} */ (await r.json()) };
    };
    const a = await get(`id=${encodeURIComponent(ID)}`);
    assert.equal(a.status, 200);
    assert.match(String(a.body.image), /^data:image\/png;base64,/);
    const png = PNG.sync.read(Buffer.from(String(a.body.image).split(',')[1], 'base64'));
    assert.ok(png.width > png.height, 'three panels side by side');
    assert.match(String(a.body.text), /entry-1 · mode dark/);
    assert.ok(!JSON.stringify(a.body).includes(root), 'no absolute path');
    const b = await get(`id=${encodeURIComponent(ID)}&noImage=1&keepId=1`);
    assert.equal(b.body.image, null);
    assert.match(String(b.body.text), new RegExp(ID));
    assert.equal((await get('id=nope--entry')).status, 409);
    assert.equal((await get('id=..%2Fx')).status, 400);

    // No Storybook here: the re-check runs and fails, and the answer says so, with no path.
    const c = await S.post('gate-report/self-check', { id: ID }, { 'x-pxsig-token': '' });
    assert.equal(c.status, 200);
    const body = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (c.body));
    assert.ok(['error', 'not-checked'].includes(String(body.state)), String(body.state));
    assert.ok(!JSON.stringify(body).includes(root), 'no absolute path');
    assert.equal((await S.post('gate-report/self-check', { id: '../x' })).status, 400);
  } finally {
    S.stop();
  }
});
