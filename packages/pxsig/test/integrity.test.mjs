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
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CODES,
  fetchStoryIndex,
  filterLedger,
  loadStoryIndex,
  primaryOf,
  reconcile,
  resolveContext,
  sanitize,
  scanStories,
  storyNameFromExport,
  toId,
  writeLedger,
} from '../src/lib/integrity.mjs';
import { storybookSentinel } from '../src/lib/capture.mjs';
import { readSection } from '../src/lib/psig.mjs';
import { applyRepairs, guardWrite, planRepairs, pruneOrphans, registerStories, restoreBaselineImages } from '../src/lib/repair.mjs';
import { fixture, hashSignatures, hashTree, hasRust, rustBin } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const codesOf = (ledger, id) => ledger.entries.find((x) => x.id === id)?.issues.map((i) => i.code) ?? null;
const statusOf = (ledger, id) => ledger.entries.find((x) => x.id === id)?.status ?? null;

// --- Storybook id rules + the static index ------------------------------------------------------------

test('story ids follow Storybook: sanitize + startCase(export)', () => {
  assert.equal(storyNameFromExport('Virtualised100K'), 'Virtualised 100 K');
  assert.equal(storyNameFromExport('BuiltInLabelAndMessage'), 'Built In Label And Message');
  assert.equal(storyNameFromExport('AsChild'), 'As Child');
  assert.equal(storyNameFromExport('HTMLContent'), 'HTML Content');
  assert.equal(toId('Components/DataGrid', storyNameFromExport('Virtualised100K')), 'components-datagrid--virtualised-100-k');
  assert.equal(toId('Components/Input', storyNameFromExport('BuiltInLabelAndMessage')), 'components-input--built-in-label-and-message');
  assert.equal(toId('Foundations/Typography', 'Vertical Rhythm'), 'foundations-typography--vertical-rhythm');
  assert.equal(sanitize('  E-Commerce / Price (v2)!! '), 'e-commerce-price-v2');
});

test('static scan finds every exported story, skips comments, and keeps the import path', () => {
  const { ctx } = fixture({ withSigs: false });
  const ids = scanStories(ctx).map((s) => s.id);
  assert.ok(ids.includes('components-gamma--new-one'));
  assert.ok(ids.includes('components-delta--a-11-y'));
  assert.ok(!ids.some((id) => id.endsWith('--commented')));
  assert.equal(scanStories(ctx).find((s) => s.id === 'components-alpha--default').importPath, 'src/components/Alpha/Alpha.stories.tsx');
});

test('a broken Storybook index is reachable but not healthy; an unreachable one falls back to the static scan', async () => {
  const errPage = async () => new Response('<html><body><h1>Unable to index files:</h1> ./Foo.stories.tsx: SyntaxError</body></html>', { status: 500 });
  const broken = await fetchStoryIndex('http://sb', { fetchImpl: errPage });
  assert.equal(broken.reachable, true);
  assert.equal(broken.healthy, false);
  assert.match(broken.error, /Unable to index files/);
  const okFetch = async () => new Response(JSON.stringify({ v: 5, entries: { a: { type: 'story', id: 'x--y', title: 'X', name: 'Y', importPath: './src/X.stories.tsx' }, d: { type: 'docs', id: 'x--docs' } } }));
  const good = await fetchStoryIndex('http://sb', { fetchImpl: okFetch });
  assert.deepEqual(good.stories.map((s) => s.id), ['x--y']);
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
  assert.match(led.entries.find((x) => x.id === ids.stale).issues[0].reason, /Beta\.stories\.tsx edited/);
  assert.deepEqual(codesOf(led, ids.restorable), ['missing-baseline-image']);
  assert.equal(statusOf(led, ids.never), 'never-checked');
  assert.match(led.entries.find((x) => x.id === ids.never).issues.find((i) => i.code === 'never-checked').reason, /added after the last full check|absent from the last report/);
  assert.ok(codesOf(led, ids.never).includes('missing-baseline-image'));
  assert.equal(statusOf(led, ids.noRender), 'missing-render');
  assert.equal(statusOf(led, ids.unbaselined), 'unbaselined');
  assert.ok(codesOf(led, ids.a11y).includes('a11y-new'));
  assert.equal(statusOf(led, ids.gone), 'orphaned', 'a manifest entry whose story left the index');
  assert.equal(statusOf(led, 'components-old--x'), 'orphaned', 'a signature + base image with no manifest entry');
  assert.deepEqual(led.entries.find((x) => x.id === 'components-old--x').orphanFiles.length, 1);
  assert.equal(statusOf(led, ids.unregistered), 'unregistered');
  assert.equal(statusOf(led, 'internal-helpers--default'), 'excluded');
  // Every code has a stable severity; every issue carries a reason.
  const seen = new Set(led.entries.flatMap((x) => x.issues.map((i) => i.code)).concat(led.entries.map((x) => x.status)));
  for (const code of Object.keys(CODES)) assert.ok(seen.has(code), `fixture covers ${code}`);
  for (const x of led.entries) for (const i of x.issues) assert.ok(i.reason && i.severity, `${x.id} ${i.code}`);
});

