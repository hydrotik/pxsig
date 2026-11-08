/**
 * decisions.test.mjs — lib/decisions.mjs: whether the store's reports/ is git-ignored, the reason
 * kept beside a decision's reference only then, reading the reasons back whatever the file holds,
 * the one-line reason, and how an undo line's route is read.
 *
 *   node --test packages/pxsig/test/decisions.test.mjs
 *
 * Needs git (skipped without it).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { route } from '../src/lib/approvals.mjs';
import {
  decisionsFile,
  keepReason,
  notKept,
  readReasons,
  reasonText,
  REASON_MAX,
  reportsIgnored,
  reportsIgnoredAsync,
} from '../src/lib/decisions.mjs';
import { sanitizeNote } from '../src/lib/rejections.mjs';
import { tempDir } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = skipUnless(hasGit, 'git missing');

/**
 * A workspace with a store at `.pxsig` (reports/ made); `git` makes it a repository.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {{ git?: boolean, ignore?: string }} [o]
 */
function store(t, { git = true, ignore } = {}) {
  const root = tempDir('decisions', t);
  const P = {
    workspaceRoot: root,
    store: { root: join(root, '.pxsig'), reports: join(root, '.pxsig', 'reports') },
  };
  mkdirSync(P.store.reports, { recursive: true });
  if (git) spawnSync('git', ['init', '-q', root]);
  if (ignore != null) writeFileSync(join(P.store.root, '.gitignore'), ignore);
  return P;
}
/** @param {ReturnType<typeof store>} P */
const both = async (P) => [reportsIgnored(P), await reportsIgnoredAsync(P)];

test(
  'reportsIgnored: ignored, no .gitignore, a tracked file, no repository',
  { skip },
  async (t) => {
    assert.deepEqual(await both(store(t, { ignore: 'reports/\n' })), [true, true], 'ignored');
    assert.deepEqual(await both(store(t)), [false, false], 'no .gitignore');
    assert.deepEqual(await both(store(t, { ignore: 'cache/\n' })), [false, false], 'other folders');
    const tracked = store(t, { ignore: 'reports/\n' });
    writeFileSync(decisionsFile(tracked), '');
    spawnSync('git', ['-C', tracked.workspaceRoot, 'add', '-f', decisionsFile(tracked)]);
    assert.deepEqual(await both(tracked), [false, false], 'a tracked file is never ignored');
    // Outside a repository nothing can be committed. tempDir's parents are no repository.
    assert.deepEqual(await both(store(t, { git: false })), [true, true], 'no repository');
  }
);

test('keepReason: written only with a reason and an ignored reports/; one line per ref', (t) => {
  const P = store(t, { git: false });
  const d = { ref: 'd_aaaaaaaaaaaaaaaa', log: /** @type {const} */ ('approvals'), id: 'a--b' };
  assert.deepEqual(keepReason(P, { ...d, via: 'cli', reason: null }, true), { kept: false });
  assert.deepEqual(keepReason(P, { ...d, via: 'cli', reason: '  \n ' }, true), { kept: false });
  assert.deepEqual(keepReason(P, { ...d, via: 'cli', reason: 'why' }, false), { kept: false });
  assert.deepEqual(readReasons(P), new Map(), 'nothing written');
  const reason = `line one\nline two\u0007 \u202eend ${'x'.repeat(600)}`;
  const r = keepReason(P, { ...d, batch: 'b1-cli', via: 'cli', reason }, true);
  assert.deepEqual(r, { kept: true });
  const [line, ...rest] = readFileSync(decisionsFile(P), 'utf8').trim().split('\n');
  assert.equal(rest.length, 0);
  const l = JSON.parse(line);
  assert.deepEqual(
    Object.keys(l).filter((k) => k !== 'agent'),
    ['at', 'ref', 'log', 'id', 'batch', 'via', 'reason', 'pxsig']
  );
  assert.equal(l.reason, reasonText(reason));
  assert.ok(l.reason.startsWith('line one line two end x'), l.reason);
  assert.equal(l.reason.length, REASON_MAX);
});

test('readReasons: a missing file, torn and broken lines, a folder in its place: never throws', (t) => {
  const P = store(t, { git: false });
  assert.deepEqual(readReasons(P), new Map());
  const ok = { ref: 'd_bbbbbbbbbbbbbbbb', reason: 'kept' };
  const lines = [JSON.stringify(ok), 'not json', '[1]', 'null', '{"ref":5,"reason":"x"}'];
  writeFileSync(decisionsFile(P), `${lines.join('\n')}\n{"ref":"d_cut","reason":"cu`);
  assert.deepEqual(readReasons(P), new Map([[ok.ref, 'kept']]));
  const dir = store(t, { git: false });
  mkdirSync(decisionsFile(dir));
  assert.deepEqual(readReasons(dir), new Map());
});

test('reasonText: one line, control and bidirectional characters as spaces, the limit', () => {
  assert.equal(reasonText('a\r\nb\tc\u2028d\u202ae  '), 'a b c d e');
  assert.equal(reasonText(42), null);
  assert.equal(reasonText(' \n '), null);
  assert.equal((reasonText('é'.repeat(700)) ?? '').length, 500);
  assert.equal(reasonText('abcdef', 3), 'abc');
  assert.equal((sanitizeNote('n'.repeat(300)) ?? '').length, 280, 'a rejection note: 280');
});

test('notKept: one line with the store-relative reports/ and no absolute path', (t) => {
  const P = store(t, { git: false });
  const m = notKept(P);
  assert.equal(
    m,
    'Reason not kept: .pxsig/reports/ is not git-ignored. pxsig doctor shows the fix.'
  );
  assert.ok(!m.includes(P.workspaceRoot) && !m.includes('\n'));
});

test('route(): the undo field, and an old line whose reason ends "(dashboard)"', () => {
  /** @type {[Parameters<typeof route>[0], string][]} */
  const cases = [
    [{ via: 'undo', undo: { in: 'dashboard', from: 'snapshot' } }, 'dashboard'],
    [{ via: 'undo', undo: { in: 'terminal', from: 'git' } }, 'terminal'],
    [{ via: 'undo', reason: 'undo b1 (dashboard)' }, 'dashboard'],
    [{ via: 'undo', reason: 'undo b1 (from git)' }, 'terminal'],
    [
      { via: 'undo', undo: { in: 'terminal', from: 'snapshot' }, reason: 'x (dashboard)' },
      'terminal',
    ],
    [{ via: 'dashboard', undo: { in: 'terminal', from: 'snapshot' } }, 'dashboard'],
    [{ via: 'cli' }, 'terminal'],
  ];
  for (const [l, want] of cases) assert.equal(route(l), want, JSON.stringify(l));
});
