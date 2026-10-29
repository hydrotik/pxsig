/**
 * repair-apply.test.mjs — the repairs that write (lib/repair.mjs), on fixture projects in temp dirs:
 * restore only when the gate passes, a stale render, applyRepairs, prune, running without hooks,
 * and the write guard. Gate tests need the Rust binary and are skipped without it.
 *
 *   node --test packages/pxsig/test/repair-apply.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { reconcile } from '../src/lib/integrity.mjs';
import { readSection } from '../src/lib/psig.mjs';
import {
  applyRepairs,
  guardWrite,
  planRepairs,
  pruneOrphans,
  restoreBaselineImages,
} from '../src/lib/repair.mjs';
import { fixture, hashSignatures, hasRust } from './fixture.mjs';
import { codesOf, statusOf } from './integrity-helpers.mjs';
/** @import { ManifestEntry } from '../src/types.js' */
/** @import { LedgerEntry } from './integrity-helpers.mjs' */

test(
  'restore: only when the latest render passes the signature gate; otherwise flagged with the reconstruction',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const baselines = hashSignatures(join(f.px, 'baselines'));
    const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
    const res = restoreBaselineImages(
      f.ctx,
      led,
      [f.ids.restorable, f.ids.unrecoverable, f.ids.ok],
      { by: 'test', via: 'test' }
    );
    const by = Object.fromEntries(res.map((r) => [r.id, r]));
    assert.equal(by[f.ids.restorable].result, 'restored');
    assert.deepEqual(
      readSection(f.sig(f.ids.restorable), 'image'),
      readFileSync(f.latest(f.ids.restorable))
    );
    assert.equal(by[f.ids.unrecoverable].result, 'unrecoverable: changed');
    assert.ok(!f.hasBaseImage(f.ids.unrecoverable), 'a failing render is never promoted');
    assert.ok(
      existsSync(join(f.px, 'diffs', 'latest', `${f.ids.unrecoverable}.baseline.png`)),
      'signature reconstruction kept for display'
    );
    assert.equal(by[f.ids.ok].result, 'skipped', 'an existing baseline image is never overwritten');
    assert.equal(hashSignatures(join(f.px, 'baselines')), baselines, 'signatures untouched');
    const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      log.map((l) => [l.id, l.result]),
      res.map((r) => [r.id, r.result])
    );
    assert.ok(
      log.every((l) => l.by === 'test' && l.at && l.why && l.action === 'restore-baseline-image')
    );
    const after = await reconcile(f.ctx, { index: f.index, affected: f.affected });
    assert.ok(
      !(
        /** @type {string[]} */ (codesOf(after, f.ids.restorable)).includes(
          'missing-baseline-image'
        )
      )
    );
    assert.ok(
      /** @type {string[]} */ (codesOf(after, f.ids.unrecoverable)).includes(
        'missing-baseline-image'
      )
    );
  }
);

test(
  'a stale render is not used to restore a baseline image',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
    const x = /** @type {LedgerEntry} */ (led.entries.find((e) => e.id === f.ids.restorable));
    x.issues.push({ code: 'stale', severity: 'warn', reason: 'test' });
    const [r] = restoreBaselineImages(f.ctx, led, [f.ids.restorable], { by: 't', via: 't' });
    assert.equal(r.result, 'blocked');
    assert.ok(!f.hasBaseImage(f.ids.restorable));
  }
);

test(
  'applyRepairs runs every safe step, never touches signatures, and logs who/what/why',
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const f = fixture();
    const baselines = hashSignatures(join(f.px, 'baselines'));
    const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
    const plan = planRepairs(led, {
      server: { up: true },
      only: ['register', 'recheck', 'restore-baseline-image'],
    });
    /** @type {string[]} */
    const rechecked = [];
    const res = await applyRepairs(f.ctx, plan, {
      by: 'tester',
      via: 'test',
      reconcileOpts: { index: f.index, affected: f.affected },
      hooks: {
        recheck: async (/** @type {string[]} */ ids) =>
          (rechecked.push(...ids), { via: 'stub' }),
        harvest: async (/** @type {string[]} */ ids) =>
          Object.fromEntries(ids.map((id) => [id, { pxsig: {}, tags: [] }])),
      },
    });
    assert.deepEqual(
      res.steps.map((s) => s.action),
      ['register', 'recheck', 'restore-baseline-image']
    );
    assert.ok(rechecked.includes(f.ids.never));
    assert.match(res.steps[2].result, /2 restored · 1 unrecoverable/);
    assert.equal(
      hashSignatures(join(f.px, 'baselines')),
      baselines,
      'signatures untouched by every repair'
    );
    assert.equal(statusOf(res.ledger, f.ids.unregistered), 'unbaselined');
    const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      [...new Set(log.map((l) => l.action))],
      ['register', 'recheck', 'restore-baseline-image']
    );
    assert.ok(log.every((l) => l.by === 'tester' && l.via === 'test' && l.schemaVersion === 1));
  }
);

test('prune needs confirmation, moves orphans to trash/ and deletes nothing', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { only: ['prune'], prune: true });
  assert.equal(plan.steps[0].action, 'prune');
  const refused = await applyRepairs(f.ctx, plan, {
    by: 't',
    via: 't',
    reconcileOpts: { index: f.index, affected: f.affected },
    hooks: { confirmPrune: async () => false },
  });
  assert.match(refused.steps[0].result, /not confirmed/);
  assert.ok(existsSync(join(f.px, 'baselines', 'components', 'Old', 'components-old--x.psig')));
  const r = pruneOrphans(f.ctx, led, plan.steps[0].ids, { by: 't', via: 't' });
  assert.ok(!existsSync(join(f.px, 'baselines', 'components', 'Old', 'components-old--x.psig')));
  for (const m of r.moved) assert.ok(existsSync(join(f.repo, m.to)), `${m.from} kept in trash/`);
  assert.deepEqual(r.droppedEntries, [f.ids.gone]);
  assert.ok(
    !JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8')).stories.some(
      (/** @type {ManifestEntry} */ e) => e.id === f.ids.gone
    )
  );
});

test('applyRepairs without hooks: prune is not confirmed, a register or re-check step says what is missing', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const pruned = await applyRepairs(f.ctx, planRepairs(led, { only: ['prune'], prune: true }));
  assert.match(pruned.steps[0].result, /not confirmed/);
  const reconcileOpts = { index: f.index, affected: f.affected };
  await assert.rejects(
    applyRepairs(f.ctx, planRepairs(led, { server: { up: true }, only: ['register'] }), {
      reconcileOpts,
    }),
    /a register step needs hooks\.harvest/
  );
  await assert.rejects(
    applyRepairs(f.ctx, planRepairs(led, { server: { up: true }, only: ['recheck'] }), {
      reconcileOpts,
    }),
    /a recheck step needs hooks\.recheck/
  );
});

test('the write guard refuses baselines and the baselines folder', () => {
  const f = fixture({ withSigs: false });
  assert.throws(
    () => guardWrite(f.ctx, join(f.px, 'baselines', 'notes.json')),
    /never writes signatures/
  );
  assert.throws(
    () => guardWrite(f.ctx, join(f.repo, 'anywhere', 'x.psig')),
    /never writes signatures/
  );
  assert.throws(
    () => guardWrite(f.ctx, join(f.repo, 'anywhere', 'x.pxsig.json')),
    /never writes signatures/
  );
  assert.equal(
    guardWrite(f.ctx, join(f.px, 'renders', 'latest', 'x.png')),
    join(f.px, 'renders', 'latest', 'x.png')
  );
});
