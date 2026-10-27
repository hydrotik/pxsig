/**
 * upgrade.test.mjs — a store written by pxsig 0.3.2 (test/fixtures/store-0.3.2/: log lines with
 * `by` and no version, a lock without a heartbeat, a token file where 0.3.2 put it) is read by
 * every command that reads a store, without an error; and a report written by 0.4.0
 * (test/fixtures/store-0.4.0/: no render environment) reads with the environment unknown.
 *
 *   node --test packages/pxsig/test/upgrade.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { acquireLock, readLock } from '../src/lib/lock.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, rustBin } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const old = join(here, 'fixtures', 'store-0.3.2');
const v04 = join(here, 'fixtures', 'store-0.4.0');
const cli = join(here, '..', 'bin', 'pxsig.mjs');
const env = { ...process.env, PXSIG_WORKSPACE: '', PXSIG_NO_DELEGATE: '1', PXSIG_BIN: rustBin, PXSIG_FORMAT: 'json' };

/** A fixture project with the 0.3.2 records laid over its store. */
function oldStore() {
  const f = fixture();
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  copyFileSync(join(old, 'approvals.ndjson'), P.store.approvals);
  const lock = JSON.parse(readFileSync(join(old, 'lock.json'), 'utf8'));
  mkdirSync(P.store.reports, { recursive: true });
  writeFileSync(join(P.store.reports, '.lock'), JSON.stringify({ ...lock, pid: 2147483646, host: hostname() }));
  const cache = join(f.repo, 'node_modules', '.cache', 'pxsig');
  mkdirSync(cache, { recursive: true });
  copyFileSync(join(old, 'serve-6070.token'), join(cache, 'serve-6070.token'));
  return { f, P };
}

const run = (f, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: f.repo, encoding: 'utf8', env });

test('the read commands take a 0.3.2 store as it is', () => {
  const { f } = oldStore();
  for (const args of [['status'], ['list', 'all'], ['history'], ['doctor', '--offline'], ['stale'], ['a11y'], ['approve', 'log'], ['approve', 'verify'], ['config']]) {
    const r = run(f, ...args, '--json');
    assert.ok([0, 1].includes(r.status), `${args.join(' ')} → ${r.status}\n${r.stderr}`);
    assert.doesNotThrow(() => JSON.parse(r.stdout), `${args.join(' ')} prints JSON`);
  }
  const log = JSON.parse(run(f, 'approve', 'log', '--json').stdout);
  assert.deepEqual(log.map((b) => b.via).sort(), ['cli', 'dashboard', 'migrate']);
});

test('a 0.3.2 lock (no heartbeat) left by a process that is gone is taken over as before', () => {
  const { P } = oldStore();
  const held = readLock(P);
  assert.equal(held.stale, true);
  assert.equal(held.quiet, undefined, 'judged by its process, not a heartbeat it never had');
  const l = acquireLock(P, { holder: 'test' });
  l.release();
});

test('a 0.4.0 report (no render environment) reads as it is: the environment is unknown, nothing warns', () => {
  const f = fixture();
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  copyFileSync(join(v04, 'check.json'), join(P.store.reports, 'check.json'));
  for (const args of [['status'], ['list', 'all'], ['doctor', '--offline'], ['stale'], ['entry', 'components-beta--default']]) {
    const r = run(f, ...args, '--json');
    assert.ok([0, 1].includes(r.status), `${args.join(' ')} → ${r.status}\n${r.stderr}`);
    assert.doesNotThrow(() => JSON.parse(r.stdout), `${args.join(' ')} prints JSON`);
  }
  const doctor = JSON.parse(run(f, 'doctor', '--offline', '--json').stdout);
  assert.ok(!doctor.setup.some((s) => s.code === 'env-mismatch'), 'no environment finding');
  const md = spawnSync(rustBin, ['report', '--input', join(P.store.reports, 'check.json'), '--format', 'markdown'], { encoding: 'utf8' });
  assert.equal(md.status, 0, md.stderr);
  assert.ok(!md.stdout.includes('Environment:'), 'summary.md has no environment line');
});
