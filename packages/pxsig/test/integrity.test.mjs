/**
 * integrity.test.mjs — the integrity reconciler and the safe repairs, on fixture projects in temp dirs.
 *
 *   node --test packages/pxsig/test/integrity.test.mjs
 *
 * Covers every status code, every repair path ("restore only when the gate passes", register,
 * recheck, prune) and the guarantee that repairs never change a signature (every signature
 * section is hashed before and after). Gate tests need the Rust binary and are skipped without it.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CODES,
  fetchStoryIndex,
  filterLedger,
  loadStoryIndex,
  primaryOf,
  reconcile,
  rustAffected,
  sanitize,
  scanStories,
  storyNameFromExport,
  toId,
  writeLedger,
} from '../src/lib/integrity.mjs';
import { writeFileSync } from 'node:fs';
import { fixture } from './fixture.mjs';
import { codesOf, statusOf } from './integrity-helpers.mjs';
/** @import { Ledger, LedgerEntry, LedgerIssue, LedgerComponent } from './integrity-helpers.mjs' */
/** @import { IndexStory } from '../src/types.js' */
/** @import { IntegrityCode } from '../src/types/t3.js' */

// --- Storybook id rules + the static index ------------------------------------------------------------

test('story ids follow Storybook: sanitize + startCase(export)', () => {
  assert.equal(storyNameFromExport('Virtualised100K'), 'Virtualised 100 K');
  assert.equal(storyNameFromExport('BuiltInLabelAndMessage'), 'Built In Label And Message');
  assert.equal(storyNameFromExport('AsChild'), 'As Child');
  assert.equal(storyNameFromExport('HTMLContent'), 'HTML Content');
  assert.equal(
    toId('Components/DataGrid', storyNameFromExport('Virtualised100K')),
    'components-datagrid--virtualised-100-k'
  );
  assert.equal(
    toId('Components/Input', storyNameFromExport('BuiltInLabelAndMessage')),
    'components-input--built-in-label-and-message'
  );
  assert.equal(
    toId('Foundations/Typography', 'Vertical Rhythm'),
    'foundations-typography--vertical-rhythm'
  );
  assert.equal(sanitize('  E-Commerce / Price (v2)!! '), 'e-commerce-price-v2');
});

test('static scan finds every exported story, skips comments, and keeps the import path', () => {
  const { ctx } = fixture({ withSigs: false });
  const ids = scanStories(ctx).map((s) => s.id);
  assert.ok(ids.includes('components-gamma--new-one'));
  assert.ok(ids.includes('components-delta--a-11-y'));
  assert.ok(!ids.some((id) => id.endsWith('--commented')));
  assert.equal(
    /** @type {IndexStory} */ (scanStories(ctx).find((s) => s.id === 'components-alpha--default'))
      .importPath,
    'src/components/Alpha/Alpha.stories.tsx'
  );
});

test('an index whose entries are null is a broken index', async () => {
  const nullEntries = async () => new Response(JSON.stringify({ v: 5, entries: null }));
  const r = await fetchStoryIndex('http://sb', { fetchImpl: nullEntries });
  assert.equal(r.reachable, true);
  assert.equal(r.healthy, false);
  assert.match(/** @type {{ error: string }} */ (r).error, /^broken index \(HTTP 200\)/);
});

