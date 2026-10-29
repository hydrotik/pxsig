/**
 * repair.test.mjs — the safe repairs' plan and the register and re-check paths (lib/repair.mjs), on
 * fixture projects in temp dirs: the plan's order, register, one repair run, a failed re-check,
 * unreadable parameters, registerNamed.
 *
 *   node --test packages/pxsig/test/repair.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { reconcile, scanStories } from '../src/lib/integrity.mjs';
import { applyRepairs, planRepairs, registerNamed, registerStories } from '../src/lib/repair.mjs';
import { writeFileSync } from 'node:fs';
import { fixture, hashTree } from './fixture.mjs';
import { statusOf } from './integrity-helpers.mjs';
/** @import { ManifestEntry } from '../src/types.js' */
/** @import { DoneStep, Harvest, RegisterResult } from '../src/types/t3.js' */

// --- repairs ------------------------------------------------------------------------------------------------

test('the plan orders register → recheck → restore, lists what needs a person, and never plans prune unasked', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { server: { up: true } });
  assert.deepEqual(
    plan.steps.map((s) => s.action),
    ['register', 'recheck', 'restore-baseline-image', 'convert-legacy']
  );
  assert.deepEqual(plan.steps[0].ids, [f.ids.unregistered]);
  assert.deepEqual(plan.steps[3].ids, [f.ids.legacy]);
  assert.ok(plan.steps[1].ids.includes(f.ids.never) && plan.steps[1].ids.includes(f.ids.noRender));
  assert.equal(
    plan.steps[0].recheckAfter,
    true,
    'register hands what it adds to the re-check step'
  );
  // A stale verdict is a warning: re-checked only when asked (or when a later step gates on it).
  assert.ok(
    !plan.steps[1].ids.includes(f.ids.stale),
    'stale verdicts are not re-checked by default'
  );
  assert.ok(
    plan.manual.some((m) => m.code === 'stale'),
    'stale is listed for a person instead'
  );
  assert.ok(
    planRepairs(led, { server: { up: true }, stale: true }).steps[1].ids.includes(f.ids.stale),
    'stale: true re-checks them'
  );
  assert.ok(!plan.steps[1].ids.includes(f.ids.gone), 'an orphaned entry is never re-rendered');
  assert.ok(
    plan.manual.some((m) => m.code === 'changed') && plan.manual.some((m) => m.code === 'orphaned')
  );
  assert.deepEqual(
    planRepairs(led, { only: ['register'] }).steps.map((s) => s.action),
    ['register']
  );
  // Without a healthy Storybook, register is blocked (parameters are read from it).
  const offline = await reconcile(f.ctx, { offline: true, affected: f.affected });
  // Offline, the plan has a blocked register step.
  assert.match(
    /** @type {string} */ (
      /** @type {{ blocked: string | null }} */ (
        planRepairs(offline).steps.find((s) => s.action === 'register')
      ).blocked
    ),
    /healthy Storybook/
  );
});

