/**
 * decision-pins.test.mjs — what the approval log commits today, pinned before a decision's reason
 * and the approver's identity leave the committed logs (design: a decision commits only its
 * reference, PR 1). Each pin names the PR of that design that flips it:
 *   PR 3 — the reason stays on the machine (`reports/decisions.ndjson`); the logs commit `ref`
 *   PR 4 — no person's identity in any log; `approvals.identity` is no longer read
 * The accessibility log and the store's other files: decision-pins-a11y.test.mjs.
 *
 *   node --test packages/pxsig/test/decision-pins.test.mjs
 *
 * Needs the Rust binary and git; `check --update` also needs Chromium.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { detectAgent } from '../src/lib/agents.mjs';
import { changedByRoute, paths, readLog, record, route, snapshot } from '../src/lib/approvals.mjs';
import { reconcile } from '../src/lib/integrity.mjs';
import { migrateLegacy } from '../src/lib/setup/migrate.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, png, rustBin, testEnv, testHome } from './fixture.mjs';
import { fakeStorybook, needs, serve, src } from './server-helpers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { ManifestEntry } from '../src/types.js' */
/** @typedef {ReturnType<typeof fixture>} Fixture */

const EMAIL = 'probe@example.test';
const REASON = 'the new palette, reviewed in the dashboard';
const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = skipUnless(hasRust && hasGit, 'Rust binary or git missing');
// A render unlike the fixture's checkerboard: approving it changes the baseline's bytes.
const STRIPES = png(128, 128, (x) => (x % 16 < 8 ? [200, 60, 60] : [250, 250, 250]));

/**
 * A line's keys in order; `agent` aside (it depends on the process that runs the tests).
 * @param {object} l
 */
const keys = (l) => Object.keys(l).filter((k) => k !== 'agent');

/**
 * A fixture in a real git repository whose git email is the probe; `identity` sets
 * `approvals.identity: "git-email"`.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {boolean} identity
 */
function project(t, identity) {
  const f = fixture({ t });
  spawnSync('git', ['init', '-q', f.repo]);
  spawnSync('git', ['-C', f.repo, 'config', 'user.email', EMAIL]);
  if (identity) {
    const cfg = join(f.repo, 'pxsig.config.json');
    const c = JSON.parse(readFileSync(cfg, 'utf8'));
    writeFileSync(cfg, JSON.stringify({ ...c, approvals: { identity: 'git-email' } }, null, 2));
  }
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  /** @param {string} id */
  const entry = (id) =>
    // The fixture's manifest has every id used here.
    /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id));
  return { f, P, entry };
}

/**
 * The CLI as a person at a terminal runs it (as approve-flow.test.mjs): TTYs, no CI, no markers.
 * @param {Fixture} f
 * @param {string[]} args
 * @param {{ input?: string, url?: string, script?: string }} [opts]
 */
function person(f, args, { input = '', url = 'http://127.0.0.1:1', script = 'cli.mjs' } = {}) {
  const preload = join(f.repo, 'tty-preload.mjs');
  if (!existsSync(preload))
    writeFileSync(preload, 'process.stdin.isTTY = true;\nprocess.stdout.isTTY = true;\n');
  /** @type {Record<string, string | undefined>} */
  const env = { ...testEnv(testHome), PXSIG_URL: url, PXSIG_BIN: rustBin, PXSIG_FORMAT: 'plain' };
  delete env.CI;
  for (let a = detectAgent(env); a; a = detectAgent(env)) delete env[a.variable];
  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(preload).href, join(src, script), ...args],
    { cwd: f.repo, env, timeout: 120_000 }
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.stdin.end(input);
  return /** @type {Promise<{ status: number | null, out: string }>} */ (
    new Promise((ok) => child.on('close', (status) => ok({ status, out })))
  );
}

const LINE = ['at', 'id', 'via', 'batch', 'ref', 'reason', 'kind', 'gitHead', 'before', 'after'];

test(
  'pins 1, 2: record — the keys in order, reason null by default, by only with git-email',
  { skip },
  (t) => {
    const a = project(t, false);
    const l = record(a.P, a.entry(a.f.ids.changed), { batch: 'b1-cli', via: 'cli', before: null });
    // Flips in PR 3: no `reason` key at all.
    assert.deepEqual(keys(l), [...LINE, 'pxsig']);
    assert.equal(l.reason, null);
    assert.equal(l.by, undefined);
    assert.deepEqual(readLog(a.P), [l], 'the line returned is the line logged');
    const b = project(t, true);
    const m = record(b.P, b.entry(b.f.ids.changed), { batch: 'b1-cli', via: 'cli', before: null });
    // Flips in PR 4: no `by`, whatever approvals.identity says.
    assert.deepEqual(keys(m), [...LINE, 'by', 'pxsig']);
    assert.equal(m.by, EMAIL);
  }
);

