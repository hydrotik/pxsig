/**
 * decision-pins.test.mjs — what the approval log commits, pinned while a decision's reason and the
 * approver's identity leave the committed logs (design: a decision commits only its reference).
 * PR 3 flipped its pins: the reason stays on the machine (`reports/decisions.ndjson`, only when
 * reports/ is git-ignored); the logs commit `ref`. PR 4 flipped the rest: no log line, plan or
 * integrity entry names a person, whatever `approvals.identity` says (it is no longer read).
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
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { detectAgent } from '../src/lib/agents.mjs';
import { changedByRoute, paths, readLog, record, route, snapshot } from '../src/lib/approvals.mjs';
import { decisionsFile, readReasons } from '../src/lib/decisions.mjs';
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
 * `approvals.identity: "git-email"`; `ignored` gives the store the .gitignore `pxsig init` writes
 * (else the store's reports/ is not git-ignored, and no reason is kept).
 * @param {{ after: (fn: () => void) => void }} t
 * @param {boolean} identity
 * @param {{ ignored?: boolean }} [o]
 */
function project(t, identity, { ignored = false } = {}) {
  const f = fixture({ t });
  spawnSync('git', ['init', '-q', f.repo]);
  spawnSync('git', ['-C', f.repo, 'config', 'user.email', EMAIL]);
  if (ignored) writeFileSync(join(f.px, '.gitignore'), 'reports/\n');
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

const LINE = ['at', 'id', 'via', 'batch', 'ref', 'kind', 'gitHead', 'before', 'after'];
const NOT_KEPT = 'Reason not kept: .pxsig/reports/ is not git-ignored. pxsig doctor shows the fix.';
/** @param {Fixture} f */
const local = (f) =>
  existsSync(join(f.px, 'reports', 'decisions.ndjson'))
    ? readFileSync(join(f.px, 'reports', 'decisions.ndjson'), 'utf8')
    : null;

test(
  'pins 1, 2: record — the keys in order, never a reason, never a `by` (even with git-email)',
  { skip },
  (t) => {
    const a = project(t, false);
    const l = record(a.P, a.entry(a.f.ids.changed), { batch: 'b1-cli', via: 'cli', before: null });
    // PR 3: no `reason` key at all.
    assert.deepEqual(keys(l), [...LINE, 'pxsig']);
    assert.ok(!('reason' in l));
    assert.ok(!('by' in l));
    assert.deepEqual(readLog(a.P), [l], 'the line returned is the line logged');
    const b = project(t, true);
    const m = record(b.P, b.entry(b.f.ids.changed), { batch: 'b1-cli', via: 'cli', before: null });
    // PR 4: no `by`, whatever approvals.identity says.
    assert.deepEqual(keys(m), [...LINE, 'pxsig']);
    assert.ok(!('by' in m) && !JSON.stringify(readLog(b.P)).includes(EMAIL));
  }
);

test(
  'pins 3, 5: plan --reason → apply through the server; a dashboard undo',
  { skip },
  async (t) => {
    const { f, P, entry } = project(t, true, { ignored: true });
    const id = f.ids.changed;
    const p = paths(P, entry(id));
    writeFileSync(p.latestPng, STRIPES);
    const old = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(p.latestPng, old, old);
    const r = await person(f, ['approve', 'plan', id, '--reason', REASON, '--allow-shape', id]);
    assert.equal(r.status, 0, r.out);
    const plan = JSON.parse(readFileSync(join(P.store.reports, 'approval-plan.json'), 'utf8'));
    // PR 3: the reason, as reports/ is git-ignored (below: not kept otherwise). PR 4: no `by`.
    assert.deepEqual(keys(plan), ['version', 'createdAt', 'project', 'reason', 'entries']);
    assert.equal(plan.reason, REASON);
    const S = await serve(f);
    try {
      const a = await person(f, ['approve', 'apply'], {
        input: 'APPROVE 1 ENTRIES\n',
        url: S.base,
      });
      assert.equal(a.status, 0, `${a.out}\n${S.log()}`);
      assert.match(a.out, new RegExp(`Reason: ${REASON}`), '`apply` prints the reason (stays)');
      assert.ok(!a.out.includes('Reason not kept'), a.out);
      const [line] = readLog(P);
      // PR 3: no `reason` on the line; it stays beside the line's ref. PR 4: no `by`.
      assert.deepEqual([line.via, line.reason, line.by], ['cli', undefined, undefined]);
      assert.deepEqual(keys(line), [...LINE, 'pxsig']);
      assert.equal(readReasons(P).get(String(line.ref)), REASON);
      const kept = JSON.parse(readFileSync(decisionsFile(P), 'utf8'));
      assert.deepEqual(
        Object.keys(kept).filter((k) => k !== 'agent'),
        ['at', 'ref', 'log', 'id', 'batch', 'via', 'reason', 'pxsig']
      );
      assert.deepEqual(
        [kept.log, kept.id, kept.batch, kept.via],
        ['approvals', id, line.batch, 'cli']
      );
      assert.ok(!JSON.stringify(kept).includes(EMAIL), 'the local file names no person');
      const u = await S.post('unreview', { id });
      assert.equal(u.status, 200, JSON.stringify(u.body));
      const undo = readLog(P)[1];
      // PR 3: `undo: { in: "dashboard", from: "snapshot" }` instead of the reason text.
      assert.deepEqual(
        [undo.batch, undo.via, undo.reason, undo.undo, undo.by],
        [`${line.batch}-undo`, 'undo', undefined, { in: 'dashboard', from: 'snapshot' }, undefined]
      );
      assert.deepEqual(keys(undo), [...LINE, 'undo', 'pxsig']);
      assert.ok(!readFileSync(P.store.approvals, 'utf8').includes(EMAIL), 'the log names no one');
      assert.deepEqual([route(line), route(undo)], ['terminal', 'dashboard']);
      const c = changedByRoute(readLog(P));
      assert.deepEqual([c.total, c.dashboard, c.terminal], [1, 1, 0], 'summary.md counts');
    } finally {
      await S.stop();
    }
  }
);

test(
  'PR 3: a store whose reports/ is not git-ignored keeps no reason; one line says so; exits unchanged',
  { skip },
  async (t) => {
    const { f, P } = project(t, false);
    const id = f.ids.changed;
    writeFileSync(
      paths(
        P,
        /** @type {ManifestEntry} */ (f.manifest.stories.find((e) => e.id === id))
      ).latestPng,
      STRIPES
    );
    const r = await person(f, ['approve', 'plan', id, '--reason', REASON, '--allow-shape', id]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Reason\W+not kept \(reports\/ is not git-ignored\)/);
    const plan = JSON.parse(readFileSync(join(P.store.reports, 'approval-plan.json'), 'utf8'));
    assert.equal(plan.reason, null, 'the plan in reports/ holds no reason');
    const S = await serve(f);
    try {
      const input = 'APPROVE 1 ENTRIES\n';
      const a = await person(f, ['approve', 'apply'], { input, url: S.base });
      assert.equal(a.status, 0, `${a.out}\n${S.log()}`);
      assert.equal(a.out.split(NOT_KEPT).length - 1, 1, `once, store-relative:\n${a.out}`);
      assert.match(a.out, /Reason: not kept \(reports\/ is not git-ignored\)/);
      // A reason sent to the server anyway (a client with the CLI's token): not kept either.
      const s = await S.post('approve', { id: f.ids.drift, reason: REASON });
      assert.equal(s.status, 200, JSON.stringify(s.body));
    } finally {
      await S.stop();
    }
    assert.equal(readLog(P).length, 2);
    for (const l of readLog(P)) assert.ok(!('reason' in l), JSON.stringify(l));
    assert.equal(local(f), null, 'no decisions.ndjson');
    assert.ok(!readFileSync(P.store.approvals, 'utf8').includes(REASON));
  }
);

test(
  'pin 5: approve undo — `undo.in` terminal, `undo.from` snapshot or git; no reason',
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
    // PR 3: `undo: { in: "terminal", from: "snapshot" | "git" }`, no reason.
    assert.deepEqual(
      undo.map((l) => [l.batch, l.reason, l.undo]),
      [
        ['b1-cli-undo', undefined, { in: 'terminal', from: 'snapshot' }],
        ['b2-cli-undo', undefined, { in: 'terminal', from: 'git' }],
      ]
    );
    assert.deepEqual(undo.map(route), ['terminal', 'terminal']);
    const c = changedByRoute(readLog(P));
    assert.deepEqual([c.total, c.dashboard, c.terminal], [2, 0, 2], 'summary.md counts');
  }
);

