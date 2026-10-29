// The store lock, a full check through the server's queue, several projects (a shared story, read
// and write commands across projects) and `check --changed` rows. Temp folders only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reconcile } from '../src/lib/integrity.mjs';
import { acquireLock, lockPath, readLock } from '../src/lib/lock.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { src, env, tree, node, cli, twoProjects } from './features-helpers.mjs';
/** @import { LockState, Project } from '../src/types.js' */
/** @import { AddressInfo } from 'node:net' */

// --- the store lock ------------------------------------------------------------------------------------------

test('store lock: one holder; a dead holder is stale and taken over', () => {
  const root = tree({
    'pxsig.config.json': {},
    '.pxsig/manifest.json': {
      version: 2,
      stories: [{ id: 'a--b', sig: '.pxsig/baselines/a--b.psig' }],
    },
  });
  const P = openProject({ cwd: root, env });
  const l = acquireLock(P, { holder: 'test' });
  // Taken just above.
  assert.equal(/** @type {LockState} */ (readLock(P)).pid, process.pid);
  l.release();
  assert.equal(readLock(P), null);
  // A live process holds it: refused, naming the holder.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
  writeFileSync(
    lockPath(P),
    JSON.stringify({
      pid: child.pid,
      startedAt: new Date(Date.now() + 5000).toISOString(),
      holder: 'check',
      command: 'pxsig check --full',
    })
  );
  try {
    assert.throws(() => acquireLock(P, { holder: 'test' }), /pxsig check --full.*holds the store/);
    const r = node([join(src, 'check.mjs'), '--changed', 'x.ts'], root);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /holds the store/);
  } finally {
    child.kill();
  }
  // Gone: stale, taken over.
  writeFileSync(
    lockPath(P),
    JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: new Date().toISOString(), holder: 'check' })
  );
  assert.equal(/** @type {LockState} */ (readLock(P)).stale, true);
  acquireLock(P, { holder: 'test' }).release();
});

test(
  'a full check against a project the server holds goes through its queue',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const ids = [f.ids.ok, f.ids.drift];
    /** @type {{ ids: string[], project: string }[]} */
    const posted = [];
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/__pxsig/check') {
          const b = JSON.parse(body);
          posted.push(b);
          const check = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8'));
          for (const r of check.rows)
            if (b.ids.includes(r.id))
              Object.assign(r, {
                pass: r.id !== f.ids.drift,
                reasons: r.id === f.ids.drift ? ['ssim 0.5 < min 0.99'] : [],
              });
          writeFileSync(join(f.px, 'reports', 'check.json'), JSON.stringify(check));
          res.writeHead(202).end(JSON.stringify({ queued: b.ids }));
        } else
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ running: false, queued: 0 }));
      });
    });
    await /** @type {Promise<void>} */ (new Promise((r) => srv.listen(0, '127.0.0.1', r)));
    // Listening on TCP: the address is an AddressInfo.
    const url = `http://127.0.0.1:${/** @type {AddressInfo} */ (srv.address()).port}`;
    writeFileSync(
      join(f.px, 'reports', '.lock'),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date(Date.now() - 1000).toISOString(),
        holder: 'serve',
        url,
      })
    );
    const out = await new Promise((ok) => {
      const p = spawn(process.execPath, [join(src, 'check.mjs'), '--only', ids.join(',')], {
        cwd: f.repo,
        env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
      });
      let log = '';
      p.stdout.on('data', (d) => (log += d));
      p.stderr.on('data', (d) => (log += d));
      p.on('exit', (code) => ok({ code, log }));
    });
    srv.close();
    assert.equal(out.code, 1, out.log);
    assert.match(out.log, /holds this store: queueing 2 entries/);
    assert.deepEqual(posted[0].ids.sort(), [...ids].sort());
    assert.equal(posted[0].project, 'fixture');
    // --update never goes through the server: it refuses.
    const upd = node([join(src, 'check.mjs'), '--suite', 'x'], f.repo);
    assert.equal(upd.status, 2);
  }
);

// --- CLI over several projects ----------------------------------------------------------------------------

