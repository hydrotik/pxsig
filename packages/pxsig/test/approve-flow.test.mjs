/**
 * approve-flow.test.mjs — `pxsig approve apply` and `approve undo` end to end, as a person at a
 * terminal runs them: a fixture project, a plan made by `approve plan`, a live `pxsig serve` on its
 * own port for the writes, and the typed confirmation on stdin.
 *
 *   node --test packages/pxsig/test/approve-flow.test.mjs
 *
 * Covers: the plan pin (a render changed since planning), no server, a check running, a successful
 * apply (baselines replaced, snapshotted, one log line per entry), undo (restored, `-undo` lines with
 * `before`, the lock released), and undo's refusals (not confirmed, the store locked by the server,
 * a first baseline rewritten since). Needs the Rust binary; skipped without it.
 */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { detectAgent } from '../src/lib/agents.mjs';
import { paths, readLog, sha256 } from '../src/lib/approvals.mjs';
import { lockPath } from '../src/lib/lock.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hashTree, hasRust, png, rustBin, testEnv, testHome } from './fixture.mjs';
import { serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { ManifestEntry } from '../src/types.js' */
/** @typedef {ReturnType<typeof fixture>} Fixture */

const skip = skipUnless(hasRust, 'Rust binary not built');
const NO_SERVER = 'http://127.0.0.1:1';
const REASON = 'the new palette, reviewed in the dashboard';
// A render unlike the fixture's checkerboard: approving it changes the baseline's bytes.
const STRIPES = png(128, 128, (x) => (x % 16 < 8 ? [200, 60, 60] : [250, 250, 250]));

/**
 * A person at a terminal: TTYs (a preload, as a file URL for Windows), no CI and no assistant
 * markers, as in approve.test.mjs.
 * @param {Fixture} f
 * @param {string[]} args
 * @param {{ input?: string, url?: string }} [opts]
 */
function person(f, args, { input = '', url = NO_SERVER } = {}) {
  const preload = join(f.repo, 'tty-preload.mjs');
  if (!existsSync(preload))
    writeFileSync(preload, 'process.stdin.isTTY = true;\nprocess.stdout.isTTY = true;\n');
  /** @type {Record<string, string | undefined>} */
  const env = { ...testEnv(testHome), PXSIG_URL: url, PXSIG_BIN: rustBin, PXSIG_FORMAT: 'plain' };
  delete env.CI;
  for (let a = detectAgent(env); a; a = detectAgent(env)) delete env[a.variable];
  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(preload).href, join(src, 'cli.mjs'), 'approve', ...args],
    { cwd: f.repo, env, timeout: 60_000 }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.stdin.end(input);
  // Async, so a stand-in server in this process can answer the CLI.
  return /** @type {Promise<{ status: number | null, stdout: string, stderr: string }>} */ (
    new Promise((ok) => child.on('close', (status) => ok({ status, stdout, stderr })))
  );
}

/** @param {{ stdout: string, stderr: string }} r */
const out = (r) => `${r.stdout}${r.stderr}`;

/**
 * A fixture whose changed entry has a new render, planned by `approve plan` (any caller may plan).
 * @param {{ after: (fn: () => void) => void }} t
 * @param {{ fresh?: boolean }} [opts] plan the entry with no baseline (a first baseline) instead
 */
async function planned(t, { fresh = false } = {}) {
  const f = fixture({ t });
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const id = fresh ? f.ids.unbaselined : f.ids.changed;
  // `id` is in the fixture's manifest.
  const entry = /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id));
  const p = paths(P, entry);
  if (!fresh) {
    writeFileSync(p.latestPng, STRIPES);
    // As old as the fixture's other renders (none reads as rewritten after its verdict).
    const old = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(p.latestPng, old, old);
  }
  const r = await person(f, [
    'plan',
    id,
    '--reason',
    REASON,
    ...(fresh ? ['--new', '--first-baselines'] : ['--allow-shape', id]),
  ]);
  assert.equal(r.status, 0, out(r));
  const plan = JSON.parse(readFileSync(join(P.store.reports, 'approval-plan.json'), 'utf8'));
  assert.deepEqual(
    plan.entries
      .filter((/** @type {{ status: string }} */ e) => e.status === 'ok')
      .map((/** @type {{ id: string }} */ e) => e.id),
    [id],
    JSON.stringify(plan.entries)
  );
  return { f, P, id, p };
}

