/**
 * prune.test.mjs — `pxsig a11y --prune` (src/lib/prune.mjs): the evidence rule's four classes, the
 * plan, applying it (pinned to a11y.json, logged per entry), the refusals, and the server route.
 *
 *   node --test packages/pxsig/test/prune.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readToken } from '../src/lib/guard.mjs';
import {
  applyPrune,
  buildPlan,
  checkPlan,
  classify,
  confirmPrune,
  coverCommands,
  prunePhrase,
} from '../src/lib/prune.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const row = (id, extra = {}) => ({
  id,
  mode: 'dark',
  pass: true,
  checkedAt: at(10),
  a11y: { violations: [], new: 0 },
  ...extra,
});
const report = (rows, /** @type {string | null} */ suite = null) => ({
  suite,
  file: suite ? `.pxsig/reports/check-${suite}.json` : '.pxsig/reports/check.json',
  check: { generatedAt: at(0), rows },
});
const fresh = () => ({ ids: new Map(), unknown: null });
const run = (over = {}) =>
  classify({
    accepted: {},
    reports: [],
    decided: new Map(),
    approved: new Map(),
    stale: fresh,
    ...over,
  }).map((i) => [i.id, i.rule, i.class, i.why]);

test('a fresh row without the rule makes it prunable; with it, it still fires', () => {
  const items = run({
    accepted: { a: ['region', 'label'] },
    reports: [report([row('a', { a11y: { violations: [{ id: 'label' }], new: 0 } })])],
  });
  assert.deepEqual(items, [
    ['a', 'label', 'still-fires', 'still in its violations'],
    ['a', 'region', 'prunable', 'not in its violations'],
  ]);
});

test('a row checked before the last accessibility decision or approval is stale', () => {
  const reports = [report([row('a'), row('b')])];
  const items = run({
    accepted: { a: ['r'], b: ['r'] },
    reports,
    decided: new Map([['a', T0 + 20 * 60_000]]),
    approved: new Map([['b', T0 + 10 * 60_000]]),
  });
  assert.equal(items[0][2], 'stale');
  assert.match(
    items[0][3],
    /^accessibility decision at 2026-10-20T10:20:00.000Z, after this check$/
  );
  assert.equal(
    items[1][2],
    'stale',
    'an approval at the same time as the check counts as after it'
  );
  assert.match(items[1][3], /^approved at/);
});

test('a row `pxsig stale` names, or a report whose staleness cannot be traced, is stale', () => {
  const reports = [report([row('a'), row('b')])];
  const one = run({
    accepted: { a: ['r'], b: ['r'] },
    reports,
    stale: () => ({ ids: new Map([['a', 'src/A.tsx']]), unknown: null }),
  });
  assert.deepEqual(
    one.map((x) => x[2]),
    ['stale', 'prunable']
  );
  assert.equal(one[0][3], 'src/A.tsx changed after this check');
  const all = run({
    accepted: { a: ['r'] },
    reports,
    stale: () => ({
      ids: new Map(),
      unknown: '500 source files edited since it was checked: too many to trace',
    }),
  });
  assert.equal(all[0][2], 'stale');
});

test('no row where axe ran is not covered: never checked, --no-a11y, a render error, an axe error, left out', () => {
  const reports = [
    report([
      row('noaxe', { a11y: null }),
      row('err', { error: 'Timeout' }),
      row('axe', { a11y: { error: 'axe threw' } }),
      row('skip', { skipped: true }),
    ]),
  ];
  const items = run({
    accepted: { none: ['r'], noaxe: ['r'], err: ['r'], axe: ['r'], skip: ['r'] },
    reports,
  });
  assert.deepEqual(
    items.map((x) => [x[0], x[2], x[3]]),
    [
      ['axe', 'not-covered', 'axe failed: axe threw'],
      ['err', 'not-covered', 'its render failed'],
      ['noaxe', 'not-covered', 'axe did not run on it'],
      ['none', 'not-covered', 'no report has a row for it'],
      ['skip', 'not-covered', 'left out of its last run'],
    ]
  );
});

test("a suite's row counts, the freshest usable row wins, and empty lists are not listed", () => {
  const items = classify({
    accepted: { 'a@lime': ['r'], b: ['r'], c: [] },
    reports: [
      report([row('b', { checkedAt: at(5), a11y: { violations: [{ id: 'r' }], new: 0 } })]),
      report([row('a@lime'), row('b', { checkedAt: at(30) })], 'matrix'),
    ],
    decided: new Map(),
    approved: new Map(),
    stale: fresh,
  });
  assert.deepEqual(
    items.map((i) => [i.id, i.class, i.suite, i.report]),
    [
      ['a@lime', 'prunable', 'matrix', '.pxsig/reports/check-matrix.json'],
      ['b', 'prunable', 'matrix', '.pxsig/reports/check-matrix.json'],
    ]
  );
});

