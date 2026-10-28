/**
 * pii.test.mjs — pxsig writes no personal data into what a repository commits (decision 82): no git
 * email, no user name, no host name, no home path. Approval lines carry the pxsig version that
 * wrote them (decision 92), and `by` only when a team asks for it (`approvals.identity`, decision 81).
 *
 *   node --test packages/pxsig/test/pii.test.mjs
 *
 * The server part needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { record, snapshot } from '../src/lib/approvals.mjs';
import { collectEnv } from '../src/lib/env.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { openProject, PXSIG_VERSION, satisfies } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';
/** @import { PsigHeader } from '../src/types.js' */

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const EMAIL = 'pii-probe@example.invalid';
const git = spawnSync('git', ['--version']).status === 0;

/** A fixture that is a real git repository whose git email is the probe. */
function gitFixture() {
  const f = fixture();
  spawnSync('git', ['init', '-q', f.repo]);
  spawnSync('git', ['-C', f.repo, 'config', 'user.email', EMAIL]);
  spawnSync('git', ['-C', f.repo, 'config', 'user.name', 'PII Probe']);
  return f;
}

const lines = (f) =>
  readFileSync(join(f.px, 'approvals.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
const setConfig = (f, patch) => {
  const p = join(f.repo, 'pxsig.config.json');
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), ...patch }, null, 2));
};

test(
  'approval lines: no `by` unless approvals.identity asks for it; the pxsig version always',
  { skip: !git && 'no git' },
  () => {
    const f = gitFixture();
    const entry = f.manifest.stories.find((e) => e.id === f.ids.ok);
    let P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
    record(P, entry, { batch: 'b1', via: 'cli', before: snapshot(P, entry, 'b1').before });
    assert.equal(lines(f).at(-1).by, undefined);
    assert.equal(lines(f).at(-1).pxsig, PXSIG_VERSION);
    setConfig(f, { approvals: { identity: 'git-email' } });
    P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
    record(P, entry, { batch: 'b2', via: 'cli', before: snapshot(P, entry, 'b2').before });
    assert.equal(lines(f).at(-1).by, EMAIL, 'a team that asked for it gets the git email');
  }
);

test('approvals.level: standard only, for now; strict is refused as not available yet', () => {
  const f = fixture({ withSigs: false });
  setConfig(f, { approvals: { level: 'strict' } });
  assert.throws(
    () => openProject({ cwd: f.repo, env: {} }),
    /approvals\.level "strict" is not available yet/
  );
  setConfig(f, { approvals: { level: 'standard', identity: 'everyone' } });
  assert.throws(() => openProject({ cwd: f.repo, env: {} }), /approvals\.identity must be/);
});

test('requires: a range this pxsig reads, and refuses outside', () => {
  assert.equal(satisfies('0.4.0', '>=0.4.0'), true);
  assert.equal(satisfies('0.3.2', '>=0.4.0'), false);
  assert.equal(satisfies('0.5.1', '>=0.4.0 <0.6.0'), true);
  assert.equal(satisfies('0.6.0', '>=0.4.0 <0.6.0'), false);
  assert.equal(satisfies('0.3.2', '0.3.2 || >=0.4.0'), true);
  assert.equal(satisfies('0.4.0', '^0.4'), null, 'a range form it does not read');
  const ws = mkdtempSync(join(tmpdir(), 'pxsig-requires-'));
  writeFileSync(
    join(ws, 'pxsig.workspace.json'),
    JSON.stringify({ version: 1, requires: '>=99.0.0', projects: {} })
  );
  const cli = join(src, '..', 'bin', 'pxsig.mjs');
  const r = spawnSync(process.execPath, [cli, 'projects', '--json'], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...process.env, PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1' },
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr + r.stdout, /requires pxsig >=99\.0\.0; this is pxsig/);
});

// --- the server's write paths, then a scan of everything a repository would commit ------------------

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

const raw = (port, { method = 'GET', path, headers = {}, body }) =>
  new Promise((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () =>
          ok({ status: res.statusCode, headers: res.headers, text: s, json: () => JSON.parse(s) })
        );
      }
    );
    req.on('error', fail);
    req.end(data);
  });

/** Files a repository commits from the store and the project: everything but run output. */
function committed(f) {
  const out = [];
  const skip = new Set([
    '.git',
    'node_modules',
    'renders',
    'diffs',
    'reports',
    'cache',
    'history',
    'trash',
  ]);
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(f.repo);
  return out;
}