/** @param {Awaited<ReturnType<typeof planned>>['P']} P */
const state = (P) => ({ store: hashTree(P.store.root), log: readLog(P).length });

/**
 * Apply the plan through a live server, then stop it and wait until its process is gone (the
 * store lock it held is then stale, and free for `approve undo`).
 * @param {Awaited<ReturnType<typeof planned>>} at
 */
async function applied({ f, P, id, p }) {
  const old = sha256(p.sig);
  const S = await serve(f);
  let r;
  try {
    r = await person(f, ['apply'], { input: 'APPROVE 1 ENTRIES\n', url: S.base });
  } finally {
    S.stop();
  }
  assert.equal(r.status, 0, `${out(r)}\n${S.log()}`);
  for (let i = 0; i < 100 && existsSync(lockPath(P)); i++) {
    const { pid } = JSON.parse(readFileSync(lockPath(P), 'utf8'));
    try {
      process.kill(pid, 0);
    } catch {
      break;
    }
    await new Promise((ok) => setTimeout(ok, 50));
  }
  const line = readLog(P).find((l) => l.id === id);
  assert.ok(line, 'the approval is logged');
  return { r, old, line, S };
}

test(
  'apply refuses a render changed since planning: exit 2, nothing written',
  { skip },
  async (t) => {
    const { f, P, id, p } = await planned(t);
    writeFileSync(p.latestPng, Buffer.concat([readFileSync(p.latestPng), Buffer.from([0])]));
    const before = state(P);
    const r = await person(f, ['apply'], { input: 'APPROVE 1 ENTRIES\n' });
    assert.equal(r.status, 2, out(r));
    assert.match(
      r.stderr,
      new RegExp(`1 renders or baselines changed since planning \\(${id}…\\)`)
    );
    assert.match(r.stderr, /plan again/);
    assert.deepEqual(state(P), before, 'the store and the approval log are unchanged');
  }
);

test(
  'apply refuses when the pxsig server is not running: exit 2, nothing written',
  { skip },
  async (t) => {
    const { f, P } = await planned(t);
    const before = state(P);
    const r = await person(f, ['apply'], { input: 'APPROVE 1 ENTRIES\n', url: NO_SERVER });
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /the pxsig server is not running \(http:\/\/127\.0\.0\.1:1\)/);
    assert.deepEqual(state(P), before, 'the store and the approval log are unchanged');
  }
);

