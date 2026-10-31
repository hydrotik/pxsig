/**
 * clipboard.test.mjs — copying the dashboard link (src/lib/clipboard.mjs, `serve --link --copy`):
 * which program on which OS, the link on stdin and never on the command line, the Linux fallback,
 * and a missing copier as a note. Nothing touches the real clipboard: `run` is a stand-in.
 *
 *   node --test packages/pxsig/test/clipboard.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyText, feed } from '../src/lib/clipboard.mjs';
import { refused } from '../src/lib/spawn.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
const LINK = 'http://127.0.0.1:6471/report/#ticket=' + 'b'.repeat(64);

/**
 * A stand-in for the copier: records each start with its stdin; a program in `fail` fails.
 * @param {Record<string, Error>} [fail]
 */
function fake(fail = {}) {
  /** @type {[string, string[], string][]} */
  const calls = [];
  /** @type {import('../src/lib/clipboard.mjs').Feed} */
  const run = async (program, args, input) => {
    calls.push([program, args, input]);
    return fail[program] ?? null;
  };
  return { calls, run };
}

test('macOS: pbcopy, the link on stdin and not as an argument', async () => {
  const f = fake();
  assert.deepEqual(await copyText(LINK, { platform: 'darwin', run: f.run }), {
    copied: true,
    note: null,
  });
  assert.deepEqual(f.calls, [['pbcopy', [], LINK]]);
});

test('Linux: wl-copy, else xclip to the clipboard selection', async () => {
  const wayland = fake();
  assert.equal((await copyText(LINK, { platform: 'linux', run: wayland.run })).copied, true);
  assert.deepEqual(wayland.calls, [['wl-copy', [], LINK]]);

  const x11 = fake({ 'wl-copy': new Error('spawn wl-copy ENOENT') });
  assert.equal((await copyText(LINK, { platform: 'linux', run: x11.run })).copied, true);
  assert.deepEqual(
    x11.calls.map(([p, a]) => [p, a]),
    [
      ['wl-copy', []],
      ['xclip', ['-selection', 'clipboard']],
    ]
  );
});

test('a missing copier is a note naming why, never a rejection', async () => {
  const none = fake({
    'wl-copy': new Error('spawn wl-copy ENOENT\nmore'),
    xclip: new Error('exit 1'),
  });
  const c = await copyText(LINK, { platform: 'linux', run: none.run });
  assert.equal(c.copied, false);
  assert.equal(
    c.note,
    'could not copy (wl-copy: spawn wl-copy ENOENT; xclip: exit 1): copy the link above'
  );
});

test('Windows and other OSes: nothing starts; the note says to copy the printed link', async () => {
  for (const platform of ['win32', 'freebsd']) {
    const f = fake();
    const c = await copyText(LINK, { platform, run: f.run });
    assert.deepEqual(f.calls, []);
    assert.equal(c.copied, false);
    assert.match(/** @type {string} */ (c.note), /copy the link above/);
  }
  assert.ok(refused('pbcopy', 'win32'), 'spawn.mjs refuses a copier on Windows');
  assert.equal(refused('pbcopy', 'darwin'), null);
  assert.equal(refused('xclip', 'linux'), null);
  assert.equal(refused('wl-copy', 'linux'), null);
});

test('the real feed writes the input to stdin and reads the exit code (node as the program)', async () => {
  const echo = `let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>process.exit(s===${JSON.stringify(LINK)}?0:4))`;
  assert.equal(await feed(process.execPath, ['-e', echo], LINK), null);
  const err = await feed(process.execPath, ['-e', 'process.exit(3)'], LINK);
  assert.equal(err?.message, 'exit 3');
});

test('`serve --copy` without --link is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-copy-'));
  const r = spawnSync(process.execPath, [cli, 'serve', '--copy'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--copy goes with --link/);
});