test('register adds new stories without signatures, keeps existing entries, backs up the manifest', async () => {
  const f = fixture({ withSigs: false });
  const before = JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8'));
  const baselines = hashTree(join(f.px, 'baselines'));
  const r = await registerStories(
    f.ctx,
    [{ id: f.ids.unregistered, importPath: 'src/components/Gamma/Gamma.stories.tsx' }],
    {
      harvest: async (/** @type {string[]} */ ids) =>
        Object.fromEntries(
          ids.map((id) => [
            id,
            {
              pxsig: { states: [{ name: 'open', action: 'click', target: 'button' }] },
              tags: [],
              play: false,
            },
          ])
        ),
    }
  );
  assert.deepEqual(r.added, [f.ids.unregistered, `${f.ids.unregistered}__open`]);
  const after = JSON.parse(readFileSync(f.ctx.manifestPath, 'utf8'));
  assert.deepEqual(
    after.stories.filter((/** @type {ManifestEntry} */ e) =>
      before.stories.some((/** @type {ManifestEntry} */ b) => b.id === e.id)
    ),
    before.stories,
    'existing entries untouched'
  );
  const at = after.stories.findIndex(
    (/** @type {ManifestEntry} */ e) => e.id === f.ids.unregistered
  );
  assert.equal(
    after.stories[at - 1].importPath,
    'src/components/Gamma/Gamma.stories.tsx',
    'placed with its story file'
  );
  assert.equal(
    after.stories[at].sig,
    `.pxsig/baselines/components/Gamma/${f.ids.unregistered}.psig`
  );
  assert.ok(!existsSync(join(f.repo, after.stories[at].sig)), 'no signature created');
  // register backs up the manifest it changed.
  assert.ok(existsSync(join(f.repo, /** @type {string} */ (r.backup))));
  assert.equal(hashTree(join(f.px, 'baselines')), baselines);
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  assert.equal(statusOf(led, f.ids.unregistered), 'unbaselined', 'now NEW, waiting for a person');
});

test('one repair run registers a new story and renders its entries; the count is what was recorded', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { server: { up: true }, only: ['register', 'recheck'] });
  const checkPath = join(f.px, 'reports', 'check.json');
  /** @type {string[]} */
  const asked = [];
  const res = await applyRepairs(f.ctx, plan, {
    by: 't',
    via: 't',
    reconcileOpts: { index: f.index, affected: f.affected },
    hooks: {
      harvest: async (/** @type {string[]} */ ids) =>
        Object.fromEntries(
          ids.map((id) => [
            id,
            { pxsig: { states: [{ name: 'open', action: 'click', target: 'button' }] }, tags: [] },
          ])
        ),
      // A stand-in for the server queue: records a fresh row for all but the first id.
      recheck: async (/** @type {string[]} */ ids) => {
        asked.push(...ids);
        const check = JSON.parse(readFileSync(checkPath, 'utf8'));
        const now = new Date().toISOString();
        for (const id of ids.slice(1))
          check.rows = [
            ...check.rows.filter((/** @type {{ id: string }} */ r) => r.id !== id),
            { id, story: id, pass: false, new: true, checkedAt: now },
          ];
        writeFileSync(checkPath, JSON.stringify(check));
        return { via: 'stub' };
      },
    },
  });
  assert.ok(
    asked.includes(f.ids.unregistered) && asked.includes(`${f.ids.unregistered}__open`),
    'the registered entries are rendered in the same run'
  );
  const rc = /** @type {DoneStep & { recorded: number }} */ (
    res.steps.find((s) => s.action === 'recheck')
  );
  assert.equal(rc.recorded, asked.length - 1);
  assert.match(rc.result, new RegExp(`^${asked.length - 1} of ${asked.length} entries re-checked`));
});

test('a failed re-check is reported as failed, not as re-checked', async () => {
  const f = fixture({ withSigs: false });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const plan = planRepairs(led, { server: { up: true }, only: ['recheck'] });
  const res = await applyRepairs(f.ctx, plan, {
    by: 't',
    via: 't',
    reconcileOpts: { index: f.index, affected: f.affected },
    hooks: {
      recheck: async () => {
        throw new Error('setup error: Storybook is not reachable');
      },
    },
  });
  assert.match(res.steps[0].result, /^not re-checked: setup error/);
  const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(log.at(-1).result, 'failed');
});

