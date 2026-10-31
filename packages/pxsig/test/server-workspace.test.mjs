/**
 * server-workspace.test.mjs — a client uses only its own workspace's server: the server's status
 * answer names its workspace (`workspaceId`), and a server that names another one, or none at the
 * default address, counts as not running. Fake servers on ephemeral ports stand in for another
 * workspace's server.
 *
 *   node --test packages/pxsig/test/server-workspace.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fixture, hasRust, tempDir, testEnv, testHome } from './fixture.mjs';
import { serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';
import { foreignServer, workspaceId } from '../src/lib/workspace/peers.mjs';
import { serverStatus } from '../src/lib/repair/apply.mjs';

/**
 * A stand-in pxsig server: `GET /__pxsig/status` answers `status`; every request is recorded.
 * @param {Record<string, unknown>} status
 */
async function fakeServer(status) {
  /** @type {string[]} */
  const seen = [];
  const s = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/__pxsig/status' ? status : {}));
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(null)));
  // Listening on TCP: the address is an AddressInfo.
  const port = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => s.close() };
}

/**
 * Record `url` as this workspace's running server (what `pxsig serve` writes).
 * @param {string} root
 * @param {string} url
 */
const recordServer = (root, url) => {
  const file = join(root, 'node_modules', '.cache', 'pxsig', 'server.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ url, pid: process.pid }));
};

test('a workspace id: 16 hex characters of its real path, the same through a symlink', () => {
  const root = tempDir('ws');
  const id = workspaceId(root);
  assert.match(id, /^[0-9a-f]{16}$/);
  const link = join(tempDir('links'), 'ws-link');
  symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(workspaceId(link), id);
  assert.notEqual(workspaceId(tempDir('other')), id);
  assert.ok(!id.includes(root), 'the id carries no path');
});

test('foreignServer: its own workspace, another one, none named', () => {
  const root = tempDir('ws');
  const url = 'http://127.0.0.1:1';
  const env = {};
  assert.equal(foreignServer({ workspaceId: workspaceId(root) }, { root, url, env }), null);
  assert.match(
    String(foreignServer({ workspaceId: 'ffffffffffffffff' }, { root, url, env })),
    /^the pxsig server at http:\/\/127\.0\.0\.1:1 serves another workspace: start `pxsig serve` in this workspace, or set PXSIG_URL/
  );
  assert.match(
    String(foreignServer({}, { root, url, env })),
    /does not say which workspace it serves \(pxsig 0\.6 or earlier\)/
  );
  // An older server this workspace's own server.json names: used.
  recordServer(root, url);
  assert.equal(foreignServer({}, { root, url, env }), null);
  // The same address answering for another workspace: server.json is stale, refused.
  assert.ok(foreignServer({ workspaceId: 'ffffffffffffffff' }, { root, url, env }));
});

test('PXSIG_URL is the person’s choice: a mismatch is one warning line, not a refusal', (t) => {
  const root = tempDir('ws');
  const url = 'http://127.0.0.1:2';
  /** @type {string[]} */
  const lines = [];
  t.mock.method(
    process.stderr,
    'write',
    (/** @type {string} */ s) =>
      (lines.push(s), true)
  );
  const env = { PXSIG_URL: url };
  assert.equal(foreignServer({ workspaceId: 'ffffffffffffffff' }, { root, url, env }), null);
  assert.equal(foreignServer({ workspaceId: 'ffffffffffffffff' }, { root, url, env }), null);
  assert.equal(foreignServer({}, { root, url, env }), null);
  assert.equal(lines.length, 1, 'warned once per address');
  assert.match(
    lines[0],
    /^pxsig: warning: the pxsig server at http:\/\/127\.0\.0\.1:2 serves another workspace \(PXSIG_URL\)/
  );
});

test('serverStatus (doctor, repair, approve --apply): another workspace’s server counts as down', async (t) => {
  const root = tempDir('ws');
  t.mock.method(process.stderr, 'write', () => true);
  const mine = await fakeServer({ workspaceId: workspaceId(root), running: false, queued: 0 });
  const other = await fakeServer({ workspaceId: 'ffffffffffffffff', running: true, queued: 3 });
  const old = await fakeServer({ running: false, queued: 0 });
  try {
    assert.deepEqual(await serverStatus(mine.url, root), { up: true, running: false, queued: 0 });
    const r = await serverStatus(other.url, root);
    assert.equal(r.up, false);
    assert.match(String(!r.up && r.foreign), /serves another workspace/);
    assert.equal((await serverStatus(old.url, root)).up, false, 'names none, not recorded here');
    recordServer(root, old.url);
    assert.equal((await serverStatus(old.url, root)).up, true, 'names none, recorded here');
    // The server's own hooks pass no root: no check.
    assert.equal((await serverStatus(other.url)).up, true);
  } finally {
    for (const s of [mine, other, old]) s.close();
  }
});

test('pxsig status: a server for another workspace at the recorded address is "down", with why, and gets no write', async () => {
  const f = fixture({ withSigs: false });
  const other = await fakeServer({ workspaceId: 'ffffffffffffffff', running: false, queued: 0 });
  try {
    recordServer(f.repo, other.url);
    const env = testEnv(testHome, { NO_COLOR: '1' });
    delete env.PXSIG_URL;
    // Not spawnSync: the fake server answers from this process's event loop.
    const out = await new Promise((ok) => {
      const p = spawn(process.execPath, [join(src, '..', 'bin', 'pxsig.mjs'), 'status'], {
        cwd: f.repo,
        env,
      });
      let text = '';
      p.stdout.on('data', (d) => (text += d));
      p.stderr.on('data', (d) => (text += d));
      p.on('close', () => ok(text));
    });
    assert.match(
      String(out),
      /down — the pxsig server at http:\/\/127\.0\.0\.1:\d+ serves another workspace/
    );
    assert.deepEqual(
      other.seen.filter((x) => !x.startsWith('GET /__pxsig/status')),
      [],
      'only the status was asked'
    );
  } finally {
    other.close();
  }
});

test(
  'pxsig serve: GET /__pxsig/status names the workspace it serves',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const S = await serve(f);
    try {
      // GET /__pxsig/status answers JSON (docs/server.md).
      const s = /** @type {{ workspaceId?: string }} */ (
        await (await fetch(`${S.base}/__pxsig/status`)).json()
      );
      assert.equal(s.workspaceId, workspaceId(f.repo));
    } finally {
      S.stop();
    }
  }
);