test('apply refuses while a check is running: exit 2, nothing written', { skip }, async (t) => {
  const { f, P } = await planned(t);
  // A stand-in server whose status says a check is running; it must never be asked to approve.
  /** @type {string[]} */
  const seen = [];
  const busy = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ running: true, queued: 0 }));
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => busy.listen(0, '127.0.0.1', ok)));
  t.after(() => busy.close());
  // Listening on TCP: the address is an AddressInfo.
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (busy.address()).port}`;
  const before = state(P);
  const r = await person(f, ['apply'], { input: 'APPROVE 1 ENTRIES\n', url });
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /a check is running: wait for it, then plan again/);
  assert.deepEqual(state(P), before, 'the store and the approval log are unchanged');
  assert.ok(!seen.some((s) => s.startsWith('POST')), seen.join('\n'));
});

test(
  'apply, confirmed: the baseline is replaced and snapshotted, one log line with before and after',
  { skip },
  async (t) => {
    const at = await planned(t);
    const { P, id, p } = at;
    const original = readFileSync(p.sig);
    const { r, old, line } = await applied(at);
    assert.match(out(r), /Approved/);
    const plan = JSON.parse(readFileSync(join(P.store.reports, 'approval-plan.json'), 'utf8'));
    assert.ok(plan.appliedAt && plan.batch, 'the plan records when and which batch');
    assert.notEqual(sha256(p.sig), old, 'the baseline was rewritten from the new render');
    assert.deepEqual(
      readFileSync(join(P.store.history, plan.batch, `${id}.psig`)),
      original,
      'the replaced baseline is kept for undo'
    );
    assert.equal(readLog(P).length, 1, 'one line per entry');
    assert.equal(line.batch, plan.batch);
    assert.equal(line.via, 'cli');
    assert.equal(line.reason, REASON);
    assert.equal(line.before, old);
    assert.equal(line.after, sha256(p.sig));
  }
);

test(
  'undo, confirmed with UNDO: the old baseline is back, a -undo line logged, the lock released',
  { skip },
  async (t) => {
    const at = await planned(t);
    const { f, P, id, p } = at;
    const original = readFileSync(p.sig);
    const { line } = await applied(at);
    const approved = sha256(p.sig);
    const no = await person(f, ['undo', line.batch], { input: 'no\n' });
    assert.equal(no.status, 1, out(no));
    assert.match(no.stderr, /not confirmed: nothing was restored/);
    assert.equal(sha256(p.sig), approved, 'not confirmed: the approved baseline stays');
    assert.equal(readLog(P).length, 1);
    const r = await person(f, ['undo', line.batch], { input: 'UNDO\n' });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /Restored/);
    assert.deepEqual(readFileSync(p.sig), original, 'restored byte for byte');
    const undone = readLog(P).filter((l) => l.batch === `${line.batch}-undo`);
    assert.equal(undone.length, 1, JSON.stringify(readLog(P)));
    assert.equal(undone[0].id, id);
    assert.equal(undone[0].via, 'undo');
    assert.equal(undone[0].before, approved, 'before: the baseline the undo replaced');
    assert.equal(undone[0].after, sha256(p.sig));
    assert.ok(!existsSync(lockPath(P)), 'the store lock is released');
  }
);

test(
  'undo refuses while the server holds the store: nothing restored or logged',
  { skip },
  async (t) => {
    const at = await planned(t);
    const { f, P } = at;
    const { line } = await applied(at);
    const S = await serve(f);
    // Not the whole store: the server re-stamps its lock every few seconds.
    const written = () => ({
      baselines: hashTree(join(P.store.root, 'baselines')),
      log: readFileSync(P.store.approvals, 'utf8'),
    });
    try {
      const before = written();
      const r = await person(f, ['undo', line.batch], { input: 'UNDO\n', url: S.base });
      assert.equal(r.status, 2, out(r));
      assert.match(r.stderr, /Undo writes baselines, so it needs the store to itself/);
      assert.deepEqual(written(), before, 'the baselines and the approval log are unchanged');
    } finally {
      S.stop();
    }
  }
);

test(
  'undo refuses to remove a first baseline rewritten since its approval: exit 1, file kept',
  { skip },
  async (t) => {
    const at = await planned(t, { fresh: true });
    const { f, P, id, p } = at;
    const { line } = await applied(at);
    assert.equal(line.before, null, 'a first baseline: nothing before it');
    const rewritten = Buffer.concat([readFileSync(p.sig), Buffer.from([0])]);
    writeFileSync(p.sig, rewritten);
    const r = await person(f, ['undo', line.batch], { input: 'UNDO\n' });
    assert.equal(r.status, 1, out(r));
    assert.match(
      r.stdout,
      new RegExp(`${id} — the baseline changed after this batch: not removing it`)
    );
    assert.deepEqual(readFileSync(p.sig), rewritten, 'the rewritten baseline is left in place');
    assert.equal(readLog(P).filter((l) => l.batch.endsWith('-undo')).length, 0, 'no -undo line');
    assert.ok(!existsSync(lockPath(P)), 'the store lock is released');
  }
);