test(
  'pins 3, 5: plan --reason → apply through the server; a dashboard undo',
  { skip },
  async (t) => {
    const { f, P, entry } = project(t, true);
    const id = f.ids.changed;
    const p = paths(P, entry(id));
    writeFileSync(p.latestPng, STRIPES);
    const old = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(p.latestPng, old, old);
    const r = await person(f, ['approve', 'plan', id, '--reason', REASON, '--allow-shape', id]);
    assert.equal(r.status, 0, r.out);
    const plan = JSON.parse(readFileSync(join(P.store.reports, 'approval-plan.json'), 'utf8'));
    // Flips in PR 3 (the reason only when reports/ is git-ignored) and PR 4 (no `by`).
    assert.deepEqual(keys(plan), ['version', 'createdAt', 'by', 'project', 'reason', 'entries']);
    assert.deepEqual([plan.by, plan.reason], [EMAIL, REASON]);
    const S = await serve(f);
    try {
      const a = await person(f, ['approve', 'apply'], {
        input: 'APPROVE 1 ENTRIES\n',
        url: S.base,
      });
      assert.equal(a.status, 0, `${a.out}\n${S.log()}`);
      assert.match(a.out, new RegExp(`Reason: ${REASON}`), '`apply` prints the reason (stays)');
      const [line] = readLog(P);
      // Flips in PR 3 (no `reason`) and PR 4 (no `by`).
      assert.deepEqual([line.via, line.reason, line.by], ['cli', REASON, EMAIL]);
      assert.deepEqual(keys(line), [...LINE, 'by', 'pxsig']);
      const u = await S.post('unreview', { id });
      assert.equal(u.status, 200, JSON.stringify(u.body));
      const undo = readLog(P)[1];
      // Flips in PR 3: `undo: { in: "dashboard", from: "snapshot" }` instead of the reason text.
      assert.deepEqual(
        [undo.batch, undo.via, undo.reason, undo.by],
        [`${line.batch}-undo`, 'undo', `undo ${line.batch} (dashboard)`, EMAIL]
      );
      assert.deepEqual([route(line), route(undo)], ['terminal', 'dashboard']);
      const c = changedByRoute(readLog(P));
      assert.deepEqual([c.total, c.dashboard, c.terminal], [1, 1, 0], 'summary.md counts');
    } finally {
      await S.stop();
    }
  }
);

test(
  'pin 5: approve undo — "undo <batch>" from the snapshot, "(from git)" from git',
  { skip },
  async (t) => {
    const { f, P, entry } = project(t, false);
    const a = entry(f.ids.changed);
    const { before } = snapshot(P, a, 'b1-cli');
    record(P, a, { batch: 'b1-cli', via: 'cli', reason: REASON, before });
    // A first baseline with no snapshot here: undo takes it from git (it moves the file to trash/).
    record(P, entry(f.ids.ok), { batch: 'b2-cli', via: 'cli', reason: REASON, before: null });
    for (const batch of ['b1-cli', 'b2-cli']) {
      const r = await person(f, ['approve', 'undo', batch], { input: 'UNDO\n' });
      assert.equal(r.status, 0, r.out);
    }
    const undo = readLog(P).filter((l) => l.via === 'undo');
    // Flips in PR 3: `undo: { in: "terminal", from: "snapshot" | "git" }`, no reason.
    assert.deepEqual(
      undo.map((l) => [l.batch, l.reason]),
      [
        ['b1-cli-undo', 'undo b1-cli'],
        ['b2-cli-undo', 'undo b2-cli (from git)'],
      ]
    );
    assert.deepEqual(undo.map(route), ['terminal', 'terminal']);
    const c = changedByRoute(readLog(P));
    assert.deepEqual([c.total, c.dashboard, c.terminal], [2, 0, 2], 'summary.md counts');
  }
);

test('pin 6: approve verify --adopt — the fixed reason on every line', { skip }, async (t) => {
  const { f, P } = project(t, false);
  const r = await person(f, ['approve', 'verify', '--adopt'], { input: 'ADOPT\n' });
  assert.equal(r.status, 0, r.out);
  const log = readLog(P);
  assert.equal(log.length, f.manifest.stories.length);
  // Flips in PR 3: no reason; `via: "adopt"` says it.
  for (const l of log)
    assert.deepEqual(
      [l.via, l.reason, l.before],
      ['adopt', 'adopt current baselines as the starting point', null]
    );
});

