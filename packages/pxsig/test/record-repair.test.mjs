/**
 * record-repair.test.mjs — baselines whose record and image come from different renders
 * (lib/pairs.mjs): `pxsig migrate` leaves such an image out, the ledger reports each pair
 * (`baseline-pair-mismatch`), and "Repair baseline records" (lib/approvals/record-repair.mjs)
 * writes a record again from its own image only when every condition holds, each failing alone
 * making the entry ineligible. The log line, `approve verify`, the review state and the server's
 * refusals are pinned here; the dashboard's confirm is in packages/dashboard/test.
 *
 *   node --test packages/pxsig/test/record-repair.test.mjs
 *
 * Needs the Rust binary (the engine checks the pairs and writes the records); skipped without it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyRecordRepair,
  brokenRepairs,
  planRecordRepair,
  stillEligible,
} from '../src/lib/approvals/record-repair.mjs';
import { readLog, sha256 } from '../src/lib/approvals.mjs';
import { DECISIONS } from '../src/lib/guard.mjs';
import { pairProblems } from '../src/lib/integrity/pairs.mjs';
import { reviewState } from '../src/lib/integrity/unreviewed.mjs';
import { readImage } from '../src/lib/psig.mjs';
import { migrateLegacy } from '../src/lib/setup/migrate.mjs';
import { planRepairs } from '../src/lib/repair.mjs';
import { reconcile, resolveContext } from '../src/lib/integrity.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { CHECKER, fixture, hasRust, rustBin } from './fixture.mjs';
import { DOT, f0, FAR, store } from './record-repair-helpers.mjs';
import { skipUnless } from './strict.mjs';

/** @import { Manifest } from '../src/types.js' */

const skip = skipUnless(hasRust, 'Rust binary not built');
const CLI = join(import.meta.dirname, '..', 'bin', 'pxsig.mjs');

test(
  'eligible only when every condition holds; each one failing alone makes an entry ineligible',
  { skip },
  (t) => {
    const { f, P, manifest } = store(t, {
      // every condition holds
      [f0('ok')]: { record: DOT },
      // 2 fails alone: the latest render differs from the image by one pixel
      [f0('drift')]: { record: DOT, latest: DOT },
      // 3 fails alone: the latest render is the image, and fails the record without colour too
      [f0('changed')]: { record: FAR },
      // 4 fails alone: a person approved it too
      [f0('flaky')]: {
        record: DOT,
        also: [{ at: '2026-11-02T00:00:00.000Z', via: 'dashboard', batch: 'x-dashboard' }],
      },
    });
    const ids = f.ids;
    const plan = planRecordRepair(P, manifest);
    assert.deepEqual(
      plan.eligible.map((x) => x.id),
      [ids.ok]
    );
    assert.match(String(plan.eligible[0].why), /only pxsig migrate approved it/);
    /** @param {string} id */
    const why = (id) => plan.ineligible.find((x) => x.id === id)?.reasons ?? [];
    assert.deepEqual(why(ids.drift), [
      'the latest render is not the baseline image pixel for pixel',
    ]);
    assert.equal(why(ids.changed).length, 1);
    assert.match(
      why(ids.changed)[0],
      /^the latest render fails the current record without the colour rule/
    );
    assert.deepEqual(why(ids.flaky), ['approved by more than pxsig migrate (dashboard)']);
    // 1 fails alone: every other fixture baseline is one render, and is not listed at all.
    assert.equal(plan.mismatched, 4);
    // Bytes written outside the trail after migrate's line.
    const lines = readFileSync(P.store.approvals, 'utf8');
    writeFileSync(P.store.approvals, lines.replace(sha256(f.sig(ids.ok)) ?? '', '0'.repeat(64)));
    assert.deepEqual(
      planRecordRepair(P, manifest).ineligible.find((x) => x.id === ids.ok)?.reasons,
      ['its bytes are not the ones pxsig migrate logged']
    );
  }
);

