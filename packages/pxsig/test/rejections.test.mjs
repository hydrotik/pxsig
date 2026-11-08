/**
 * rejections.test.mjs — lib/rejections.mjs, the open rejections: the reason as stored (one line,
 * 280 characters), the decision reference, opening and closing with their log lines, the checks a
 * rejection gains, an assistant's reason beside a person's, and the review files without reasons.
 *
 *   node --test packages/pxsig/test/rejections.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { decisionRef } from '../src/lib/approvals.mjs';
import {
  afterCheck,
  byPerson,
  closeRejection,
  NOTE_MAX,
  openRejection,
  readRejections,
  sanitizeNote,
  withoutNotes,
} from '../src/lib/rejections.mjs';
import { tempDir } from './fixture.mjs';

/** @import { CheckRow } from '../src/types.js' */

const REF = /^d_[A-Za-z0-9_-]{16}$/;

/**
 * A store outside any repository: nothing there can be committed, so a note is kept.
 * @param {import('node:test').TestContext} t
 */
const store = (t) => {
  const root = tempDir('reports', t);
  return { workspaceRoot: root, store: { root, reports: join(root, 'reports') } };
};

/** @param {{ store: { reports: string } }} P */
const events = (P) => {
  const file = join(P.store.reports, 'rejections.ndjson');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];
};

/**
 * @param {string} id
 * @param {Partial<CheckRow>} [extra]
 * @returns {CheckRow}
 */
const row = (id, extra = {}) => ({ id, story: id, pass: false, metrics: { ssim: 0.9 }, ...extra });

test('a reason is one line of at most 280 characters; nothing left is no reason', () => {
  assert.equal(sanitizeNote('  the text\nshifts\r\nright\t '), 'the text shifts right');
  assert.equal(sanitizeNote('a\u0000b\u0007c\u001bd\u007fe\u2028f\u2029g'), 'a b c d e f g');
  assert.equal(
    sanitizeNote('left\u202eright\u2066x'),
    'left right x',
    'no bidirectional overrides'
  );
  assert.equal(sanitizeNote(''), null);
  assert.equal(sanitizeNote(' \n\t '), null);
  assert.equal(sanitizeNote(undefined), null);
  assert.equal(sanitizeNote(42), null);
  assert.equal(sanitizeNote({ note: 'x' }), null);
  assert.equal(NOTE_MAX, 280);
  assert.equal(sanitizeNote('x'.repeat(500)), 'x'.repeat(280));
  // Characters, not UTF-16 units: an emoji is never cut in half.
  const emoji = /** @type {string} */ (sanitizeNote('👍🏽'.repeat(300)));
  assert.equal(emoji, '👍🏽'.repeat(280));
  assert.equal(sanitizeNote(`${'y'.repeat(279)} z`), 'y'.repeat(279), 'trimmed after the cut');
});

test('a decision reference is opaque, random and unique', () => {
  const refs = Array.from({ length: 500 }, decisionRef);
  for (const r of refs) assert.match(r, REF);
  assert.equal(new Set(refs).size, refs.length);
});

test('a reject opens a rejection; another adds its reason; a close logs and keeps it', (t) => {
  const P = store(t);
  assert.deepEqual(readRejections(P), { visual: {}, a11y: {} }, 'no file reads as none');
  const id = 'ui-button--primary';
  const r1 = openRejection(P, 'visual', id, { via: 'dashboard', note: 'the label shifts right' });
  assert.match(r1.ref, REF);
  assert.deepEqual(
    { ...r1, at: '-', ref: '-', notes: r1.notes.map((n) => n.note) },
    {
      at: '-',
      ref: '-',
      via: 'dashboard',
      note: 'the label shifts right',
      notes: ['the label shifts right'],
      checks: [],
      packet: null,
    }
  );
  const r2 = openRejection(P, 'visual', id, { via: 'dashboard', note: 'keep the spacing' });
  assert.equal(r2.ref, r1.ref, 'the rejection keeps its reference');
  assert.equal(r2.at, r1.at);
  assert.equal(r2.note, 'keep the spacing', 'the newest reason leads');
  assert.deepEqual(
    r2.notes.map((n) => n.note),
    ['keep the spacing', 'the label shifts right']
  );
  assert.notEqual(r2.notes[0].ref, r2.notes[1].ref, 'each reason is its own decision');
  assert.deepEqual(readRejections(P).visual[id], r2);

  const closed = closeRejection(P, 'visual', id, 'undone', { via: 'dashboard', ref: 'd_x' });
  assert.deepEqual(closed, r2);
  assert.deepEqual(readRejections(P), { visual: {}, a11y: {} });
  assert.equal(closeRejection(P, 'visual', id, 'undone'), null, 'nothing open: nothing closes');
  const log = events(P);
  assert.deepEqual(
    log.map((e) => [e.event, e.kind, e.id, e.note ?? null, e.as ?? null]),
    [
      ['rejected', 'visual', id, 'the label shifts right', null],
      ['note', 'visual', id, 'keep the spacing', null],
      ['closed', 'visual', id, null, 'undone'],
    ]
  );
  assert.equal(log[2].rejection, r1.ref, 'the close names the rejection it closed');
  assert.equal(log[2].ref, 'd_x', "and the closing decision's reference");
  for (const e of log) assert.match(e.pxsig, /^\d+\.\d+\.\d+/);
  for (const e of log) assert.equal(e.by, undefined, 'no identity');
});

