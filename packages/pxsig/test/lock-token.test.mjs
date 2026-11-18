/**
 * lock-token.test.mjs — the store lock's token: a lock counts as held only while its holder keeps
 * the token's file open, so a killed holder whose pid now belongs to another process is stale (the
 * Windows case, where pids are reused within seconds and no start time is known), a live holder is
 * never taken over, and of several takers racing for one stale lock exactly one wins.
 *
 *   node --test packages/pxsig/test/lock-token.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLock, LockError, lockPath, readLock } from '../src/lib/lock.mjs';
import { holdToken, tokenHeld, tokenPath } from '../src/lib/lock/token.mjs';
import { tempDir } from './fixture.mjs';
/** @import { LockState } from '../src/types.js' */
/** @import { ChildProcess } from 'node:child_process' */

const lockUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'lock.mjs')
).href;

/** A store in a fresh directory. */
function store() {
  const root = tempDir('lock-token');
  const P = { workspaceRoot: root, store: { root, reports: join(root, 'reports') } };
  mkdirSync(P.store.reports, { recursive: true });
  return P;
}

/**
 * A node process running `body` (an ES module) with `acquireLock` and `P` in scope.
 * @param {ReturnType<typeof store>} P
 * @param {string} body
 */
const child = (P, body) =>
  spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { acquireLock } from ${JSON.stringify(lockUrl)}; const P = ${JSON.stringify(P)};\n${body}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

/** @param {ChildProcess} c @returns {Promise<string>} the child's stdout once it exits */
const done = (c) =>
  new Promise((ok) => {
    let out = '';
    c.stdout?.on('data', (d) => (out += d));
    c.on('exit', () => ok(out));
  });

/** @param {ChildProcess} c @param {string} line resolves once the child printed `line` */
const said = (c, line) =>
  new Promise((ok, no) => {
    let out = '';
    let err = '';
    c.stdout?.on('data', (d) => {
      out += d;
      if (out.includes(line)) ok(undefined);
    });
    c.stderr?.on('data', (d) => (err += d));
    c.on('exit', () => no(new Error(`exited before "${line}": ${err}`)));
  });

/** A process that stays alive until killed: stands in for whatever process got a reused pid. */
const sleeper = () =>
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });

/** A holder that takes the lock and keeps it until killed. */
const holder = (/** @type {ReturnType<typeof store>} */ P) =>
  child(P, `acquireLock(P, { holder: 'test' }); console.log('held'); setInterval(() => {}, 1000);`);

/** Kill `c` outright (SIGKILL; TerminateProcess on Windows) and wait until it is gone. */
const kill = (/** @type {ChildProcess} */ c) =>
  new Promise((ok) => {
    c.on('exit', ok);
    c.kill('SIGKILL');
  });

/** The lock file's body. @param {ReturnType<typeof store>} P */
const body = (P) => JSON.parse(readFileSync(lockPath(P), 'utf8'));

/**
 * Run `fn`, returning what it wrote to stderr.
 * @param {() => void} fn
 */
function stderrOf(fn) {
  const write = process.stderr.write;
  let err = '';
  // Captures pxsig's one-line notes for the assertions below.
  process.stderr.write = (s) => ((err += String(s)), true);
  try {
    fn();
  } finally {
    process.stderr.write = write;
  }
  return err;
}