test('pin 6: approve verify --adopt — no reason; `via: "adopt"` says it', { skip }, async (t) => {
  const { f, P } = project(t, false);
  const r = await person(f, ['approve', 'verify', '--adopt'], { input: 'ADOPT\n' });
  assert.equal(r.status, 0, r.out);
  const log = readLog(P);
  assert.equal(log.length, f.manifest.stories.length);
  // PR 3: no reason; `via: "adopt"` says it.
  for (const l of log) {
    assert.deepEqual([l.via, l.before], ['adopt', null]);
    assert.ok(!('reason' in l), JSON.stringify(l));
  }
});

test(
  'pin 4: check --update — no reason on any line; --reason not kept where reports/ is not ignored',
  { skip: needs },
  async (t) => {
    const { f, P } = project(t, false);
    const sb = await fakeStorybook(f.index.stories);
    t.after(() => sb.close());
    const cfg = join(f.repo, 'pxsig.config.json');
    const c = JSON.parse(readFileSync(cfg, 'utf8'));
    writeFileSync(cfg, JSON.stringify({ ...c, storybook: { url: sb.url } }, null, 2));
    const only = ['--update', '--only', f.ids.ok, '--retries', '0'];
    /** @type {string[]} */
    const outs = [];
    for (const extra of [['--reason', 're-taken on purpose'], []]) {
      const input = 'UPDATE 1 BASELINES\n';
      const r = await person(f, [...only, ...extra], { script: 'check.mjs', input });
      assert.equal(r.status, 0, r.out);
      outs.push(r.out);
    }
    // PR 3: no reason on the line (`via: "check-update"` says it), no default text.
    assert.deepEqual(
      readLog(P).map((l) => [l.id, l.via, 'reason' in l]),
      [
        [f.ids.ok, 'check-update', false],
        [f.ids.ok, 'check-update', false],
      ]
    );
    assert.deepEqual(
      outs.map((o) => o.includes(NOT_KEPT)),
      [true, false],
      'said once, for the run with --reason'
    );
    assert.equal(local(f), null);
  }
);

