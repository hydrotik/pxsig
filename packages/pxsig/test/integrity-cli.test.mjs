/**
 * integrity-cli.test.mjs — `pxsig doctor`'s CLI contract and legacy `.pxsig.json` baselines, on
 * fixture projects in temp dirs.
 *
 *   node --test packages/pxsig/test/integrity-cli.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { reconcile, writeLedger } from '../src/lib/integrity.mjs';
import { readSection } from '../src/lib/psig.mjs';
import { applyRepairs, planRepairs } from '../src/lib/repair.mjs';
import { fixture, hasRust, rustBin, testEnv, testHome } from './fixture.mjs';
import { here, codesOf, statusOf } from './integrity-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { SpawnSyncOptionsWithStringEncoding } from 'node:child_process' */
/** @import { ManifestEntry } from '../src/types.js' */
/** @import { LedgerEntry, LedgerIssue } from './integrity-helpers.mjs' */

// --- the CLI contract -------------------------------------------------------------------------------------

test('pxsig doctor CLI contract: --json document, filters, usage errors, prune refused when piped', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  writeLedger(f.ctx, led);
  const cli = join(here, '..', 'src', 'cli.mjs');
  /** @type {SpawnSyncOptionsWithStringEncoding} */
  const opts = {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...testEnv(testHome), PXSIG_FORMAT: '', PXSIG_BIN: rustBin },
  };
  const r = spawnSync(
    process.execPath,
    [cli, 'doctor', '--json', '--offline', '--status', 'never-checked'],
    opts
  );
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schemaVersion, 1);
  assert.ok(doc.summary && doc.components && doc.entries);
  assert.ok(
    doc.entries.list.every((/** @type {LedgerEntry} */ x) =>
      x.issues.some((i) => i.code === 'never-checked')
    )
  );
  assert.ok(/** @type {(number | null)[]} */ ([0, 1]).includes(r.status));
  const usage = spawnSync(process.execPath, [cli, 'doctor', '--repair', '--only', 'nope'], opts);
  assert.equal(usage.status, 2);
  const prune = spawnSync(
    process.execPath,
    [cli, 'doctor', '--repair', '--apply', '--prune'],
    opts
  );
  assert.equal(prune.status, 3, 'prune is refused when piped');
});

// --- legacy .pxsig.json baselines ---------------------------------------------------------------------------

test('a .pxsig.json baseline is legacy-format (warn), not a missing image; unaffected skips are info, not never-checked', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.deepEqual(codesOf(led, f.ids.legacy), ['legacy-format']);
  // A legacy-format issue carries a hint.
  const legacy = /** @type {LedgerIssue & { hint: string }} */ (
    /** @type {LedgerEntry} */ (led.entries.find((x) => x.id === f.ids.legacy)).issues[0]
  );
  assert.equal(legacy.severity, 'warn');
  assert.match(legacy.hint, /doctor --repair|migrate|pack/);
  assert.deepEqual(codesOf(led, f.ids.quiet), ['skipped-unaffected']);
  assert.equal(statusOf(led, f.ids.quiet), 'skipped-unaffected');
  assert.equal(
    /** @type {LedgerEntry} */ (led.entries.find((x) => x.id === f.ids.quiet)).severity,
    'info'
  );
});

test(
  'convert-legacy packs a .pxsig.json into a .psig when the gate passes, with the same signature bytes',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const json = JSON.parse(readFileSync(f.sig(f.ids.legacy), 'utf8'));
    const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
    const plan = planRepairs(led, { only: ['convert-legacy'] });
    const res = await applyRepairs(f.ctx, plan, {
      by: 't',
      via: 't',
      reconcileOpts: { index: f.index, affected: f.affected },
      hooks: {},
    });
    assert.match(res.steps[0].result, /1 converted/);
    const entry = JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8')).stories.find(
      (/** @type {ManifestEntry} */ e) => e.id === f.ids.legacy
    );
    assert.match(entry.sig, /\.psig$/);
    const psig = join(f.repo, entry.sig);
    assert.deepEqual(
      readSection(psig, 'sig'),
      Buffer.from(json.sig, 'base64'),
      'signature bytes unchanged'
    );
    assert.ok(readSection(psig, 'image'), 'the latest render is its image now');
    assert.ok(!existsSync(f.sig(f.ids.legacy)), 'the .pxsig.json moved to trash/');
    assert.deepEqual(codesOf(res.ledger, f.ids.legacy), []);
  }
);