test('roll-ups per component and overall; the headline names the error codes', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const gamma = led.components.find((c) => c.component === 'components/Gamma');
  assert.equal(gamma.severity, 'error');
  assert.equal(gamma.counts['missing-baseline-image'], 3);
  assert.equal(led.components.find((c) => c.component === 'components/Alpha').severity, 'info');
  assert.equal(led.summary.status, 'attention');
  assert.match(led.summary.headline, /components need attention: .*1 unregistered story/);
  assert.equal(led.schemaVersion, 1);
  assert.deepEqual(Object.keys(led).slice(0, 4), ['schemaVersion', 'generatedAt', 'tool', 'sources']);
  // Filtering for a view.
  assert.ok(filterLedger(led, { status: 'stale' }).entries.every((x) => x.issues.some((i) => i.code === 'stale')));
  assert.ok(filterLedger(led, { component: 'gamma' }).components.every((c) => /Gamma/.test(c.component)));
});

test('the ledger is deterministic: same inputs, same entries', async () => {
  const f = fixture({ withSigs: false });
  const a = await reconcile(f.ctx, { index: f.index, affected: f.affected, now: 0 });
  const b = await reconcile(f.ctx, { index: f.index, affected: f.affected, now: 0 });
  delete a.elapsedMs;
  delete b.elapsedMs;
  assert.deepEqual(a, b);
  writeLedger(f.ctx, a);
  assert.equal(JSON.parse(readFileSync(join(f.px, 'reports', 'integrity.json'), 'utf8')).schemaVersion, 1);
});

test('severity overrides and config switches', async () => {
  const f = fixture({ withSigs: false });
  f.ctx.integrity.severity = { unbaselined: 'error' };
  f.ctx.integrity.requireBaselineImages = false;
  f.ctx.integrity.staleAfterSourceChange = false;
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.equal(led.entries.find((x) => x.id === f.ids.unbaselined).severity, 'error');
  assert.ok(!codesOf(led, f.ids.restorable).includes('missing-baseline-image'));
  assert.notEqual(statusOf(led, f.ids.stale), 'stale');
  assert.deepEqual(primaryOf([]), { code: 'ok', severity: 'info' });
});

// --- repairs ------------------------------------------------------------------------------------------------

test('the plan orders register → recheck → restore, lists what needs a person, and never plans prune unasked', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { server: { up: true } });
  assert.deepEqual(plan.steps.map((s) => s.action), ['register', 'recheck', 'restore-baseline-image', 'convert-legacy']);
  assert.deepEqual(plan.steps[0].ids, [f.ids.unregistered]);
  assert.deepEqual(plan.steps[3].ids, [f.ids.legacy]);
  assert.ok(plan.steps[1].ids.includes(f.ids.never) && plan.steps[1].ids.includes(f.ids.stale) && plan.steps[1].ids.includes(f.ids.noRender));
  assert.ok(plan.manual.some((m) => m.code === 'changed') && plan.manual.some((m) => m.code === 'orphaned'));
  assert.deepEqual(planRepairs(led, { only: ['register'] }).steps.map((s) => s.action), ['register']);
  // Without a healthy Storybook, register is blocked (parameters are read from it).
  const offline = await reconcile(f.ctx, { offline: true, affected: f.affected });
  assert.match(planRepairs(offline).steps.find((s) => s.action === 'register').blocked, /healthy Storybook/);
});

test('register adds new stories without signatures, keeps existing entries, backs up the manifest', async () => {
  const f = fixture({ withSigs: false });
  const before = JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8'));
  const baselines = hashTree(join(f.px, 'baselines'));
  const r = await registerStories(f.ctx, [{ id: f.ids.unregistered, importPath: 'src/components/Gamma/Gamma.stories.tsx' }], {
    harvest: async (ids) => Object.fromEntries(ids.map((id) => [id, { pxsig: { states: [{ name: 'open', action: 'click', target: 'button' }] }, tags: [], play: false }])),
  });
  assert.deepEqual(r.added, [f.ids.unregistered, `${f.ids.unregistered}__open`]);
  const after = JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8'));
  assert.deepEqual(after.stories.filter((e) => before.stories.some((b) => b.id === e.id)), before.stories, 'existing entries untouched');
  const at = after.stories.findIndex((e) => e.id === f.ids.unregistered);
  assert.equal(after.stories[at - 1].importPath, 'src/components/Gamma/Gamma.stories.tsx', 'placed with its story file');
  assert.equal(after.stories[at].sig, `.pxsig/baselines/components/Gamma/${f.ids.unregistered}.psig`);
  assert.ok(!existsSync(join(f.repo, after.stories[at].sig)), 'no signature created');
  assert.ok(existsSync(join(f.repo, r.backup)));
  assert.equal(hashTree(join(f.px, 'baselines')), baselines);
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.equal(statusOf(led, f.ids.unregistered), 'unbaselined', 'now NEW, waiting for a person');
});