test(
  'nothing a repository commits names the person, the user or the machine',
  { skip: (!hasRust || !git) && 'needs the Rust binary and git' },
  async () => {
    const f = gitFixture();
    // The render environment as this machine produces it (real OS facts; a stand-in browser), on the
    // row the server approves below: it goes into the committed baseline's header.
    const probe = {
      setContent: async () => {},
      evaluate: async (_fn, a) =>
        a?.families
          ? {
              widths: Object.fromEntries(a.families.map((x) => [x, [1, 2, 3]])),
              renderer: `ANGLE (${hostname()} GPU)`,
              colorGamut: 'srgb',
              timezone: 'UTC',
              locale: 'en-US',
            }
          : null,
    };
    const browser = {
      version: () => '141.0.1',
      browserType: () => ({ name: () => 'chromium' }),
      newContext: async () => ({ newPage: async () => probe, close: async () => {} }),
    };
    const renderEnv = await collectEnv(browser, { pxsig: PXSIG_VERSION });
    const checkPath = join(f.px, 'reports', 'check.json');
    const check = JSON.parse(readFileSync(checkPath, 'utf8'));
    check.envs = { [renderEnv.id]: renderEnv };
    check.rows = check.rows.map((r) => (r.id === f.ids.changed ? { ...r, env: renderEnv.id } : r));
    writeFileSync(checkPath, JSON.stringify(check));
    const port = await freePort();
    const dash = mkdtempSync(join(tmpdir(), 'pxsig-dash-'));
    writeFileSync(
      join(dash, 'index.html'),
      '<!doctype html><html><head><title>pxsig</title></head><body></body></html>'
    );
    const proc = spawn(
      process.execPath,
      [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
      {
        cwd: f.repo,
        env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_DASHBOARD_DIR: dash },
      }
    );
    let log = '';
    proc.stdout.on('data', (d) => (log += d));
    proc.stderr.on('data', (d) => (log += d));
    await new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
      proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
    });
    const url = `http://127.0.0.1:${port}`;
    const exited = new Promise((ok) => proc.on('exit', ok));
    try {
      const token = readToken(f.repo, url);
      // `pxsig approve apply` (the CLI's token) and the dashboard (the dashboard link's cookie).
      assert.equal(
        (
          await raw(port, {
            method: 'POST',
            path: '/__pxsig/approve',
            headers: { 'x-pxsig-token': token },
            body: { id: f.ids.changed },
          })
        ).status,
        200
      );
      const link = (
        await raw(port, {
          method: 'POST',
          path: '/__pxsig/ticket',
          headers: { 'x-pxsig-token': token },
        })
      ).json().link;
      const tab = { origin: url, 'sec-fetch-site': 'same-origin' };
      const cookie = (
        await raw(port, {
          method: 'POST',
          path: '/__pxsig/session',
          headers: tab,
          body: { ticket: link.split('#ticket=')[1] },
        })
      ).headers['set-cookie'][0].split(';')[0];
      assert.equal(
        (
          await raw(port, {
            method: 'POST',
            path: '/__pxsig/a11y-accept',
            headers: { ...tab, cookie },
            body: { id: f.ids.a11y },
          })
        ).status,
        200
      );
      assert.ok(
        !log.includes(token) && !log.includes(cookie.split('=')[1]),
        'no token or cookie in the server log'
      );
    } finally {
      proc.kill('SIGTERM');
      await exited;
    }
    const probes = [
      ['the git email', EMAIL],
      ['the home folder', homedir()],
      ['the host name', hostname()],
      ...(userInfo().username.length >= 4 ? [['the user name', userInfo().username]] : []),
    ];
    const files = committed(f);
    assert.ok(
      files.some((p) => p.endsWith('approvals.ndjson')),
      'the approval log was written'
    );
    const { readHeader } = await import('../src/lib/psig.mjs');
    assert.equal(
      // The approval just wrote it.
      /** @type {PsigHeader} */ (readHeader(f.sig(f.ids.changed))).env?.id,
      renderEnv.id,
      'the approved baseline records the render environment, scanned below'
    );
    for (const file of files) {
      const text = readFileSync(file, 'latin1');
      for (const [what, value] of probes) {
        const at = new RegExp(
          `(^|[^\\w.-])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.-])`
        ).test(text);
        assert.ok(!at, `${relative(f.repo, file)} names ${what}`);
      }
    }
    for (const l of lines(f)) {
      assert.equal(l.by, undefined, 'no by on any line');
      assert.equal(l.pxsig, PXSIG_VERSION);
    }
  }
);

test(
  'a log line from before 0.4.0 still reads; verify names the pxsig that wrote it',
  { skip: !git && 'no git' },
  async () => {
    const f = gitFixture();
    const entry = f.manifest.stories.find((e) => e.id === f.ids.ok);
    const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
    record(P, entry, { batch: 'b1', via: 'cli', before: null });
    const { verify } = await import('../src/lib/approvals.mjs');
    // An older teammate's line: `by` and no `pxsig`, then the baseline changed under it.
    const old = { ...lines(f).at(-1), by: 'dev@example.com', after: '0'.repeat(64) };
    delete old.pxsig;
    writeFileSync(join(f.px, 'approvals.ndjson'), `${JSON.stringify(old)}\n`);
    const v = verify(P, { stories: [entry] });
    assert.equal(v.mismatched.length, 1);
    assert.equal(v.mismatched[0].writtenBy, null);
    assert.equal(v.mismatched[0].older, true);
    assert.ok(existsSync(join(f.px, 'approvals.ndjson')));
  }
);
