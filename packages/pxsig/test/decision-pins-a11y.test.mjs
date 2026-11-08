/**
 * decision-pins-a11y.test.mjs — what the accessibility log and the store's other files commit or
 * keep today, pinned before a decision's reason and the approver's identity leave the committed
 * logs (design: a decision commits only its reference, PR 1; the approval log's pins are in
 * decision-pins.test.mjs). Each pin names the PR of that design that flips it:
 *   PR 3 — the reason stays on the machine (`reports/decisions.ndjson`); the logs commit `ref`
 *   PR 4 — no person's identity in any log; `approvals.identity` is no longer read
 *   PR 5 — rejection notes only when the store's reports/ is git-ignored
 *
 *   node --test packages/pxsig/test/decision-pins-a11y.test.mjs
 *
 * Needs the Rust binary and git.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { record, sha256 } from '../src/lib/approvals.mjs';
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
 * "git-email"`.
 * @param {{ after: (fn: () => void) => void }} t
 */
function project(t) {
  const f = fixture({ t });
  spawnSync('git', ['init', '-q', f.repo]);
  spawnSync('git', ['-C', f.repo, 'config', 'user.email', EMAIL]);
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
    const { f, P } = project(t);
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
    applyPrune(P, plan, { batch: 'b-prune', reason: 'fixed in #12', via: 'cli' });
    const log = ndjson(join(dirname(P.store.a11y), 'a11y-decisions.ndjson'));
    // Flips in PR 4 (no `by` on any line) and PR 3 (no `reason`: accept's and prune's go local).
    assert.deepEqual(
      log.map((l) => [l.action, l.by, l.reason]),
      [
        ['accept', EMAIL, REASON],
        ['undo', EMAIL, undefined],
        ['accept', EMAIL, null],
        ['unaccept', EMAIL, undefined],
        ['prune', EMAIL, 'fixed in #12'],
      ]
    );
    const [accept, , , , prune] = log.map((l) => Object.keys(l).filter((k) => k !== 'agent'));
    assert.deepEqual(
      accept,
      ['at', 'via', 'ref', 'action', 'id', 'before', 'after', 'reason', 'by'].concat('pxsig')
    );
    assert.deepEqual(prune.slice(-4), ['reason', 'evidence', 'by', 'pxsig']);
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

test("pin 9: the snapshot gives a person's reason; a migration's is null", { skip }, (t) => {
  const { f, P } = project(t);
  const e = /** @type {ManifestEntry} */ (f.manifest.stories.find((x) => x.id === f.ids.ok));
  record(P, e, { batch: 'b1-cli', via: 'cli', reason: REASON, before: null });
  const at = new Date().toISOString();
  const moved = { at, id: f.ids.a11y, via: 'migrate', batch: 'b2-migrate', reason: 'moved from x' };
  appendFileSync(P.store.approvals, `${JSON.stringify(moved)}\n`);
  const snap = /** @type {Snap} */ (/** @type {unknown} */ (buildSnapshot([P])));
  const entries = Object.values(snap.projects[P.name].stories).flatMap((s) => s.entries);
  /** @param {string} id */
  const reason = (id) => entries.find((x) => x.id === id)?.approved?.reason;
  // Flips in PR 3: `reason` always null (the key stays; SNAPSHOT_VERSION 1).
  assert.equal(reason(f.ids.ok), REASON);
  assert.equal(reason(f.ids.a11y), null);
});

test('pin 12: repairs.ndjson carries `by` with git-email', { skip }, async (t) => {
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
  // Flips in PR 4: no `by` (repairs.ndjson is local, git-ignored).
  for (const l of log) assert.equal(l.by, EMAIL);
});

test('pin 14: a rejection is written while reports/ is not git-ignored', { skip }, (t) => {
  const { f, P } = project(t);
  const ignored = spawnSync('git', ['-C', P.store.root, 'check-ignore', '-q', 'reports/x.json']);
  assert.equal(ignored.status, 1, 'the fixture store does not ignore reports/');
  openRejection(P, 'visual', f.ids.changed, { via: 'cli', note: 'the border is wrong' });
  // Flips in PR 5: nothing written while reports/ is not git-ignored.
  for (const n of ['rejections.json', 'rejections.ndjson'])
    assert.ok(existsSync(join(P.store.reports, n)), n);
});
