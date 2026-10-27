/**
 * crash.test.mjs — what a crash, a full disk or a second writer leaves behind, and what pxsig makes
 * of it: whole-file writes, log lines cut short (`log-torn`), approvals stopped before their log
 * line (`interrupted`), and the store lock's heartbeat, fencing and take-over.
 *
 *   node --test packages/pxsig/test/crash.test.mjs
 *
 * Crashes are real exits at named points (PXSIG_FAULT, honoured only under NODE_ENV=test).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newBatch, readLog, record, snapshot, undo, verify } from '../src/lib/approvals.mjs';
import { appendLine, dropTorn, readLines, writeAtomic, writeJson } from '../src/lib/files.mjs';
import { reconcile } from '../src/lib/integrity.mjs';
import {
  acquireLock,
  LockError,
  lockPath,
  QUIET_MS,
  readLock,
  takeLock,
} from '../src/lib/lock.mjs';
import { applyRepairs, planRepairs } from '../src/lib/repair.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, rustBin } from './fixture.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const cli = join(src, '..', 'bin', 'pxsig.mjs');
const url = (p) => JSON.stringify(pathToFileURL(join(src, p)).href);
const tmp = () => mkdtempSync(join(tmpdir(), 'pxsig-crash-'));
const project = (f) => openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
const env = { ...process.env, PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1', PXSIG_BIN: rustBin };

/** Run `code` (an ES module body) in a child with PXSIG_FAULT set; returns its exit status. */
function crashAt(point, code, cwd) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd,
    encoding: 'utf8',
    env: { ...env, NODE_ENV: 'test', PXSIG_FAULT: point },
  });
  return r;
}

test('a whole-file write that fails leaves the old file, and no temp file', () => {
  const dir = tmp();
  const p = join(dir, 'check.json');
  writeJson(p, { rows: [1] });
  // A value writeSync cannot take fails after the temp file is open, as a full disk would.
  assert.throws(() => writeAtomic(p, Symbol('no space')));
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { rows: [1] });
  assert.deepEqual(readdirSync(dir), ['check.json']);
});

test('a log line cut short is set apart, closed off before the next line, and removed only on request', () => {
  const p = join(tmp(), 'approvals.ndjson');
  appendLine(p, { id: 'a' });
  writeFileSync(p, `${readFileSync(p, 'utf8')}{"id":"b","aft`); // a crash mid-write
  assert.deepEqual(readLines(p).lines, [{ id: 'a' }]);
  assert.equal(readLines(p).torn.length, 1, 'the last line has no newline');
  appendLine(p, { id: 'c' });
  const { lines, torn } = readLines(p);
  assert.deepEqual(lines, [{ id: 'a' }, { id: 'c' }], 'the next line is whole');
  assert.deepEqual(
    torn.map((t) => t.line),
    [2]
  );
  const good = readFileSync(p, 'utf8').split('\n')[0];
  assert.equal(dropTorn(p), 1);
  assert.equal(readFileSync(p, 'utf8'), `${good}\n{"id":"c"}\n`, 'complete lines keep their bytes');
});

test('the fault hook only fires under NODE_ENV=test', () => {
  const p = join(tmp(), 'log.ndjson');
  const code = `import { appendLine } from ${url('lib/files.mjs')}; appendLine(${JSON.stringify(p)}, { id: 'x', pad: '${'y'.repeat(40)}' });`;
  assert.equal(crashAt('mid-append', code).status, 97);
  assert.equal(readLines(p).torn.length, 1, 'half a line written');
  const normal = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    env: { ...env, NODE_ENV: '', PXSIG_FAULT: 'mid-append' },
  });
  assert.equal(normal.status, 0, normal.stderr);
});

/** A fixture project whose entry `id` has a logged approval (as a real one would). */
function approved(f, id) {
  const P = project(f);
  const e = f.manifest.stories.find((s) => s.id === id);
  record(P, e, { batch: 'b0-dashboard', via: 'dashboard', before: null });
  return { P, e };
}