test('restore: only when the latest render passes the signature gate; otherwise flagged with the reconstruction', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const baselines = hashSignatures(join(f.px, 'baselines'));
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const res = restoreBaselineImages(f.ctx, led, [f.ids.restorable, f.ids.unrecoverable, f.ids.ok], { by: 'test', via: 'test' });
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  assert.equal(by[f.ids.restorable].result, 'restored');
  assert.deepEqual(readSection(f.sig(f.ids.restorable), 'image'), readFileSync(f.latest(f.ids.restorable)));
  assert.equal(by[f.ids.unrecoverable].result, 'unrecoverable: changed');
  assert.ok(!f.hasBaseImage(f.ids.unrecoverable), 'a failing render is never promoted');
  assert.ok(existsSync(join(f.px, 'diffs', 'latest', `${f.ids.unrecoverable}.baseline.png`)), 'signature reconstruction kept for display');
  assert.equal(by[f.ids.ok].result, 'skipped', 'an existing baseline image is never overwritten');
  assert.equal(hashSignatures(join(f.px, 'baselines')), baselines, 'signatures untouched');
  const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => [l.id, l.result]), res.map((r) => [r.id, r.result]));
  assert.ok(log.every((l) => l.by === 'test' && l.at && l.why && l.action === 'restore-baseline-image'));
  const after = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.ok(!codesOf(after, f.ids.restorable).includes('missing-baseline-image'));
  assert.ok(codesOf(after, f.ids.unrecoverable).includes('missing-baseline-image'));
});

test('a stale render is not used to restore a baseline image', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const x = led.entries.find((e) => e.id === f.ids.restorable);
  x.issues.push({ code: 'stale', severity: 'warn', reason: 'test' });
  const [r] = restoreBaselineImages(f.ctx, led, [f.ids.restorable], { by: 't', via: 't' });
  assert.equal(r.result, 'blocked');
  assert.ok(!f.hasBaseImage(f.ids.restorable));
});

test('applyRepairs runs every safe step, never touches signatures, and logs who/what/why', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const baselines = hashSignatures(join(f.px, 'baselines'));
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { server: { up: true }, only: ['register', 'recheck', 'restore-baseline-image'] });
  const rechecked = [];
  const res = await applyRepairs(f.ctx, plan, {
    by: 'tester',
    via: 'test',
    reconcileOpts: { index: f.index, affected: f.affected },
    hooks: {
      recheck: async (ids) => (rechecked.push(...ids), { via: 'stub' }),
      harvest: async (ids) => Object.fromEntries(ids.map((id) => [id, { pxsig: {}, tags: [] }])),
    },
  });
  assert.deepEqual(res.steps.map((s) => s.action), ['register', 'recheck', 'restore-baseline-image']);
  assert.ok(rechecked.includes(f.ids.never));
  assert.match(res.steps[2].result, /2 restored · 1 unrecoverable/);
  assert.equal(hashSignatures(join(f.px, 'baselines')), baselines, 'signatures untouched by every repair');
  assert.equal(statusOf(res.ledger, f.ids.unregistered), 'unbaselined');
  const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([...new Set(log.map((l) => l.action))], ['register', 'recheck', 'restore-baseline-image']);
  assert.ok(log.every((l) => l.by === 'tester' && l.via === 'test' && l.schemaVersion === 1));
});

test('prune needs confirmation, moves orphans to trash/ and deletes nothing', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { only: ['prune'], prune: true });
  assert.equal(plan.steps[0].action, 'prune');
  const refused = await applyRepairs(f.ctx, plan, { by: 't', via: 't', reconcileOpts: { index: f.index, affected: f.affected }, hooks: { confirmPrune: async () => false } });
  assert.match(refused.steps[0].result, /not confirmed/);
  assert.ok(existsSync(join(f.px, 'baselines', 'components', 'Old', 'components-old--x.psig')));
  const r = pruneOrphans(f.ctx, led, plan.steps[0].ids, { by: 't', via: 't' });
  assert.ok(!existsSync(join(f.px, 'baselines', 'components', 'Old', 'components-old--x.psig')));
  for (const m of r.moved) assert.ok(existsSync(join(f.repo, m.to)), `${m.from} kept in trash/`);
  assert.deepEqual(r.droppedEntries, [f.ids.gone]);
  assert.ok(!JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8')).stories.some((e) => e.id === f.ids.gone));
});