test('filters: --component, --mode and --only', () => {
  const reports = [
    report([
      row('components-x--a'),
      row('components-x--a@light', { mode: 'light' }),
      row('components-y--b'),
    ]),
  ];
  const accepted = {
    'components-x--a': ['r'],
    'components-x--a@light': ['r'],
    'components-y--b': ['r'],
  };
  const ids = (o) =>
    classify({
      accepted,
      reports,
      decided: new Map(),
      approved: new Map(),
      stale: fresh,
      ...o,
    }).map((i) => i.id);
  assert.deepEqual(ids({ component: 'X' }), ['components-x--a', 'components-x--a@light']);
  assert.deepEqual(ids({ mode: 'light' }), ['components-x--a@light']);
  assert.deepEqual(ids({ only: ['components-y--b'] }), ['components-y--b']);
});

test('the rest come with the command that would decide them', () => {
  const items = [
    { id: 'a', class: 'not-covered', suite: null },
    { id: 'b', class: 'not-covered', suite: 'matrix' },
    { id: 'c', class: 'stale', suite: null },
    { id: 'c', class: 'stale', suite: null },
    { id: 'd', class: 'prunable', suite: null },
  ];
  assert.deepEqual(coverCommands(items, 'pxsig'), [
    { class: 'not-covered', entries: 1, command: 'pxsig check --full' },
    { class: 'not-covered', entries: 1, command: 'pxsig check --full --suite matrix' },
    { class: 'stale', entries: 1, command: 'pxsig check c' },
  ]);
});

/** The fixture with accepted lists: alpha's two rules no longer fire, the a11y entry's color-contrast does. */
function project() {
  const f = fixture({ withSigs: false });
  writeFileSync(
    join(f.px, 'a11y.json'),
    JSON.stringify({
      [f.ids.ok]: ['region', 'color-contrast'],
      [f.ids.a11y]: ['color-contrast', 'label'],
      [f.ids.error]: ['x'],
    })
  );
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  const plan = buildPlan(P, { stale: fresh, modeOf: () => 'dark' });
  return { f, P, plan };
}
const decisions = (f) =>
  existsSync(join(f.px, 'a11y-decisions.ndjson'))
    ? readFileSync(join(f.px, 'a11y-decisions.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];

test('the plan groups the prunable rules per entry and pins a11y.json', () => {
  const { f, plan } = project();
  assert.deepEqual(plan.counts, { prunable: 3, 'still-fires': 1, stale: 0, 'not-covered': 1 });
  assert.deepEqual(
    plan.prune.map((p) => [p.id, p.rules, p.after]),
    [
      [f.ids.ok, ['color-contrast', 'region'], []],
      [f.ids.a11y, ['label'], ['color-contrast']],
    ]
  );
  assert.match(plan.a11ySha, /^[0-9a-f]{64}$/);
  assert.equal(checkPlan(plan), null);
});

test('applying writes a11y.json, one log line per entry (no name, no agent), and the report rows', () => {
  const { f, P, plan } = project();
  // Under an assistant's marker: a `cli` decision is a person's (the CLI refuses under a marker).
  const prev = process.env.CLAUDECODE;
  process.env.CLAUDECODE = '1';
  let r;
  try {
    r = applyPrune(P, plan, { batch: 'b-1', reason: 'fixed in #12' });
  } finally {
    if (prev === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = prev;
  }
  assert.deepEqual([r.entries, r.rules], [2, 3]);
  const base = JSON.parse(readFileSync(join(f.px, 'a11y.json'), 'utf8'));
  assert.deepEqual(base, {
    [f.ids.ok]: [],
    [f.ids.a11y]: ['color-contrast'],
    [f.ids.error]: ['x'],
  });
  const lines = decisions(f);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.deepEqual(Object.keys(l).sort(), [
      'action',
      'after',
      'at',
      'batch',
      'before',
      'evidence',
      'id',
      'pxsig',
      'reason',
      'rules',
      'via',
    ]);
    assert.deepEqual([l.action, l.via, l.batch, l.reason], ['prune', 'cli', 'b-1', 'fixed in #12']);
    assert.equal(l.evidence.report, '.pxsig/reports/check.json');
  }
  const row = JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows.find(
    (x) => x.id === f.ids.a11y
  );
  assert.deepEqual(row.a11y.baseline, ['color-contrast']);
});

test('a decision made after planning refuses the whole plan; a bad plan is refused; nothing is written', () => {
  const { f, P, plan } = project();
  writeFileSync(
    join(f.px, 'a11y.json'),
    JSON.stringify({ [f.ids.ok]: ['region', 'color-contrast'] })
  );
  assert.throws(
    () => applyPrune(P, plan, { batch: 'b' }),
    (e) => e.status === 409 && /changed since this plan/.test(e.message)
  );
  assert.throws(
    () => applyPrune(P, { ...plan, prune: [{ id: '../x', rules: ['r'] }] }, { batch: 'b' }),
    (e) => e.status === 400
  );
  assert.deepEqual(decisions(f), []);
});

test('the confirmation is the exact phrase; anything else confirms nothing', async () => {
  const { plan } = project();
  assert.equal(prunePhrase(3), 'PRUNE 3 RULES');
  assert.equal(await confirmPrune(plan, async () => 'PRUNE 3 RULES'), true);
  assert.equal(await confirmPrune(plan, async () => 'prune 3 rules'), false);
  assert.equal(await confirmPrune(plan, async () => 'PRUNE 2 RULES'), false);
});

const cli = (f, args, env = {}) => {
  const base = { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' };
  for (const k of Object.keys(base))
    if (
      /^(CLAUDE|AI_AGENT|CODEX|COPILOT|GEMINI|CURSOR|CLINE|ROO|AMP|OPENCODE|PXSIG_AGENT|AGENT$|CI$)/.test(
        k
      )
    )
      delete base[k];
  return spawnSync(process.execPath, [join(src, 'cli.mjs'), ...args], {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...base, ...env },
  });
};

test(
  "the dry run is anyone's and exits 0; pruning refuses piped, in CI and under an assistant, writing nothing",
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const { f } = project();
    const before = readFileSync(join(f.px, 'a11y.json'), 'utf8');
    const dry = cli(f, ['a11y', '--prune', '--dry-run', '--json'], { PXSIG_AGENT: '1' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout).counts, {
      prunable: 3,
      'still-fires': 1,
      stale: 0,
      'not-covered': 1,
    });
    for (const [env, why] of [
      [{}, /refused: output is piped/],
      [{ CI: '1' }, /refused in CI/],
      [{ PXSIG_AGENT: '1' }, /refused under agent \(PXSIG_AGENT=1\)/],
    ]) {
      const r = cli(f, ['a11y', '--prune'], env);
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, why);
    }
    assert.equal(readFileSync(join(f.px, 'a11y.json'), 'utf8'), before);
    assert.deepEqual(decisions(f), []);
  }
);

