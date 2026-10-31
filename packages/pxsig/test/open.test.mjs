/**
 * open.test.mjs — opening a dashboard address in the browser (src/lib/open.mjs): which program on
 * which OS, its arguments, a reused Chrome tab, and a missing or failing opener as a note. No
 * program starts: `run` is a stand-in.
 *
 *   node --test packages/pxsig/test/open.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openLink, reuseTabScript } from '../src/lib/open.mjs';
import { refused } from '../src/lib/spawn.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pxsig.mjs');
const LINK = 'http://127.0.0.1:6471/report/#ticket=' + 'a'.repeat(64);

/**
 * A stand-in for lib/spawn.mjs's execFile: records each start and answers from `answers`
 * (program → [err, out]); a program in `throws` is refused as spawn.mjs refuses one.
 * @param {Record<string, [Error | null, string?]>} [answers]
 * @param {string[]} [throws]
 */
function fake(answers = {}, throws = []) {
  /** @type {[string, string[]][]} */
  const calls = [];
  /** @type {import('../src/lib/open.mjs').Run} */
  const run = (program, args, done) => {
    calls.push([program, args]);
    if (throws.includes(program)) throw new Error(`pxsig does not start "${program}"`);
    const [err, out] = answers[program] ?? [null, ''];
    setImmediate(() => done(err, out));
  };
  return { calls, run };
}

test('Linux: xdg-open with the link as its one argument', async () => {
  const f = fake();
  const o = await openLink(LINK, { platform: 'linux', run: f.run });
  assert.deepEqual(f.calls, [['xdg-open', [LINK]]]);
  assert.deepEqual(o, { opened: true, reused: false, note: null });
});

test('macOS: a Chrome tab on the same origin is reused, else `open`', async () => {
  const reused = fake({ osascript: [null, 'reused\n'] });
  assert.deepEqual(await openLink(LINK, { platform: 'darwin', run: reused.run }), {
    opened: true,
    reused: true,
    note: null,
  });
  assert.equal(reused.calls.length, 1);
  assert.equal(reused.calls[0][0], 'osascript');
  assert.deepEqual(reused.calls[0][1], ['-e', reuseTabScript(LINK)]);

  const none = fake({ osascript: [null, 'none\n'] });
  const o = await openLink(LINK, { platform: 'darwin', run: none.run });
  assert.deepEqual(
    none.calls.map(([p, a]) => [p, p === 'open' ? a : a.length]),
    [
      ['osascript', 2],
      ['open', [LINK]],
    ]
  );
  assert.equal(o.opened, true);
  assert.equal(o.reused, false);
});

test('macOS: osascript failing (no Chrome control) still opens with `open`', async () => {
  const f = fake({ osascript: [new Error('not allowed to send Apple events')] });
  const o = await openLink(LINK, { platform: 'darwin', run: f.run });
  assert.deepEqual(
    f.calls.map(([p]) => p),
    ['osascript', 'open']
  );
  assert.equal(o.opened, true);
});

test('the reuse script matches the origin and sets the whole link', () => {
  const s = reuseTabScript(LINK);
  assert.match(s, /starts with "http:\/\/127\.0\.0\.1:6471"/);
  assert.ok(s.includes(`set URL of t to "${LINK}"`));
});

test('Windows: nothing starts; the note says to open the printed link', async () => {
  const f = fake();
  const o = await openLink(LINK, { platform: 'win32', run: f.run });
  assert.deepEqual(f.calls, []);
  assert.equal(o.opened, false);
  assert.match(/** @type {string} */ (o.note), /open the link above/);
});

test('a missing or failing opener is a note, never a rejection', async () => {
  const missing = fake({ 'xdg-open': [new Error('spawn xdg-open ENOENT\nmore')] });
  const o = await openLink(LINK, { platform: 'linux', run: missing.run });
  assert.equal(o.opened, false);
  assert.equal(o.note, 'could not open a browser (spawn xdg-open ENOENT): open the link above');

  const mac = fake({ osascript: [null, 'none'], open: [new Error('exit 1')] });
  assert.match(
    /** @type {string} */ ((await openLink(LINK, { platform: 'darwin', run: mac.run })).note),
    /could not open a browser \(exit 1\)/
  );

  // An OS whose list has no opener: lib/spawn.mjs refuses xdg-open, synchronously.
  assert.ok(refused('xdg-open', 'freebsd'));
  const bsd = fake({}, ['xdg-open']);
  const r = await openLink(LINK, { platform: 'freebsd', run: bsd.run });
  assert.equal(r.opened, false);
  assert.match(/** @type {string} */ (r.note), /pxsig does not start "xdg-open"/);
});

test('`serve --open` without --link is a usage error (serve opens a tab by itself)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-open-'));
  const r = spawnSync(process.execPath, [cli, 'serve', '--open'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--open goes with --link/);
});
