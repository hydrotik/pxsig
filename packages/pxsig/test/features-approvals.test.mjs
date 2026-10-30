// `approve plan --new`, `approve undo` from git, undo with ids, the server's undo and refusing a
// failed render. Temp folders only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readLog, record, snapshot, undo } from '../src/lib/approvals.mjs';
import { readToken } from '../src/lib/guard.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { src, env, tree, cli } from './features-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { ApprovalLine, ManifestEntry, Project } from '../src/types.js' */
/** @import { AddressInfo } from 'node:net' */

// --- approve plan --new ------------------------------------------------------------------------------------------

test('approve plan --new plans first baselines: blocked unless named or --first-baselines', () => {
  const f = fixture({ withSigs: false });
  /** @param {string[]} extra */
  const plan = (extra) =>
    JSON.parse(
      cli(
        [
          'approve',
          'plan',
          '--new',
          '--reason',
          'first renders of the new stories',
          '--json',
          ...extra,
        ],
        f.repo
      ).stdout
    );
  const p1 = plan([]);
  const e1 = p1.entries.find((/** @type {{ id: string }} */ e) => e.id === f.ids.unbaselined);
  assert.equal(e1.status, 'blocked');
  assert.equal(e1.kind, 'shape');
  assert.match(e1.why, /first baseline.*--first-baselines/);
  assert.ok(
    !p1.entries.some((/** @type {{ id: string }} */ e) => e.id === f.ids.ok),
    'only NEW entries'
  );
  const e2 = plan(['--first-baselines']).entries.find(
    (/** @type {{ id: string }} */ e) => e.id === f.ids.unbaselined
  );
  assert.equal(e2.status, 'ok');
  assert.equal(e2.first, true);
  assert.equal(e2.baseSha, null);
  const e3 = plan(['--allow-shape', f.ids.unbaselined]).entries.find(
    (/** @type {{ id: string }} */ e) => e.id === f.ids.unbaselined
  );
  assert.equal(e3.status, 'ok');
  // apply stays a person's job
  assert.equal(cli(['approve', 'apply'], f.repo).status, 3);
});

// --- approve undo from git -------------------------------------------------------------------------------------