// --- through the server ------------------------------------------------------------------------

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
const raw = (port, { method = 'POST', path, headers = {}, body }) =>
  new Promise((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => ok({ status: res.statusCode, text: s, json: () => JSON.parse(s) }));
      }
    );
    req.on('error', fail);
    req.end(data);
  });

async function serve(f) {
  const port = await freePort();
  const dash = mkdtempSync(join(tmpdir(), 'pxsig-dash-'));
  writeFileSync(join(dash, 'index.html'), '<!doctype html><title>pxsig</title>');
  const proc = spawn(
    process.execPath,
    [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
    {
      cwd: f.repo,
      env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '', PXSIG_DASHBOARD_DIR: dash },
    }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
    proc.stdout.on('data', () => /dashboard →/.test(log) && (clearTimeout(t), ok()));
  });
  const exited = new Promise((ok) => proc.on('exit', ok));
  return { port, url: `http://127.0.0.1:${port}`, stop: () => (proc.kill('SIGTERM'), exited) };
}

test(
  "the server's route takes the CLI's token only, refuses a stale plan, writes and tells the dashboard",
  { skip: !hasRust && 'Rust binary not built' },
  async () => {
    const { f, plan } = project();
    const S = await serve(f);
    const events = [];
    const sse = request({ host: '127.0.0.1', port: S.port, path: '/__pxsig/events' }, (res) =>
      res.on('data', (c) => events.push(String(c)))
    );
    sse.end();
    try {
      const body = {
        project: 'fixture',
        plan: { a11ySha: plan.a11ySha, prune: plan.prune },
        batch: 'b-srv',
        reason: 'fixed',
      };
      const cliToken = readToken(f.repo, S.url);
      const mcpToken = readToken(f.repo, S.url, 'mcp');
      assert.equal(
        (await raw(S.port, { path: '/__pxsig/a11y-prune', body })).status,
        403,
        'no token'
      );
      assert.equal(
        (
          await raw(S.port, {
            path: '/__pxsig/a11y-prune',
            headers: { 'x-pxsig-token': mcpToken },
            body,
          })
        ).status,
        403,
        "the MCP's token"
      );
      assert.equal(
        (
          await raw(S.port, {
            path: '/__pxsig/a11y-prune',
            headers: { 'x-pxsig-token': cliToken, origin: S.url, 'sec-fetch-site': 'same-origin' },
            body,
          })
        ).status,
        403,
        'a browser without the dashboard link'
      );
      assert.deepEqual(decisions(f), []);
      const stale = await raw(S.port, {
        path: '/__pxsig/a11y-prune',
        headers: { 'x-pxsig-token': cliToken },
        body: { ...body, plan: { ...body.plan, a11ySha: '0'.repeat(64) } },
      });
      assert.equal(stale.status, 409, stale.text);
      const ok = await raw(S.port, {
        path: '/__pxsig/a11y-prune',
        headers: { 'x-pxsig-token': cliToken },
        body,
      });
      assert.equal(ok.status, 200, ok.text);
      assert.deepEqual([ok.json().entries, ok.json().rules, ok.json().batch], [2, 3, 'b-srv']);
      const lines = decisions(f);
      assert.deepEqual(
        [lines.length, lines[0].via, lines[0].action, lines[0].batch],
        [2, 'cli', 'prune', 'b-srv']
      );
      assert.deepEqual(JSON.parse(readFileSync(join(f.px, 'a11y.json'), 'utf8'))[f.ids.ok], []);
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(events.join('').includes('event: data'), 'the dashboard hears of it');
    } finally {
      sse.destroy();
      await S.stop();
    }
  }
);
