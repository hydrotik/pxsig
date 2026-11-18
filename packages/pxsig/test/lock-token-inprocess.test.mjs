/**
 * lock-token-inprocess.test.mjs — a holder and a reader of the store lock in one process (the
 * server and a command it runs in process): the process knows its own token and never opens the
 * token's file to prove it, and the file stays readable to other programs while it is held.
 *
 *   node --test packages/pxsig/test/lock-token-inprocess.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLock, lockPath, readLock } from '../src/lib/lock.mjs';
import { tokenPath } from '../src/lib/lock/token.mjs';
import { tempDir } from './fixture.mjs';
/** @import { LockState } from '../src/types.js' */

const lockUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'lock.mjs')
).href;

/** A store in a fresh directory. */
function store() {
  const root = tempDir('lock-inprocess');
  const P = { workspaceRoot: root, store: { root, reports: join(root, 'reports') } };
  mkdirSync(P.store.reports, { recursive: true });
  return P;
}

/**
 * Run `fn` with every open of an existing token file refused, as Windows refuses one while a probe
 * holds it (EBUSY). Creating a new token file is allowed.
 * @template T
 * @param {() => T} fn
 * @returns {{ value: T, opened: string[] }}
 */
function refusingTokenOpens(fn) {
  const open = fs.openSync;
  /** @type {string[]} */
  const opened = [];
  fs.openSync = (...args) => {
    if (/[\\/]\.lock-[0-9a-f]{32}$/.test(String(args[0])) && existsSync(String(args[0]))) {
      opened.push(String(args[0]));
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    }
    return open(...args);
  };
  syncBuiltinESMExports();
  try {
    return { value: fn(), opened };
  } finally {
    fs.openSync = open;
    syncBuiltinESMExports();
  }
}

/** readLock in another process, as `pxsig` run beside the holder would. */
const elsewhere = (/** @type {ReturnType<typeof store>} */ P) =>
  JSON.parse(
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { readLock } from ${JSON.stringify(lockUrl)}; console.log(JSON.stringify(readLock(${JSON.stringify(P)})));`,
      ],
      { encoding: 'utf8' }
    ).stdout
  );

test('holder and reader in one process: its own token is known, never opened', () => {
  const P = store();
  const l = acquireLock(P, { holder: 'serve' });
  try {
    const { token } = JSON.parse(readFileSync(lockPath(P), 'utf8'));
    const { value, opened } = refusingTokenOpens(() => ({
      held: /** @type {LockState} */ (readLock(P)),
      again: acquireLock(P, { holder: 'check' }),
    }));
    assert.deepEqual(opened, [], 'the token file was not opened by its own holder');
    assert.equal(value.held.stale, false);
    assert.equal(value.again.reentrant, true, 'a second take in the same process is reentrant');
    // Every file under the store stays readable while the lock is held (a backup, a test's snapshot).
    for (const name of readdirSync(P.store.reports)) readFileSync(join(P.store.reports, name));
    assert.ok(existsSync(tokenPath(P.store.reports, token)));
    // Another process proves it by the file and finds the lock held.
    assert.equal(elsewhere(P).stale, false);
    l.release();
    assert.ok(!existsSync(tokenPath(P.store.reports, token)), 'release removes the token file');
    assert.equal(elsewhere(P), null);
  } finally {
    l.release();
  }
});