test('approve undo restores from git when the local snapshot is gone, only on a matching sha256', () => {
  const root = tree({ 'pxsig.config.json': { name: 'g' } });
  rmSync(join(root, '.git'), { recursive: true });
  /** @param {...string} a */
  const git = (...a) =>
    spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a],
      { cwd: root, encoding: 'utf8' }
    );
  git('init', '-q');
  const P = openProject({ cwd: root, env });
  const ids = ['a-b--one', 'a-b--two', 'a-b--new'];
  const entries = ids.map((id) => ({ id, sig: `.pxsig/baselines/B/${id}.psig` }));
  const manifest = { stories: entries };
  /** @param {string} id */
  const file = (id) => join(root, `.pxsig/baselines/B/${id}.psig`);
  mkdirSync(dirname(file(ids[0])), { recursive: true });
  writeFileSync(file(ids[0]), 'v1-one');
  writeFileSync(file(ids[1]), 'v1-two');
  git('add', '-A');
  git('commit', '-qm', 'v1');
  // A batch approves new bytes for all three (the third is a first baseline), then is committed.
  for (const e of entries) {
    const { before } = snapshot(P, e, 'b2');
    writeFileSync(file(e.id), `v2-${e.id}`);
    record(P, e, { batch: 'b2', via: 'test', before });
  }
  git('add', '-A');
  git('commit', '-qm', 'v2');
  // Another machine: no history/ folder. One log line's `before` does not match any commit.
  rmSync(P.store.history, { recursive: true, force: true });
  const log = readLog(P);
  /** @param {string} s */
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(log[0].before, sha('v1-one'));
  assert.ok(log[0].gitHead, 'the git HEAD is logged');
  log[1].before = sha('never committed');
  writeFileSync(P.store.approvals, `${log.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const res = undo(P, manifest, 'b2');
  assert.equal(res.source, 'git');
  assert.deepEqual(res.restored, [ids[0]]);
  assert.equal(readFileSync(file(ids[0]), 'utf8'), 'v1-one');
  assert.deepEqual(
    // undo's `refused`: [{ id, why }] (its doc comment).
    /** @type {{ id: string }[]} */ (res.refused).map((r) => r.id),
    [ids[1]]
  );
  assert.equal(readFileSync(file(ids[1]), 'utf8'), `v2-${ids[1]}`, 'a refused entry is left alone');
  assert.deepEqual(res.removed, [ids[2]], 'a first baseline is undone by moving it to trash/');
  assert.ok(!existsSync(file(ids[2])));
});

test('undo with ids restores only those entries of a batch (the dashboard undoes one approval)', () => {
  const root = tree({ 'pxsig.config.json': { name: 'u' } });
  const P = openProject({ cwd: root, env });
  const ids = ['a-b--one', 'a-b--two', 'a-b--first'];
  const entries = ids.map((id) => ({ id, sig: `.pxsig/baselines/B/${id}.psig` }));
  const manifest = { stories: entries };
  /** @param {string} id */
  const file = (id) => join(root, `.pxsig/baselines/B/${id}.psig`);
  mkdirSync(dirname(file(ids[0])), { recursive: true });
  writeFileSync(file(ids[0]), 'v1-one');
  writeFileSync(file(ids[1]), 'v1-two');
  for (const e of entries) {
    const { before } = snapshot(P, e, 'b3');
    writeFileSync(file(e.id), `v2-${e.id}`);
    record(P, e, { batch: 'b3', via: 'test', before });
  }
  // undo's `ids` defaults to null; it takes entry ids.
  const one =
    /** @type {(P: Project, manifest: { stories: { id: string, sig: string }[] }, batch: string, opts?: { git?: boolean, ids?: string[] | null }) => ReturnType<typeof undo>} */ (
      undo
    )(P, manifest, 'b3', { git: false, ids: [ids[0]] });
  assert.deepEqual(one.restored, [ids[0]]);
  assert.equal(readFileSync(file(ids[0]), 'utf8'), 'v1-one');
  assert.equal(
    readFileSync(file(ids[1]), 'utf8'),
    `v2-${ids[1]}`,
    'the rest of the batch is left alone'
  );
  const first =
    /** @type {(P: Project, manifest: { stories: { id: string, sig: string }[] }, batch: string, opts?: { git?: boolean, ids?: string[] | null }) => ReturnType<typeof undo>} */ (
      undo
    )(P, manifest, 'b3', { git: false, ids: [ids[2]] });
  assert.deepEqual(first.removed, [ids[2]], 'a first baseline goes to trash/');
  assert.ok(!existsSync(file(ids[2])));
  assert.ok(existsSync(file(ids[1])));
});

test(
  'the server: undoing an approval restores the baseline it replaced, and logs the undo',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const id = f.ids.unrecoverable;
    // The fixture's manifest holds that id.
    const file = join(
      f.repo,
      /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id)).sig
    );
    const original = readFileSync(file);
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
      { cwd: f.repo, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
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
      /** @param {string} action */
      const post = async (action) => {
        const r = await fetch(`http://127.0.0.1:${port}/__pxsig/${action}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // The server wrote its token when it started.
            'x-pxsig-token': /** @type {string} */ (readToken(f.repo, `http://127.0.0.1:${port}`)),
          },
          body: JSON.stringify({ id }),
        });
        return { status: r.status, body: await r.json() };
      };
      assert.equal((await post('approve')).status, 200);
      assert.notDeepEqual(
        readFileSync(file),
        original,
        'approve wrote the latest render as the baseline'
      );
      const undone = await post('unreview');
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.deepEqual(
        readFileSync(file),
        original,
        'undo restored the previous baseline, byte for byte'
      );
      const log = readLog({ store: { approvals: join(f.px, 'approvals.ndjson') } });
      // The undo just logged a line.
      assert.equal(/** @type {ApprovalLine} */ (log.at(-1)).via, 'undo');
      assert.match(/** @type {ApprovalLine} */ (log.at(-1)).batch, /-undo$/);
    } finally {
      proc.kill();
    }
  }
);

test(
  'the server refuses to approve an entry whose render failed, and leaves its baseline alone',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const id = f.ids.unrecoverable;
    // The fixture's manifest holds that id.
    const file = join(
      f.repo,
      /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id)).sig
    );
    const original = readFileSync(file);
    const checkFile = join(f.px, 'reports', 'check.json');
    const report = JSON.parse(readFileSync(checkFile, 'utf8'));
    report.rows = report.rows.map((/** @type {{ id: string }} */ r) =>
      r.id === id
        ? {
            ...r,
            pass: false,
            changed: false,
            error: 'storybook-error: Vite error overlay: Failed to resolve import',
          }
        : r
    );
    writeFileSync(checkFile, JSON.stringify(report));
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
      { cwd: f.repo, env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } }
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
      const r = await fetch(`http://127.0.0.1:${port}/__pxsig/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The server wrote its token when it started.
          'x-pxsig-token': /** @type {string} */ (readToken(f.repo, `http://127.0.0.1:${port}`)),
        },
        body: JSON.stringify({ id }),
      });
      // The server's error answer: { error }.
      const body = /** @type {{ error: string }} */ (await r.json());
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.match(body.error, /did not render/);
      assert.deepEqual(readFileSync(file), original, 'the baseline is untouched');
    } finally {
      proc.kill();
    }
  }
);