test('an approval stopped after its .psig, before its log line, is interrupted, and undo puts it back', () => {
  const f = fixture();
  const id = f.ids.ok;
  const { P, e } = approved(f, id);
  const old = readFileSync(f.sig(id));
  const batch = newBatch('dashboard');
  const code = `import { record, snapshot } from ${url('lib/approvals.mjs')}; import { openProject } from ${url('lib/workspace.mjs')};
    const P = openProject({ cwd: process.cwd() }); const e = P && JSON.parse((await import('node:fs')).readFileSync(P.manifestPath(), 'utf8')).stories.find((s) => s.id === ${JSON.stringify(id)});
    snapshot(P, e, ${JSON.stringify(batch)});
    (await import('node:fs')).writeFileSync(${JSON.stringify(f.sig(id))}, Buffer.from('the new baseline'));
    record(P, e, { batch: ${JSON.stringify(batch)}, via: 'dashboard', before: null });`;
  assert.equal(crashAt('after-psig', code, f.repo).status, 97);
  const r = verify(P, f.manifest);
  assert.deepEqual(
    r.interrupted.map((x) => [x.id, x.batch]),
    [[id, batch]]
  );
  assert.ok(!r.mismatched.some((x) => x.id === id), 'not a mismatch');
  const cliR = spawnSync(process.execPath, [cli, 'approve', 'verify'], {
    cwd: f.repo,
    encoding: 'utf8',
    env,
  });
  assert.equal(cliR.status, 1);
  assert.match(cliR.stdout, new RegExp(`approve undo ${batch}`));
  // As `approve undo` does: restore, then log the restore.
  const before = verify(P, f.manifest).interrupted[0].now;
  const u = undo(P, f.manifest, batch);
  assert.deepEqual(u.restored, [id]);
  assert.deepEqual(readFileSync(f.sig(id)), old);
  record(P, e, { batch: `${batch}-undo`, via: 'undo', before });
  assert.ok(!verify(P, f.manifest).interrupted.length);
  // A baseline changed later, with no snapshot to explain it, is a mismatch, not that batch again.
  writeFileSync(f.sig(id), 'edited by hand');
  const later = verify(P, f.manifest);
  assert.deepEqual([later.mismatched.map((x) => x.id), later.interrupted], [[id], []]);
});

test('a crash after the snapshot leaves the baseline and the log as they were', () => {
  const f = fixture();
  const id = f.ids.ok;
  const { P } = approved(f, id);
  const code = `import { snapshot } from ${url('lib/approvals.mjs')}; import { openProject } from ${url('lib/workspace.mjs')};
    const P = openProject({ cwd: process.cwd() }); const e = JSON.parse((await import('node:fs')).readFileSync(P.manifestPath(), 'utf8')).stories.find((s) => s.id === ${JSON.stringify(id)});
    snapshot(P, e, 'b1-dashboard');`;
  assert.equal(crashAt('after-snapshot', code, f.repo).status, 97);
  const r = verify(P, f.manifest);
  assert.ok(!r.interrupted.length && !r.mismatched.some((x) => x.id === id));
});

test('a torn approval line: verify does not fail on it, doctor warns, and the repair needs a person', async () => {
  const f = fixture();
  const { P } = approved(f, f.ids.ok);
  writeFileSync(P.store.approvals, `${readFileSync(P.store.approvals, 'utf8')}{"id":"x","af`);
  assert.equal(readLog(P).length, 1);
  const v = spawnSync(process.execPath, [cli, 'approve', 'verify', '--json'], {
    cwd: f.repo,
    encoding: 'utf8',
    env,
  });
  assert.ok([0, 1].includes(v.status), v.stderr);
  assert.equal(JSON.parse(v.stdout).torn, 1);
  const ledger = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const torn = ledger.setup.find((x) => x.code === 'log-torn');
  assert.equal(torn?.severity, 'warn');
  assert.match(torn.reason, /--only log-torn/);
  assert.ok(
    !planRepairs(ledger).steps.some((s) => s.action === 'log-torn'),
    'never planned unasked'
  );
  const plan = planRepairs(ledger, { only: ['log-torn'] });
  assert.equal(plan.steps[0]?.action, 'log-torn');
  const no = await applyRepairs(f.ctx, plan, { hooks: { confirmTorn: async () => false } });
  assert.match(no.steps[0].result, /not confirmed/);
  const yes = await applyRepairs(f.ctx, plan, { hooks: { confirmTorn: async () => true } });
  assert.match(yes.steps[0].result, /1 torn line/);
  assert.equal(readLines(P.store.approvals).torn.length, 0);
  const piped = spawnSync(
    process.execPath,
    [cli, 'doctor', '--repair', '--only', 'log-torn', '--apply', '--offline'],
    { cwd: f.repo, encoding: 'utf8', env }
  );
  assert.equal(piped.status, 3, piped.stderr);
});