test(
  'pin 7: migrate — no old path, a ref per line; the old trail loses its reason, kept locally',
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
    // PR 3: the copied trail loses `reason` and gains a `ref`; migrate wrote the store's
    // .gitignore, so the old reason is kept beside that ref. PR 4: it loses `by` too.
    const { by: _by, ...rest } = trail;
    assert.deepEqual(copied, { ...rest, batch: 'b0-cli', ref: copied.ref });
    assert.match(String(copied.ref), /^d_[A-Za-z0-9_-]{16}$/);
    assert.equal(readReasons(P).get(String(copied.ref)), 'an old reason');
    // PR 3: no old path; a `ref`, through `stamp`. PR 4: no `by`.
    assert.deepEqual(keys(moved), [...LINE, 'pxsig']);
    assert.deepEqual([moved.by, moved.via, moved.reason], [undefined, 'migrate', undefined]);
    const text = readFileSync(P.store.approvals, 'utf8');
    assert.ok(!text.includes('legacy/sigs') && !/"by":/.test(text), 'no old path, no `by`');
  }
);

test('pins 10, 11: approve log text and --json; the integrity entry', { skip }, async (t) => {
  const { f, P, entry } = project(t, true, { ignored: true });
  const opts = { batch: 'b1-cli', via: 'cli', reason: REASON, ignored: true, before: null };
  record(P, entry(f.ids.changed), opts);
  const text = await person(f, ['approve', 'log']);
  assert.equal(text.status, 0, text.out);
  // PR 3: the reason comes from the local file. PR 4: "By" goes.
  assert.match(text.out, /\| When \| Via \| Entries \| Reason \| Batch \|/);
  assert.ok(!text.out.includes(EMAIL) && text.out.includes(REASON), text.out);
  const json = await person(f, ['approve', 'log', '--json']);
  const [row] = JSON.parse(json.out);
  // PR 4: no `by`; `reason` stays a string or null.
  assert.deepEqual(row, {
    batch: 'b1-cli',
    at: row.at,
    via: 'cli',
    reason: REASON,
    n: 1,
  });
  const led = await reconcile(f.ctx, { index: f.index, affected: f.affected });
  const e = led.entries.find((x) => x.id === f.ids.changed);
  // PR 4: `approval: { at, via, batch }`.
  assert.deepEqual(e?.approval, { at: row.at, via: 'cli', batch: 'b1-cli' });
  spawnSync('git', ['-C', f.repo, 'add', '-A']);
  spawnSync('git', ['-C', f.repo, '-c', 'user.name=Probe', 'commit', '-qm', 'approve']);
  const trace = await person(f, ['approve', 'log', '--trace', '--json']);
  assert.equal(trace.status, 0, trace.out);
  assert.ok(!trace.out.includes(EMAIL), 'the commit says who; the trace shows no email');
  // `--trace` keeps Commit and PR; still no `by`.
  const [traced] = JSON.parse(trace.out);
  assert.deepEqual(Object.keys(traced), ['batch', 'at', 'via', 'reason', 'n', 'commit', 'pr']);
});