test('a killed holder whose pid now belongs to another live process is stale, and taken over with a note', async () => {
  const P = store();
  const h = holder(P);
  await said(h, 'held');
  const dead = body(P);
  assert.match(dead.token, /^[0-9a-f]{32}$/);
  assert.ok(existsSync(tokenPath(P.store.reports, dead.token)));
  await kill(h);
  // The pid check says alive: another process has the pid, and it started before the lock was
  // written, so the start time cannot tell either (on Windows there is no start time at all).
  const reuse = sleeper();
  try {
    writeFileSync(
      lockPath(P),
      JSON.stringify({
        ...dead,
        pid: reuse.pid,
        startedAt: new Date(Date.now() + 60_000).toISOString(),
      })
    );
    const l = /** @type {LockState} */ (readLock(P));
    assert.equal(l.stale, true);
    assert.equal(l.why, `pid ${reuse.pid} no longer holds the lock's token`);
    /** @type {ReturnType<typeof acquireLock> | undefined} */
    let mine;
    const err = stderrOf(() => {
      mine = acquireLock(P, { holder: 'test' });
    });
    assert.equal(
      err,
      `pxsig: the store lock was stale (pid ${reuse.pid} no longer holds the lock's token): taken over\n`
    );
    assert.doesNotMatch(err, new RegExp(P.workspaceRoot.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
    assert.equal(body(P).pid, process.pid);
    assert.ok(
      !existsSync(tokenPath(P.store.reports, dead.token)),
      "the dead holder's token file is removed"
    );
    mine?.release();
    assert.equal(readLock(P), null);
  } finally {
    reuse.kill();
  }
});

test('a live holder is never taken over, whatever its pid and start time say', async () => {
  const P = store();
  const h = holder(P);
  try {
    await said(h, 'held');
    const live = body(P);
    // A start time after the process's own (what a reused pid looks like to `ps`): the token wins.
    writeFileSync(lockPath(P), JSON.stringify({ ...live, startedAt: new Date(0).toISOString() }));
    assert.equal(/** @type {LockState} */ (readLock(P)).stale, false);
    for (let i = 0; i < 3; i++)
      assert.throws(
        () => acquireLock(P, { holder: 'test' }),
        (e) => e instanceof LockError && /holds the store/.test(e.message)
      );
    assert.equal(body(P).nonce, live.nonce, "the holder's lock is untouched");
  } finally {
    await kill(h);
  }
});

/**
 * Start `n` takers at the same moment; each holding the lock keeps it 1.5 s, past every other
 * taker's attempt. Returns what each one reported.
 * @param {ReturnType<typeof store>} P
 * @param {number} n
 */
async function race(P, n) {
  const at = Date.now() + 800;
  const takers = Array.from({ length: n }, () =>
    child(
      P,
      `while (Date.now() < ${at}) {}
try {
  const l = acquireLock(P, { holder: 'race' });
  console.log(JSON.stringify({ got: true, pid: process.pid }));
  setTimeout(() => l.release(), 1500);
} catch (e) { console.log(JSON.stringify({ got: false, error: e.message })); }`
    )
  );
  const outs = await Promise.all(takers.map(done));
  return outs.map((o) => JSON.parse(o.trim() || '{"got":false,"error":"no output"}'));
}

test('takers racing for one stale lock: exactly one holds the store', async () => {
  for (let round = 0; round < 3; round++) {
    const P = store();
    const h = holder(P);
    await said(h, 'held');
    await kill(h); // a stale lock, its token file left behind
    const results = await race(P, 6);
    const winners = results.filter((r) => r.got);
    assert.equal(winners.length, 1, JSON.stringify(results));
    for (const r of results.filter((x) => !x.got))
      assert.match(r.error, /holds the store|could not take/);
  }
});

test('takers racing with no lock at all: exactly one holds the store', async () => {
  const results = await race(store(), 6);
  assert.equal(results.filter((r) => r.got).length, 1, JSON.stringify(results));
});

test('a claim left by a taker that crashed is replaced; one by a live taker is respected', async () => {
  const P = store();
  const stale = JSON.stringify({
    pid: 2147483646,
    startedAt: new Date().toISOString(),
    host: hostname(),
  });
  const claimFile = `${lockPath(P)}.claim-${createHash('sha256').update(stale).digest('hex').slice(0, 16)}`;
  // A live taker (it holds its token) claimed the stale lock: wait for it, never replace it.
  const token = 'c'.repeat(32);
  const taker = child(
    P,
    `const { holdToken } = await import(${JSON.stringify(pathToFileURL(join(dirname(fileURLToPath(lockUrl)), 'lock', 'token.mjs')).href)});
holdToken(P.store.reports, ${JSON.stringify(token)}); console.log('held'); setInterval(() => {}, 1000);`
  );
  try {
    await said(taker, 'held');
    writeFileSync(lockPath(P), stale);
    writeFileSync(claimFile, JSON.stringify({ pid: taker.pid, host: hostname(), token }));
    assert.throws(() => acquireLock(P, { holder: 'test' }), /could not take the store lock/);
    assert.equal(readFileSync(lockPath(P), 'utf8'), stale, 'the claimed lock is left to its taker');
  } finally {
    await kill(taker);
  }
  // That taker is gone now: its claim is stale and the lock is taken over.
  const err = stderrOf(() => acquireLock(P, { holder: 'test' }).release());
  assert.match(err, /the store lock was stale \(process 2147483646 is gone\): taken over/);
  assert.ok(!existsSync(claimFile));
});

test('on Linux the token is proved by the holder pid having the file open (/proc/<pid>/fd)', () => {
  const P = store();
  const token = 'a'.repeat(32);
  const proof = holdToken(P.store.reports, token, 'linux');
  try {
    const proc = tempDir('lock-proc');
    mkdirSync(join(proc, String(process.pid)), { recursive: true });
    mkdirSync(join(proc, '4242', 'fd'), { recursive: true });
    symlinkSync(join(P.store.reports, 'elsewhere'), join(proc, '4242', 'fd', '1'));
    const opts = { platform: /** @type {const} */ ('linux'), procRoot: proc };
    assert.equal(
      tokenHeld(P.store.reports, token, 4242, opts),
      false,
      'pid 4242 does not have it open'
    );
    symlinkSync(tokenPath(P.store.reports, token), join(proc, '4242', 'fd', '7'));
    assert.equal(tokenHeld(P.store.reports, token, 4242, opts), true);
    assert.equal(tokenHeld(P.store.reports, token, 4343, opts), false, 'no such process');
    assert.equal(tokenHeld(P.store.reports, 'b'.repeat(32), 4242, opts), false, 'no token file');
  } finally {
    proof.release();
  }
  assert.ok(!existsSync(tokenPath(P.store.reports, token)), 'release removes the token file');
});

test('a lock with no token (an older pxsig) or a token that is not one is judged by its pid', () => {
  const P = store();
  const s = sleeper();
  try {
    for (const token of [undefined, '../../elsewhere']) {
      writeFileSync(
        lockPath(P),
        JSON.stringify({
          pid: s.pid,
          startedAt: new Date(Date.now() + 60_000).toISOString(),
          host: hostname(),
          holder: 'serve',
          ...(token ? { token } : {}),
        })
      );
      assert.equal(/** @type {LockState} */ (readLock(P)).stale, false);
    }
  } finally {
    s.kill();
  }
});