test('the write guard refuses baselines and the baselines folder', () => {
  const f = fixture({ withSigs: false });
  assert.throws(() => guardWrite(f.ctx, join(f.px, 'baselines', 'notes.json')), /never writes signatures/);
  assert.throws(() => guardWrite(f.ctx, join(f.repo, 'anywhere', 'x.psig')), /never writes signatures/);
  assert.throws(() => guardWrite(f.ctx, join(f.repo, 'anywhere', 'x.pxsig.json')), /never writes signatures/);
  assert.equal(guardWrite(f.ctx, join(f.px, 'renders', 'latest', 'x.png')), join(f.px, 'renders', 'latest', 'x.png'));
});

// --- the CLI contract -------------------------------------------------------------------------------------

test('pxsig doctor CLI contract: --json document, filters, usage errors, prune refused when piped', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  writeLedger(f.ctx, led);
  const cli = join(here, '..', 'src', 'cli.mjs');
  const opts = { cwd: f.repo, encoding: 'utf8', env: { ...process.env, PXSIG_FORMAT: '', PXSIG_BIN: rustBin } };
  const r = spawnSync(process.execPath, [cli, 'doctor', '--json', '--offline', '--status', 'never-checked'], opts);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schemaVersion, 1);
  assert.ok(doc.summary && doc.components && doc.entries);
  assert.ok(doc.entries.list.every((x) => x.issues.some((i) => i.code === 'never-checked')));
  assert.ok([0, 1].includes(r.status));
  const usage = spawnSync(process.execPath, [cli, 'doctor', '--repair', '--only', 'nope'], opts);
  assert.equal(usage.status, 2);
  const prune = spawnSync(process.execPath, [cli, 'doctor', '--repair', '--apply', '--prune'], opts);
  assert.equal(prune.status, 3, 'prune is refused when piped');
});

test('the render sentinel recognises Storybook error pages and wrong stories', () => {
  const page = (classes, { msg = '', current = 'a--b' } = {}) => {
    globalThis.document = { body: { classList: { contains: (c) => classes.includes(c) } }, querySelector: () => ({ textContent: msg }) };
    globalThis.window = { __STORYBOOK_PREVIEW__: { currentRender: { id: current } } };
  };
  try {
    page(['sb-show-main']);
    assert.equal(storybookSentinel('a--b'), null);
    page(['sb-show-errordisplay'], { msg: 'Unable to index files:\n- ./X.stories.tsx' });
    assert.equal(storybookSentinel('a--b'), 'Storybook error page: Unable to index files:');
    page(['sb-show-nopreview']);
    assert.match(storybookSentinel('a--b'), /no preview/);
    page(['sb-show-main'], { current: 'c--d' });
    assert.match(storybookSentinel('a--b'), /rendered c--d, not a--b/);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

// --- legacy .pxsig.json baselines ---------------------------------------------------------------------------

test('a .pxsig.json baseline is legacy-format (warn), not a missing image; unaffected skips are info, not never-checked', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.deepEqual(codesOf(led, f.ids.legacy), ['legacy-format']);
  const legacy = led.entries.find((x) => x.id === f.ids.legacy).issues[0];
  assert.equal(legacy.severity, 'warn');
  assert.match(legacy.hint, /doctor --repair|migrate|pack/);
  assert.deepEqual(codesOf(led, f.ids.quiet), ['skipped-unaffected']);
  assert.equal(statusOf(led, f.ids.quiet), 'skipped-unaffected');
  assert.equal(led.entries.find((x) => x.id === f.ids.quiet).severity, 'info');
});

test('convert-legacy packs a .pxsig.json into a .psig when the gate passes, with the same signature bytes', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const json = JSON.parse(readFileSync(f.sig(f.ids.legacy), 'utf8'));
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { only: ['convert-legacy'] });
  const res = await applyRepairs(f.ctx, plan, { by: 't', via: 't', reconcileOpts: { index: f.index, affected: f.affected }, hooks: {} });
  assert.match(res.steps[0].result, /1 converted/);
  const entry = JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8')).stories.find((e) => e.id === f.ids.legacy);
  assert.match(entry.sig, /\.psig$/);
  const psig = join(f.repo, entry.sig);
  assert.deepEqual(readSection(psig, 'sig'), Buffer.from(json.sig, 'base64'), 'signature bytes unchanged');
  assert.ok(readSection(psig, 'image'), 'the latest render is its image now');
  assert.ok(!existsSync(f.sig(f.ids.legacy)), 'the .pxsig.json moved to trash/');
  assert.deepEqual(codesOf(res.ledger, f.ids.legacy), []);
});
