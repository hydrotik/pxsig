/**
 * decision-pins-a11y.test.mjs — what the accessibility log and the store's other files commit or
 * keep, pinned while a decision's reason and the approver's identity leave the committed logs
 * (design: a decision commits only its reference; the approval log's pins are in
 * decision-pins.test.mjs). PR 3 flipped its pins: the reason stays on the machine
 * (`reports/decisions.ndjson`, only when reports/ is git-ignored); PR 4, no person's identity in
 * any log (`approvals.identity` is no longer read); PR 5, a rejection's note only when the store's
 * reports/ is git-ignored (pin 14).
 *
 *   node --test packages/pxsig/test/decision-pins-a11y.test.mjs
 *
 * Needs the Rust binary and git.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { record, sha256 } from '../src/lib/approvals.mjs';
import { decisionsFile, forgetIgnored, readReasons } from '../src/lib/decisions.mjs';
import { reconcile, resolveContext } from '../src/lib/integrity.mjs';
import { applyPrune } from '../src/lib/prune.mjs';
import { readHeader } from '../src/lib/psig.mjs';
import { openRejection } from '../src/lib/rejections.mjs';
import { applyRepairs, planRepairs } from '../src/lib/repair.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { buildSnapshot } from '../src/snapshot.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';
import { serve } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { ManifestEntry } from '../src/types.js' */
/**
 * The snapshot's keys read here (src/snapshot.mjs builds it).
 * @typedef {{ id: string, approved: { reason: string | null } | null }} SnapEntry
 * @typedef {{ projects: Record<string, { stories: Record<string, { entries: SnapEntry[], history: { reason: string | null }[] }> }> }} Snap
 */

const EMAIL = 'probe@example.test';
const REASON = 'contrast reviewed with the design team';
const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = skipUnless(hasRust && hasGit, 'Rust binary or git missing');

/**
 * A fixture in a real git repository whose git email is the probe, on `approvals.identity:
 * "git-email"`; `ignored` gives the store the .gitignore `pxsig init` writes.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {{ ignored?: boolean }} [o]
 */
function project(t, { ignored = false } = {}) {
  const f = fixture({ t });
  spawnSync('git', ['init', '-q', f.repo]);
  spawnSync('git', ['-C', f.repo, 'config', 'user.email', EMAIL]);
  if (ignored) writeFileSync(join(f.px, '.gitignore'), 'reports/\n');
  const cfg = join(f.repo, 'pxsig.config.json');
  const c = JSON.parse(readFileSync(cfg, 'utf8'));
  writeFileSync(cfg, JSON.stringify({ ...c, approvals: { identity: 'git-email' } }, null, 2));
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  return { f, P };
}

/** @param {string} file */
const ndjson = (file) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

test(
  'pins 8, 13: the a11y log through the server and a prune; a .psig header',
  { skip },
  async (t) => {
    const { f, P } = project(t, { ignored: true });
    const id = f.ids.a11y;
    const S = await serve(f);
    try {
      for (const [action, body] of /** @type {[string, object][]} */ ([
        ['a11y-accept', { id, reason: REASON }],
        ['a11y-unreview', { id }],
        ['a11y-accept', { id }],
        ['a11y-unaccept', { id, rule: 'color-contrast' }],
        ['approve', { id: f.ids.changed }],
      ])) {
        const r = await S.post(action, body);
        assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
      }
    } finally {
      await S.stop();
    }
    writeFileSync(P.store.a11y, JSON.stringify({ [id]: ['color-contrast', 'region'] }));
    const plan = { a11ySha: sha256(P.store.a11y), prune: [{ id, rules: ['region'] }] };
    applyPrune(P, plan, { batch: 'b-prune', reason: 'fixed in #12', ignored: true, via: 'cli' });
    const log = ndjson(join(dirname(P.store.a11y), 'a11y-decisions.ndjson'));
    // PR 3: no `reason` on any line; accept's and prune's stay local, beside the line's ref.
    // PR 4: no `by` on any line.
    assert.deepEqual(
      log.map((l) => [l.action, 'by' in l, 'reason' in l]),
      [
        ['accept', false, false],
        ['undo', false, false],
        ['accept', false, false],
        ['unaccept', false, false],
        ['prune', false, false],
      ]
    );
    const [accept, , , , prune] = log.map((l) => Object.keys(l).filter((k) => k !== 'agent'));
    assert.deepEqual(
      accept,
      ['at', 'via', 'ref', 'action', 'id', 'before', 'after'].concat('pxsig')
    );
    assert.deepEqual(prune.slice(-3), ['batch', 'evidence', 'pxsig']);
    assert.ok(!JSON.stringify(log).includes(EMAIL), 'the a11y log names no one');
    const kept = readReasons(P);
    assert.deepEqual(
      [kept.get(log[0].ref), kept.get(log[2].ref), kept.get(log[4].ref)],
      [REASON, undefined, 'fixed in #12']
    );
    const local = ndjson(decisionsFile(P));
    assert.deepEqual(
      local.map((l) => [l.log, l.id]),
      [
        ['a11y', id],
        ['a11y', id],
      ]
    );
    assert.ok(!JSON.stringify(local).includes(EMAIL), 'the local file names no person');
    assert.ok(!readFileSync(P.store.approvals, 'utf8').includes(REASON));
    // Pin 13 (stays): a baseline's header names the render, never a person.
    for (const sig of [f.sig(f.ids.ok), f.sig(f.ids.changed)]) {
      const h = /** @type {Record<string, any>} */ (readHeader(sig));
      const all = ['format', 'container', 'entry', 'env', 'record', 'encryption', 'sections'];
      assert.deepEqual(
        Object.keys(h),
        all.filter((k) => k in h)
      );
      assert.equal(h.record.source, `${h.entry.id}.png`);
      const text = JSON.stringify(h);
      assert.ok(!/"(by|reason|user|host)":/.test(text) && !text.includes(EMAIL), text);
    }
  }
);