test("an assistant's reason never leads over a person's, and it may close only its own", (t) => {
  const P = store(t);
  const id = 'ui-button--primary';
  const own = openRejection(P, 'visual', id, { via: 'mcp', note: 'an assistant saw this' });
  assert.equal(byPerson(own), false);
  const person = openRejection(P, 'visual', id, { via: 'dashboard', note: 'too tight' });
  assert.equal(person.via, 'dashboard');
  assert.equal(person.note, 'too tight');
  assert.equal(byPerson(person), true);
  const after = openRejection(P, 'visual', id, { via: 'mcp', note: 'fixed, re-checking' });
  assert.equal(after.via, 'dashboard', "the person's reason still leads");
  assert.equal(after.note, 'too tight');
  assert.deepEqual(
    after.notes.map((n) => [n.via, n.note]),
    [
      ['mcp', 'fixed, re-checking'],
      ['dashboard', 'too tight'],
      ['mcp', 'an assistant saw this'],
    ]
  );
  assert.equal(byPerson(after), true);
  assert.equal(byPerson(undefined), false);
});

test('after a check: a failing entry gains the check, a pass closes it, a removed entry closes', (t) => {
  const P = store(t);
  const [a, b, c, d] = ['x-a--one', 'x-b--two', 'x-c--three', 'x-d--four'];
  openRejection(P, 'visual', a, { via: 'dashboard', note: 'a' });
  openRejection(P, 'visual', b, { via: 'dashboard', note: null });
  openRejection(P, 'a11y', b, { via: 'dashboard', note: 'contrast' });
  openRejection(P, 'visual', c, { via: 'cli', note: 'gone' });
  openRejection(P, 'a11y', d, { via: 'dashboard', note: 'no results' });
  const at = '2026-11-07T10:00:00.000Z';
  const r = afterCheck(
    P,
    [
      row(a),
      row(b, { pass: true, metrics: { ssim: 1 }, a11y: { violations: [{ id: 'x' }], new: 1 } }),
      row(d, { skipped: true, pass: true }),
    ],
    { known: new Set([a, b, d]), at }
  );
  assert.deepEqual(
    r.closed.map((x) => [x.kind, x.id, x.as]),
    [
      ['visual', b, 'passed'],
      ['visual', c, 'removed'],
    ]
  );
  assert.deepEqual(
    r.checked.map((x) => [x.kind, x.id]),
    [
      ['visual', a],
      ['a11y', b],
    ]
  );
  const open = readRejections(P);
  assert.deepEqual(Object.keys(open.visual), [a]);
  assert.deepEqual(open.visual[a].checks, [{ at, pass: false, ssim: 0.9 }]);
  assert.deepEqual(open.a11y[b].checks, [{ at, pass: false, new: 1 }]);
  assert.deepEqual(open.a11y[d].checks, [], 'a skipped row says nothing');
  assert.equal(open.visual[a].note, 'a', 'the reason stays');

  // No new violations closes the a11y rejection; an error says nothing about it.
  afterCheck(P, [row(b, { a11y: { violations: [{ id: 'x' }], new: 0 } })]);
  afterCheck(P, [row(d, { error: 'timeout', a11y: { violations: [], new: 0 } })]);
  assert.deepEqual(Object.keys(readRejections(P).a11y), [d]);
  const log = events(P).filter((e) => e.event !== 'rejected');
  assert.deepEqual(
    log.map((e) => [e.event, e.kind, e.id, e.as ?? e.pass]),
    [
      ['checked', 'visual', a, false],
      ['closed', 'visual', b, 'passed'],
      ['checked', 'a11y', b, false],
      ['closed', 'visual', c, 'removed'],
      ['closed', 'a11y', b, 'passed'],
    ]
  );
  const gone = events(P).find((e) => e.event === 'closed' && e.id === c);
  assert.equal(gone.ref, undefined, 'a pass or a removal is not a decision');

  // Nothing open: a check writes nothing.
  const Q = store(t);
  assert.deepEqual(afterCheck(Q, [row(a)]), { closed: [], checked: [] });
  assert.ok(!existsSync(join(Q.store.reports, 'rejections.json')));
});

test('the checks and reasons kept are the last 20', (t) => {
  const P = store(t);
  const id = 'x-a--one';
  for (let i = 0; i < 25; i++) openRejection(P, 'visual', id, { via: 'dashboard', note: `n${i}` });
  for (let i = 0; i < 25; i++) afterCheck(P, [row(id, { metrics: { ssim: i / 100 } })]);
  const r = readRejections(P).visual[id];
  assert.equal(r.notes.length, 20);
  assert.equal(r.notes[0].note, 'n24');
  assert.equal(r.checks.length, 20);
  assert.equal(r.checks.at(-1)?.ssim, 0.24);
});

test('review files without their reasons', () => {
  /** @type {Record<string, { state: string, note?: string, [k: string]: string | undefined }>} */
  const rv = {
    a: { state: 'rejected', at: 't', via: 'dashboard', ref: 'd_x', note: 'why' },
    b: { state: 'approved', at: 't', batch: 'b1' },
  };
  assert.deepEqual(withoutNotes(rv), {
    a: { state: 'rejected', at: 't', via: 'dashboard', ref: 'd_x' },
    b: { state: 'approved', at: 't', batch: 'b1' },
  });
  assert.deepEqual(withoutNotes(null), {});
});