/** A process that stays alive until killed (a live lock holder). */
const sleeper = () =>
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });

test('the lock carries a nonce and a heartbeat; a lock whose process is gone is taken over', () => {
  const P = project(fixture());
  writeFileSync(
    lockPath(P),
    JSON.stringify({
      pid: 2147483646,
      startedAt: new Date().toISOString(),
      host: hostname(),
      holder: 'check',
      command: 'pxsig check',
    })
  );
  const l = acquireLock(P, { holder: 'test' });
  const body = JSON.parse(readFileSync(lockPath(P), 'utf8'));
  assert.equal(body.pid, process.pid);
  assert.match(body.nonce, /^[0-9a-f]{16}$/);
  assert.equal(body.generation, 1);
  assert.ok(Date.parse(body.heartbeatAt) > 0);
  l.check();
  l.release();
  assert.ok(!existsSync(lockPath(P)));
});

test('a live holder with a quiet heartbeat is not taken over automatically; a person may, and the old holder stops', async () => {
  const P = project(fixture());
  const s = sleeper();
  try {
    const quietSince = new Date(Date.now() - QUIET_MS - 60_000).toISOString();
    writeFileSync(
      lockPath(P),
      JSON.stringify({
        pid: s.pid,
        startedAt: new Date().toISOString(),
        host: hostname(),
        holder: 'serve',
        command: 'pxsig serve',
        nonce: 'aaaaaaaaaaaaaaaa',
        generation: 3,
        heartbeatAt: quietSince,
      })
    );
    const held = readLock(P);
    assert.equal(held.stale, false);
    assert.equal(held.quiet, true);
    assert.throws(
      () => acquireLock(P, { holder: 'test' }),
      (e) =>
        e instanceof LockError &&
        /heartbeat stopped .* a person at a terminal can take it over/.test(e.message)
    );
    // Not at a terminal (this test): the take-over needs a person.
    await assert.rejects(takeLock(P, { holder: 'test' }), (e) => e.exit === 3);
    const mine = acquireLock(P, { holder: 'test', takeOver: 'aaaaaaaaaaaaaaaa' });
    assert.equal(JSON.parse(readFileSync(lockPath(P), 'utf8')).generation, 4);
    mine.release();
    // A lock from before the heartbeat (no nonce) and a live pid is held, as before.
    writeFileSync(
      lockPath(P),
      JSON.stringify({
        pid: s.pid,
        startedAt: new Date().toISOString(),
        host: hostname(),
        holder: 'serve',
        command: 'pxsig serve',
      })
    );
    assert.equal(readLock(P).quiet, false);
    assert.throws(() => acquireLock(P, { holder: 'test' }), LockError);
  } finally {
    s.kill();
  }
});

test('a holder whose lock was taken over stops before its next write', () => {
  const P = project(fixture());
  const l = acquireLock(P, { holder: 'test' });
  const body = JSON.parse(readFileSync(lockPath(P), 'utf8'));
  writeFileSync(
    lockPath(P),
    JSON.stringify({ ...body, pid: process.pid, nonce: 'bbbbbbbbbbbbbbbb', generation: 2 })
  );
  assert.throws(() => l.check(), /lock taken over by .*: nothing more was written/);
  l.release();
  assert.ok(existsSync(lockPath(P)), "release leaves the new holder's lock alone");
});

test('snapshot then record leaves a clean trail (the normal order)', () => {
  const f = fixture();
  const P = project(f);
  const e = f.manifest.stories.find((s) => s.id === f.ids.ok);
  const { before } = snapshot(P, e, 'b2-cli');
  writeFileSync(f.sig(e.id), 'approved bytes');
  record(P, e, { batch: 'b2-cli', via: 'cli', before });
  const r = verify(P, f.manifest);
  assert.ok(!r.interrupted.length && !r.mismatched.some((x) => x.id === e.id));
});