test(
  "pin 9: the snapshot gives no reason: not the local file's, not an old line's",
  { skip },
  (t) => {
    const { f, P } = project(t, { ignored: true });
    const e = /** @type {ManifestEntry} */ (f.manifest.stories.find((x) => x.id === f.ids.ok));
    record(P, e, { batch: 'b1-cli', via: 'cli', reason: REASON, ignored: true, before: null });
    assert.equal(readReasons(P).size, 1, 'the reason is kept locally');
    const at = new Date().toISOString();
    const moved = {
      at,
      id: f.ids.a11y,
      via: 'migrate',
      batch: 'b2-migrate',
      reason: 'moved from x',
    };
    const old = { at, id: f.ids.changed, via: 'cli', batch: 'b0-cli', reason: 'an old reason' };
    appendFileSync(P.store.approvals, `${JSON.stringify(moved)}\n${JSON.stringify(old)}\n`);
    const snap = /** @type {Snap} */ (/** @type {unknown} */ (buildSnapshot([P])));
    const entries = Object.values(snap.projects[P.name].stories).flatMap((s) => s.entries);
    /** @param {string} id */
    const reason = (id) => entries.find((x) => x.id === id)?.approved?.reason;
    // PR 3: `reason` always null (the key stays; SNAPSHOT_VERSION 1).
    for (const id of [f.ids.ok, f.ids.a11y, f.ids.changed]) assert.equal(reason(id), null, id);
    const histories = Object.values(snap.projects[P.name].stories).flatMap((s) => s.history);
    assert.ok(histories.length && histories.every((h) => h.reason === null));
    assert.ok(!JSON.stringify(snap).includes(REASON) && !JSON.stringify(snap).includes('an old'));
  }
);

test('pin 12: repairs.ndjson carries no `by`, even with git-email', { skip }, async (t) => {
  const { f, P } = project(t);
  const ctx = resolveContext(P);
  const opts = { index: f.index, affected: f.affected };
  const plan = planRepairs(await reconcile(ctx, opts), { only: ['prune'], prune: true });
  await applyRepairs(ctx, plan, {
    via: 'cli',
    reconcileOpts: opts,
    hooks: { confirmPrune: async () => true },
  });
  const log = ndjson(join(f.px, 'reports', 'repairs.ndjson'));
  assert.ok(log.length > 0);
  // PR 4: no `by` (repairs.ndjson is local, git-ignored, and names no one either).
  for (const l of log) assert.ok(!('by' in l), JSON.stringify(l));
  assert.ok(!readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8').includes(EMAIL));
});

test('pin 14: while reports/ is not git-ignored a rejection opens with no note', { skip }, (t) => {
  const { f, P } = project(t);
  const ignored = spawnSync('git', ['-C', P.store.root, 'check-ignore', '-q', 'reports/x.json']);
  assert.equal(ignored.status, 1, 'the fixture store does not ignore reports/');
  forgetIgnored();
  const id = f.ids.changed;
  const r = openRejection(P, 'visual', id, { via: 'cli', note: 'the border is wrong' });
  // PR 5: the rejection is kept, its note is not (a file git could commit never holds one).
  assert.equal(r.note, null);
  assert.deepEqual(
    r.notes.map((n) => [n.via, n.note]),
    [['cli', null]]
  );
  const open = JSON.parse(readFileSync(join(P.store.reports, 'rejections.json'), 'utf8'));
  assert.equal(open.visual[id].note, null);
  const log = ndjson(join(P.store.reports, 'rejections.ndjson'));
  assert.deepEqual(
    log.map((l) => [l.event, l.kind, l.id, l.via, l.note]),
    [['rejected', 'visual', id, 'cli', null]]
  );
  for (const n of ['rejections.json', 'rejections.ndjson'])
    assert.ok(!readFileSync(join(P.store.reports, n), 'utf8').includes('border'), n);
});