test(
  'a repair writes the record from the image, logs a person line of its own kind, approves nothing',
  { skip },
  (t) => {
    const { f, P, manifest } = store(t, { [f0('ok')]: { record: DOT } });
    const id = f.ids.ok;
    const image = readImage(f.sig(id));
    const before = sha256(f.sig(id));
    const plan = planRecordRepair(P, manifest);
    const { go, dropped } = stillEligible(plan, plan.eligible);
    assert.deepEqual([go.length, dropped.length], [1, 0]);
    const res = applyRecordRepair(P, manifest, go, { via: 'cli' });
    assert.deepEqual(res.failed, []);
    assert.deepEqual(readImage(f.sig(id)), image, 'the image is byte for byte the same');
    assert.ok(existsSync(join(P.store.history, String(res.batch), `${id}.psig`)), 'snapshotted');
    const line = readLog(P).at(-1);
    assert.deepEqual(Object.keys(line ?? {}).sort(), [
      'after',
      'at',
      'batch',
      'before',
      'gitHead',
      'id',
      'kind',
      'pxsig',
      'recordAfter',
      'recordBefore',
      'ref',
      'via',
    ]);
    assert.equal(line?.kind, 'record-repair');
    assert.equal(line?.via, 'cli');
    assert.equal(line?.before, before);
    assert.equal(line?.after, sha256(f.sig(id)));
    assert.equal(line?.recordBefore, plan.eligible[0].record);
    assert.equal(line?.recordAfter, plan.eligible[0].image, 'the new record is the image');
    // The pair matches now; nothing else is listed.
    const ctx = resolveContext(P);
    assert.deepEqual(pairProblems(ctx), []);
    assert.equal(planRecordRepair(P, manifest).mismatched, 0);
    // A repair is no review: the entry keeps migrate's state.
    const state = reviewState(
      readLog(P).filter((l) => l.id === id),
      String(sha256(f.sig(id)))
    );
    assert.deepEqual(state, { reviewed: false, new: false, by: 'migrate' });
    // Applying the same listed plan again: the bytes changed since it was listed.
    assert.deepEqual(stillEligible(planRecordRepair(P, manifest), plan.eligible).dropped, [
      { id, why: 'no longer eligible' },
    ]);
    assert.deepEqual(brokenRepairs(P, P.manifestPath()), [], 'verify passes the repair');
  }
);