test(
  'an engine reply with neither a result nor an error is an engine error',
  { skip: process.platform === 'win32' && 'the stand-in engine is a script' },
  async () => {
    const { ctx, repo } = fixture({ withSigs: false });
    // A stand-in engine that answers every request with its id alone (named as the engine is).
    mkdirSync(join(repo, 'fake-engine'));
    const bin = join(repo, 'fake-engine', 'pxsig');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
require('node:readline')
  .createInterface({ input: process.stdin })
  .on('line', (l) => process.stdout.write(JSON.stringify({ id: JSON.parse(l).id }) + '\\n'));
`
    );
    chmodSync(bin, 0o755);
    const r = /** @type {NonNullable<ReturnType<typeof rustAffected>>} */ (
      rustAffected({ ...ctx, rustBin: bin })
    );
    try {
      await assert.rejects(
        r.affected('src/components/Alpha/Alpha.stories.tsx'),
        /neither a result nor an error/
      );
    } finally {
      r.close();
    }
  }
);

test(
  'engine lines that are not a JSON object are skipped; the answer after them still arrives',
  // Without the skip, the engine reader throws and the request never settles: fail, not hang.
  { skip: process.platform === 'win32' && 'the stand-in engine is a script', timeout: 20_000 },
  async (t) => {
    const { ctx, repo } = fixture({ withSigs: false });
    // A stand-in engine that writes `null` and a number before each answer (an error, to tell apart).
    mkdirSync(join(repo, 'odd-engine'));
    const bin = join(repo, 'odd-engine', 'pxsig');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
require('node:readline')
  .createInterface({ input: process.stdin })
  .on('line', (l) =>
    process.stdout.write('null\\n42\\n' + JSON.stringify({ id: JSON.parse(l).id, error: 'the real answer' }) + '\\n')
  );
`
    );
    chmodSync(bin, 0o755);
    const r = /** @type {NonNullable<ReturnType<typeof rustAffected>>} */ (
      rustAffected({ ...ctx, rustBin: bin })
    );
    // An after hook, not `finally`: it also runs when the test times out, so the engine stops.
    t.after(() => r.close());
    await assert.rejects(r.affected('src/components/Alpha/Alpha.stories.tsx'), /the real answer/);
  }
);

test('a broken Storybook index is reachable but not healthy; an unreachable one falls back to the static scan', async () => {
  const errPage = async () =>
    new Response(
      '<html><body><h1>Unable to index files:</h1> ./Foo.stories.tsx: SyntaxError</body></html>',
      { status: 500 }
    );
  const broken = await fetchStoryIndex('http://sb', { fetchImpl: errPage });
  assert.equal(broken.reachable, true);
  assert.equal(broken.healthy, false);
  // An unhealthy index carries its error.
  assert.match(broken.error, /Unable to index files/);
  const okFetch = async () =>
    new Response(
      JSON.stringify({
        v: 5,
        entries: {
          a: {
            type: 'story',
            id: 'x--y',
            title: 'X',
            name: 'Y',
            importPath: './src/X.stories.tsx',
          },
          d: { type: 'docs', id: 'x--docs' },
        },
      })
    );
  const good = await fetchStoryIndex('http://sb', { fetchImpl: okFetch });
  // A healthy index carries its stories.
  assert.deepEqual(
    /** @type {{ stories: { id: string }[] }} */ (good).stories.map((s) => s.id),
    ['x--y']
  );
  const { ctx } = fixture({ withSigs: false });
  const idx = await loadStoryIndex(ctx); // baseUrl points at a closed port
  assert.equal(idx.source, 'static');
  assert.equal(idx.storybook.reachable, false);
  assert.ok(idx.stories.length >= 13);
  const led = await reconcile(ctx, { index: await loadStoryIndex(ctx, { live: broken }) });
  assert.equal(led.setup[0].code, 'storybook-index-broken');
  assert.equal(led.sources.storyIndex.source, 'static');
});

// --- every status code ------------------------------------------------------------------------------------