test(
  'the server: a story two projects share is answered for the project asked about',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    /** @param {string} name */
    const proj = (name) => ({
      [`packages/${name}/pxsig.config.json`]: { storybook: { url: 'http://127.0.0.1:1' } },
      [`packages/${name}/.pxsig/manifest.json`]: {
        version: 2,
        stories: [
          {
            id: 'shared-story--a',
            story: 'shared-story--a',
            sig: `packages/${name}/.pxsig/baselines/shared-story--a.psig`,
          },
        ],
      },
    });
    const root = tree({
      'pxsig.workspace.json': { projects: { ui: 'packages/ui', forms: 'packages/forms' } },
      ...proj('ui'),
      ...proj('forms'),
    });
    const port = await new Promise((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        // Listening on TCP: the address is an AddressInfo.
        const p = /** @type {AddressInfo} */ (s.address()).port;
        s.close(() => ok(p));
      });
    });
    const proc = spawn(
      process.execPath,
      [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
      { cwd: root, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
    );
    try {
      await /** @type {Promise<void>} */ (
        new Promise((ok, fail) => {
          let log = '';
          const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
          proc.stdout.on(
            'data',
            (d) => ((log += d), /dashboard →/.test(log) && (clearTimeout(t), ok()))
          );
          proc.stderr.on('data', (d) => (log += d));
        })
      );
      for (const project of ['ui', 'forms']) {
        const r = await fetch(
          `http://127.0.0.1:${port}/__pxsig/integrity?project=${project}&story=shared-story--a`
        );
        assert.equal(r.status, 200);
        assert.equal(/** @type {{ project: string }} */ (await r.json()).project, project);
      }
    } finally {
      proc.kill();
    }
  }
);

test('read commands cover every project when none is chosen; rows carry the project', () => {
  const root = twoProjects();
  const r = cli(['list', 'all', '--json'], root);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepEqual(d.projects.map((/** @type {{ project: string }} */ p) => p.project).sort(), [
    'forms',
    'ui',
  ]);
  assert.equal(
    d.projects.find((/** @type {{ project: string }} */ p) => p.project === 'ui').total,
    2
  );
  const md = cli(['list', '--markdown', 'all'], root);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /\| Project \| State \| Entry \|/);
  assert.match(md.stdout, /\| ui \| .* \| ui-button--b /);
  assert.match(md.stdout, /\| forms \| /);
  // Inside one project's folder, only that project; --all widens it again.
  assert.equal(
    JSON.parse(cli(['list', 'all', '--json'], join(root, 'packages/ui')).stdout).total,
    2
  );
  assert.equal(
    JSON.parse(cli(['list', 'all', '--all', '--json'], join(root, 'packages/ui')).stdout).projects
      .length,
    2
  );
  // --workspace from anywhere.
  const away = cli(['status', '--json', '--workspace', root], tmpdir());
  assert.equal(away.status, 0, away.stderr);
  assert.equal(JSON.parse(away.stdout).projects.length, 2);
});

test('write commands refuse without a project; report errors exit 2', () => {
  const root = twoProjects();
  for (const args of [['check', 'ui-button--a'], ['approve', 'log'], ['manifest'], ['config']]) {
    const r = cli(args, root);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /choose it with --project|choose one with --project/);
  }
  assert.equal(cli(['report', '--project', 'nope'], root).status, 2);
});

test(
  'check --changed records unaffected entries with a baseline as skipped-unaffected, not never-checked',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const r = node([join(src, 'check.mjs'), '--changed', 'src/elsewhere/Unrelated.ts'], f.repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rows = new Map(
      JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows.map(
        (/** @type {{ id: string }} */ x) => [x.id, x]
      )
    );
    assert.equal(rows.get(f.ids.never).unaffected, true);
    assert.equal(rows.get(f.ids.never).note, 'skipped-unaffected');
    assert.equal(rows.get(f.ids.ok).inherited, true, 'a previous verdict is still carried forward');
    assert.ok(!rows.get(f.ids.unbaselined).unaffected, 'no baseline: not ok-but-unverified');
    const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
    // The ledger lists every manifest entry: `never` is there.
    const never = /** @type {NonNullable<ReturnType<typeof led.entries.find>>} */ (
      led.entries.find((x) => x.id === f.ids.never)
    );
    assert.ok(!never.issues.some((i) => i.code === 'never-checked'), JSON.stringify(never.issues));
    assert.ok(never.issues.some((i) => i.code === 'skipped-unaffected'));
    assert.ok(!existsSync(join(f.px, 'reports', '.lock')), 'the lock is released');
  }
);