test(
  'approve verify fails a record-repair line whose record does not match its image',
  { skip },
  (t) => {
    const { f, P } = store(t, { [f0('ok')]: { record: DOT } });
    const id = f.ids.ok;
    // A forged line: it logs the mismatched bytes as repaired.
    const forged = {
      at: '2026-11-03T00:00:00.000Z',
      id,
      via: 'cli',
      batch: 'x-cli',
      kind: 'record-repair',
      before: sha256(f.sig(id)),
      after: sha256(f.sig(id)),
    };
    writeFileSync(
      P.store.approvals,
      `${readFileSync(P.store.approvals, 'utf8')}${JSON.stringify(forged)}\n`
    );
    assert.deepEqual(
      brokenRepairs(P, P.manifestPath()).map((x) => x.id),
      [id]
    );
    const r = spawnSync(process.execPath, [CLI, 'approve', 'verify', '--no-strict', '--json'], {
      cwd: f.repo,
      env: { ...f.env, PXSIG_BIN: rustBin, PXSIG_URL: 'http://127.0.0.1:9' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(
      JSON.parse(r.stdout).repairs.map((/** @type {{ id: string }} */ x) => x.id),
      [id]
    );
  }
);

test(
  'doctor and the ledger name every mismatched pair as a setup error; the CLI lists, --yes needs a person',
  { skip },
  async (t) => {
    const { f, P } = store(t, { [f0('ok')]: { record: DOT }, [f0('changed')]: { record: FAR } });
    const ctx = resolveContext(P);
    const [p] = pairProblems({
      ...ctx,
      integrity: { ...ctx.integrity, severity: { 'baseline-pair-mismatch': 'info' } },
    });
    assert.equal(p.code, 'baseline-pair-mismatch');
    assert.equal(p.severity, 'error', 'never lowered');
    assert.deepEqual(p.ids?.sort(), [f.ids.ok, f.ids.changed].sort());
    assert.match(p.reason, /pxsig approve repair-records/);
    assert.match(p.reason, /is not applied: it is an error/);
    const env = { ...f.env, PXSIG_BIN: rustBin, PXSIG_URL: 'http://127.0.0.1:9' };
    /** @param {string[]} args */
    const run = (...args) =>
      spawnSync(process.execPath, [CLI, ...args], { cwd: f.repo, env, encoding: 'utf8' });
    const doctor = run('doctor', '--offline', '--json');
    assert.equal(doctor.status, 2, 'a setup error');
    const setup = JSON.parse(doctor.stdout).setup.find(
      (/** @type {{ code: string }} */ x) => x.code === 'baseline-pair-mismatch'
    );
    assert.equal(setup.pairs.length, 2);
    const listed = run('approve', 'repair-records', '--json');
    assert.equal(listed.status, 0, listed.stderr);
    const plan = JSON.parse(listed.stdout);
    assert.deepEqual([plan.dryRun, plan.eligible.length, plan.ineligible.length], [true, 1, 1]);
    const before = readFileSync(f.sig(f.ids.ok));
    const yes = run('approve', 'repair-records', '--yes');
    assert.equal(yes.status, 3, 'a person at a terminal only');
    assert.deepEqual(readFileSync(f.sig(f.ids.ok)), before, 'nothing written');
    // Never a safe repair: the ledger names the pairs, and no safe repair step touches them.
    const ledger = await reconcile(ctx, { index: f.index, affected: f.affected });
    assert.ok(ledger.setup.some((x) => x.code === 'baseline-pair-mismatch'));
    const steps = planRepairs(ledger, { prune: false, server: { up: false } }).steps;
    assert.ok(
      steps.every((x) => !x.ids.includes(f.ids.ok) && !/record/.test(x.action)),
      JSON.stringify(steps)
    );
    // Through the server, a decision: the dashboard link's cookie or the CLI's token.
    assert.ok(DECISIONS.has('record-repair'));
  }
);

test(
  'migrate leaves out an image from another render and reports its id; a pair from one render keeps it',
  { skip },
  (t) => {
    const f = fixture({ t, withSigs: true });
    const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
    const from = join(f.repo, 'legacy');
    const ids = ['components-zeta--default', 'components-zeta--other'];
    for (const d of ['js', 'sigs', '.baselines', '.renders/base'])
      mkdirSync(join(from, d), { recursive: true });
    for (const [i, id] of ids.entries()) {
      const src = join(from, '.renders', 'base', `${id}.png`);
      writeFileSync(src, CHECKER);
      const recordFrom = join(f.repo, `${id}.png`);
      writeFileSync(recordFrom, i ? DOT : CHECKER);
      const r = spawnSync(
        rustBin,
        ['capture', recordFrom, '--out', join(from, 'sigs', `${id}.pxsig.json`), '--grid', '16'],
        { encoding: 'utf8' }
      );
      assert.equal(r.status, 0, r.stderr);
    }
    const story = (/** @type {string} */ id) => ({
      id,
      story: id,
      mode: 'dark',
      state: null,
      importPath: 'src/zeta.stories.tsx',
      sig: `legacy/sigs/${id}.pxsig.json`,
    });
    writeFileSync(
      join(from, 'js', 'pxsig.manifest.json'),
      JSON.stringify({ stories: ids.map(story) })
    );
    const dry = migrateLegacy(P, { from, apply: false });
    assert.deepEqual(
      dry.pairMismatch.map((x) => x.id),
      [ids[1]]
    );
    assert.equal(dry.summary.pairMismatch, 1);
    assert.equal(dry.summary.withImage, 1);
    const plan = migrateLegacy(P, { from, apply: true, verify: false });
    const out = (/** @type {string} */ id) =>
      /** @type {{ out: string }} */ (plan.pack.find((x) => x.entry.id === id)).out;
    assert.ok(readImage(out(ids[0])), 'one render: packed with its image');
    assert.equal(readImage(out(ids[1])), null, 'two renders: the record alone');
  }
);