test('register survives a story whose parameters cannot be read, and logs an adopted signature', async () => {
  const f = fixture({ withSigs: false });
  // A second new story, whose entry path already holds a signature (a story renamed back).
  writeFileSync(
    join(f.repo, 'src/components/Gamma/Gamma.stories.tsx'),
    readFileSync(join(f.repo, 'src/components/Gamma/Gamma.stories.tsx'), 'utf8').replace(
      'export const NewOne',
      'export const Back: Story = {};\nexport const NewOne'
    )
  );
  const back = 'components-gamma--back';
  writeFileSync(join(f.px, 'baselines', 'components', 'Gamma', `${back}.psig`), 'old');
  const index = { ...f.index, stories: scanStories(f.ctx) };
  const led = await reconcile(f.ctx, { index, affected: f.affected });
  const plan = planRepairs(led, { server: { up: true }, only: ['register'] });
  assert.deepEqual(plan.steps[0].ids.sort(), [back, f.ids.unregistered].sort());
  const res = await applyRepairs(f.ctx, plan, {
    by: 't',
    via: 't',
    reconcileOpts: { index, affected: f.affected },
    hooks: {
      // A stand-in: a story that failed to load answers with `error` only, which repair reads first.
      harvest: /** @type {Harvest} */ (
        async (/** @type {string[]} */ ids) =>
          Object.fromEntries(
            ids.map((id) => [
              id,
              id === f.ids.unregistered ? { error: 'loadStory threw' } : { pxsig: {}, tags: [] },
            ])
          )
      ),
    },
  });
  // The register step's result (lib/repair.mjs).
  assert.deepEqual(
    /** @type {DoneStep & RegisterResult} */ (res.steps[0]).added,
    [back],
    'the readable story is registered'
  );
  assert.deepEqual(
    /** @type {DoneStep & RegisterResult} */ (res.steps[0]).failed.map((x) => x.id),
    [f.ids.unregistered]
  );
  assert.match(res.steps[0].result, /1 failed, 1 existing signatures adopted/);
  const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.ok(
    log.some(
      (l) => l.id === f.ids.unregistered && l.result === 'failed' && /loadStory threw/.test(l.error)
    )
  );
  assert.ok(log.some((l) => l.id === back && /adopted the existing signature/.test(l.result)));
  assert.equal(
    statusOf(res.ledger, f.ids.unregistered),
    'unregistered',
    'still reported, for the next run'
  );
});

test('registerNamed registers a named story that is not in the manifest, or says why not', async () => {
  const f = fixture({ withSigs: false });
  const harvest = async (/** @type {string[]} */ ids) =>
    Object.fromEntries(ids.map((id) => [id, { pxsig: {}, tags: [] }]));
  const r = await registerNamed(
    f.ctx,
    [
      f.ids.unregistered,
      f.ids.ok,
      'components-alpha--default@light',
      'nope--missing',
      'internal-helpers--default',
    ],
    { index: f.index, harvest, by: 't', via: 'test' }
  );
  assert.deepEqual(r.added, [f.ids.unregistered]);
  assert.deepEqual(r.stories, [f.ids.unregistered]);
  const why = Object.fromEntries(r.skipped.map((x) => [x.name, x.why]));
  assert.equal(
    why[f.ids.ok],
    undefined,
    'a registered story is not skipped: it is simply selected'
  );
  assert.match(
    why['components-alpha--default@light'],
    /no such entry: story components-alpha--default is registered with/
  );
  assert.match(why['nope--missing'], /not in the manifest or the Storybook story index/);
  assert.match(why['internal-helpers--default'], /config\.nonVisual/);
  const log = readFileSync(join(f.px, 'reports', 'repairs.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.ok(
    log.some((l) => l.action === 'register' && l.id === f.ids.unregistered && l.via === 'test')
  );
  // Without a live index nothing is registered, and the reason says what is needed.
  const f2 = fixture({ withSigs: false });
  const off = await registerNamed(f2.ctx, [f2.ids.unregistered], {
    index: {
      source: 'static',
      storybook: { error: 'unreachable: ECONNREFUSED' },
      stories: f2.index.stories,
    },
    harvest,
  });
  assert.deepEqual(off.added, []);
  assert.match(off.skipped[0].why, /healthy Storybook \(unreachable: ECONNREFUSED\)/);
});