test(
  'pin 4: check --update — --reason on every line, and its default',
  { skip: needs },
  async (t) => {
    const { f, P } = project(t, false);
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const cfg = join(f.repo, 'pxsig.config.json');
    const c = JSON.parse(readFileSync(cfg, 'utf8'));
    writeFileSync(cfg, JSON.stringify({ ...c, storybook: { url: sb.url } }, null, 2));
    const only = ['--update', '--only', f.ids.ok, '--retries', '0'];
    for (const extra of [['--reason', 're-taken on purpose'], []]) {
      const input = 'UPDATE 1 BASELINES\n';
      const r = await person(f, [...only, ...extra], { script: 'check.mjs', input });
      assert.equal(r.status, 0, r.out);
    }
    // Flips in PR 3: no reason on the line (`via: "check-update"` says it).
    assert.deepEqual(
      readLog(P).map((l) => [l.id, l.via, l.reason]),
      [
        [f.ids.ok, 'check-update', 're-taken on purpose'],
        [f.ids.ok, 'check-update', 'pxsig check --update'],
      ]
    );
  }
);

test(
  'pin 7: migrate — by "pxsig migrate", "moved from <old path>", the old trail as is',
  { skip },
  (t) => {
    const { f, P } = project(t, false);
    const from = join(f.repo, 'legacy');
    const id = 'components-zeta--default';
    mkdirSync(join(from, 'js'), { recursive: true });
    mkdirSync(join(from, 'sigs'));
    mkdirSync(join(from, '.baselines'));
    copyFileSync(f.sig(f.ids.legacy), join(from, 'sigs', 'zeta.pxsig.json'));
    const story = { id, story: id, mode: 'dark', state: null, importPath: 'src/zeta.stories.tsx' };
    writeFileSync(
      join(from, 'js', 'pxsig.manifest.json'),
      JSON.stringify({ stories: [{ ...story, sig: 'legacy/sigs/zeta.pxsig.json' }] })
    );
    const trail = { at: '2025-01-01T00:00:00.000Z', id, by: 'old@example.test', via: 'cli' };
    const oldLine = { ...trail, batch: 'b0-cli', reason: 'an old reason' };
    writeFileSync(join(from, '.baselines', 'approvals.ndjson'), `${JSON.stringify(oldLine)}\n`);
    migrateLegacy(P, { from, apply: true, verify: false });
    const [copied, moved] = readLog(P);
    // Flips in PR 3 and PR 4: the copied trail loses `by` and `reason`.
    assert.deepEqual(copied, oldLine);
    // Flips in PR 4 (no `by`) and PR 3 (no old path; a `ref`, through `stamp`).
    assert.deepEqual(
      keys(moved),
      ['at', 'id', 'by', 'via', 'batch', 'reason', 'kind', 'gitHead'].concat(['before', 'after'])
    );
    assert.deepEqual(
      [moved.by, moved.via, moved.reason],
      ['pxsig migrate', 'migrate', 'moved from legacy/sigs/zeta.pxsig.json']
    );
  }
);

test('pins 10, 11: approve log text and --json; the integrity entry', { skip }, async (t) => {
  const { f, P, entry } = project(t, true);
  record(P, entry(f.ids.changed), { batch: 'b1-cli', via: 'cli', reason: REASON, before: null });
  const text = await person(f, ['approve', 'log']);
  assert.equal(text.status, 0, text.out);
  // Flips in PR 4 ("By" goes) and PR 3 (the reason comes from the local file).
  assert.match(text.out, /\| When \| Via \| Entries \| By \| Reason \| Batch \|/);
  assert.ok(text.out.includes(EMAIL) && text.out.includes(REASON), text.out);
  const json = await person(f, ['approve', 'log', '--json']);
  const [row] = JSON.parse(json.out);
  // Flips in PR 4 (no `by`); `reason` stays a string or null.
  assert.deepEqual(row, {
    batch: 'b1-cli',
    at: row.at,
    by: EMAIL,
    via: 'cli',
    reason: REASON,
    n: 1,
  });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const e = led.entries.find((x) => x.id === f.ids.changed);
  // Flips in PR 4: `approval: { at, via, batch }`.
  assert.deepEqual(e?.approval, { at: row.at, by: EMAIL, via: 'cli', batch: 'b1-cli' });
});