test(
  "PR 3: approve log — an old line's own reason; a clean clone and a corrupt local file exit 0",
  { skip },
  async (t) => {
    const { f, P, entry } = project(t, false, { ignored: true });
    const old = { at: '2026-01-01T00:00:00.000Z', id: f.ids.ok, via: 'cli', batch: 'b0-cli' };
    writeFileSync(P.store.approvals, `${JSON.stringify({ ...old, reason: 'an old reason' })}\n`);
    record(P, entry(f.ids.changed), {
      batch: 'b1-cli',
      via: 'cli',
      reason: REASON,
      ignored: true,
      before: null,
    });
    /** @returns {Promise<Record<string, string | null>>} */
    const reasons = async () => {
      const r = await person(f, ['approve', 'log', '--json']);
      assert.equal(r.status, 0, r.out);
      return Object.fromEntries(
        JSON.parse(r.out).map((/** @type {{ batch: string, reason: string | null }} */ b) => [
          b.batch,
          b.reason,
        ])
      );
    };
    assert.deepEqual(await reasons(), { 'b1-cli': REASON, 'b0-cli': 'an old reason' });
    // Torn and broken lines are left out; the old line's own reason still shows.
    writeFileSync(decisionsFile(P), '{"ref":\nnot json\n[1]\n{"ref":"d_x"');
    assert.deepEqual(await reasons(), { 'b1-cli': null, 'b0-cli': 'an old reason' });
    // A clean clone: no reports/ at all.
    rmSync(P.store.reports, { recursive: true, force: true });
    assert.deepEqual(await reasons(), { 'b1-cli': null, 'b0-cli': 'an old reason' });
    const text = await person(f, ['approve', 'log']);
    assert.equal(text.status, 0, text.out);
  }
);