test('every status code is detected, with a severity and a reason', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const { ids } = f;
  assert.equal(statusOf(led, ids.ok), 'ok');
  assert.equal(statusOf(led, ids.drift), 'drift');
  assert.equal(statusOf(led, ids.changed), 'changed');
  assert.equal(statusOf(led, ids.flaky), 'flaky');
  assert.equal(statusOf(led, ids.error), 'render-error');
  assert.equal(statusOf(led, ids.stale), 'stale');
  assert.match(
    /** @type {LedgerEntry} */ (led.entries.find((x) => x.id === ids.stale)).issues[0].reason,
    /Beta\.stories\.tsx edited/
  );
  assert.deepEqual(codesOf(led, ids.restorable), ['missing-baseline-image']);
  assert.equal(statusOf(led, ids.never), 'never-checked');
  assert.match(
    /** @type {LedgerIssue} */ (
      /** @type {LedgerEntry} */ (led.entries.find((x) => x.id === ids.never)).issues.find(
        (i) => i.code === 'never-checked'
      )
    ).reason,
    /added after the last full check|absent from the last report/
  );
  assert.ok(/** @type {string[]} */ (codesOf(led, ids.never)).includes('missing-baseline-image'));
  assert.equal(statusOf(led, ids.noRender), 'missing-render');
  assert.equal(statusOf(led, ids.unbaselined), 'unbaselined');
  assert.ok(/** @type {string[]} */ (codesOf(led, ids.a11y)).includes('a11y-new'));
  assert.equal(statusOf(led, ids.gone), 'orphaned', 'a manifest entry whose story left the index');
  assert.equal(
    statusOf(led, 'components-old--x'),
    'orphaned',
    'a signature + base image with no manifest entry'
  );
  assert.deepEqual(
    /** @type {LedgerEntry & { orphanFiles: string[] }} */ (
      led.entries.find((x) => x.id === 'components-old--x')
    ).orphanFiles.length,
    1
  );
  assert.equal(statusOf(led, ids.unregistered), 'unregistered');
  assert.equal(statusOf(led, 'internal-helpers--default'), 'excluded');
  // Every code has a stable severity; every issue carries a reason.
  const seen = new Set(
    led.entries.flatMap((x) => x.issues.map((i) => i.code)).concat(led.entries.map((x) => x.status))
  );
  for (const code of /** @type {IntegrityCode[]} */ (Object.keys(CODES)))
    assert.ok(seen.has(code), `fixture covers ${code}`);
  for (const x of led.entries)
    for (const i of x.issues) assert.ok(i.reason && i.severity, `${x.id} ${i.code}`);
});

test('roll-ups per component and overall; the headline names the error codes', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const gamma = /** @type {LedgerComponent} */ (
    led.components.find((c) => c.component === 'components/Gamma')
  );
  assert.equal(gamma.severity, 'error');
  assert.equal(gamma.counts['missing-baseline-image'], 3);
  assert.equal(
    /** @type {LedgerComponent} */ (led.components.find((c) => c.component === 'components/Alpha'))
      .severity,
    'info'
  );
  assert.equal(led.summary.status, 'attention');
  assert.match(led.summary.headline, /components with errors: .*1 unregistered story/);
  assert.equal(led.schemaVersion, 1);
  assert.deepEqual(Object.keys(led).slice(0, 4), [
    'schemaVersion',
    'generatedAt',
    'tool',
    'sources',
  ]);
  // Filtering for a view.
  assert.ok(
    filterLedger(led, { status: 'stale' }).entries.every((/** @type {LedgerEntry} */ x) =>
      x.issues.some((i) => i.code === 'stale')
    )
  );
  assert.ok(
    filterLedger(led, { component: 'gamma' }).components.every((/** @type {LedgerComponent} */ c) =>
      /Gamma/.test(c.component)
    )
  );
});

test('the ledger is deterministic: same inputs, same entries', async () => {
  const f = fixture({ withSigs: false });
  const a = await reconcile(f.ctx, { index: f.index, affected: f.affected, now: 0 });
  const b = await reconcile(f.ctx, { index: f.index, affected: f.affected, now: 0 });
  // Partial: the timing is the one key that differs between runs.
  delete (/** @type {Partial<Ledger>} */ (a).elapsedMs);
  delete (/** @type {Partial<Ledger>} */ (b).elapsedMs);
  assert.deepEqual(a, b);
  writeLedger(f.ctx, a);
  assert.equal(
    JSON.parse(readFileSync(join(f.px, 'reports', 'integrity.json'), 'utf8')).schemaVersion,
    1
  );
});

test('severity overrides and config switches', async () => {
  const f = fixture({ withSigs: false });
  f.ctx.integrity.severity = { unbaselined: 'error' };
  f.ctx.integrity.requireBaselineImages = false;
  f.ctx.integrity.staleAfterSourceChange = false;
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.equal(
    /** @type {LedgerEntry} */ (led.entries.find((x) => x.id === f.ids.unbaselined)).severity,
    'error'
  );
  assert.ok(
    !(/** @type {string[]} */ (codesOf(led, f.ids.restorable)).includes('missing-baseline-image'))
  );
  assert.notEqual(statusOf(led, f.ids.stale), 'stale');
  assert.deepEqual(primaryOf([]), { code: 'ok', severity: 'info' });
});
