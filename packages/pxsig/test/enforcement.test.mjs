// Warn mode (P13, PHASE-1 §10, 10a core): per-gate enforce | warn, who may lower a gate, the exit
// a warned run takes, warnUntil, the quiet a11y default (decision 88), the readiness tally (R7, R26),
// the setup codes, SARIF, and the gated commands end to end on fixture projects.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendReadiness,
  checkFindings,
  combineExits,
  enforcementProblems,
  GATES,
  lastLine,
  leadLine,
  outcome,
  readinessPath,
  readinessTally,
  reportBlock,
  resolveEnforcement,
  speaks,
} from '../src/lib/enforcement.mjs';
import { repoKey } from '../src/lib/machine.mjs';
import { sarifLog } from '../src/lib/sarif.mjs';
import { record } from '../src/lib/approvals.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));

/** @import { ManifestEntry } from '../src/types.js' */

/**
 * What `resolveEnforcement` returns, with its per-gate maps (gate → mode, gate → layer) read by
 * gate name: it fills them for every gate in GATES.
 * @typedef {Record<string, string> & Record<'visual' | 'a11y' | 'verify' | 'env' | 'doctor' | 'stale', string>} PerGate
 * @typedef {import('../src/types/t2.js').Enforcement} Enforcement
 */

/**
 * A stand-in project: just what resolveEnforcement reads.
 * @param {Record<string, unknown> | undefined} enforcement
 * @param {Record<string, string>} [sources]
 */
const proj = (enforcement, sources = {}) => ({
  name: 'p',
  workspaceRoot: tmpdir(),
  config: enforcement === undefined ? {} : { enforcement },
  configSources: sources,
});
const person = { human: () => true };
const robot = { human: () => false, why: () => 'refused in CI (CI is set)' };
/** @param {string} iso */
const at = (iso) => new Date(iso);

test('the built-in defaults: every gate enforced, the a11y gate on a quiet warn', () => {
  const e = resolveEnforcement(proj(undefined), { env: {} });
  assert.deepEqual(e.gates, {
    visual: 'enforce',
    a11y: 'warn',
    verify: 'enforce',
    env: 'enforce',
    doctor: 'enforce',
    stale: 'enforce',
  });
  assert.equal(e.layers.a11y, 'built-in');
  assert.deepEqual(e.configured, []);
  assert.deepEqual(e.quiet, ['a11y']);
  assert.equal(leadLine(e), null, 'nothing to announce');
});

test('resolution: committed config lowers, --warn needs a person, anything can raise', () => {
  const cfg = { default: 'warn', gates: { verify: 'enforce' } };
  const src = {
    'enforcement.default': 'project config',
    'enforcement.gates.verify': 'project config',
  };
  let e = resolveEnforcement(proj(cfg, src), { env: {} });
  assert.equal(e.gates.visual, 'warn');
  assert.equal(e.gates.verify, 'enforce', 'a gate key beats default');
  assert.equal(e.gates.a11y, 'warn');
  assert.equal(e.layers.a11y, 'built-in', '`default` never sets the a11y gate');
  assert.equal(
    resolveEnforcement(proj({ default: 'enforce' }, { 'enforcement.default': 'project config' }), {
      env: {},
    }).gates.a11y,
    'warn'
  );
  assert.equal(e.layers.visual, 'project config');
  // --enforce raises, always.
  e = resolveEnforcement(proj(cfg, src), { env: {}, flags: { enforce: 'visual' } });
  assert.equal(e.gates.visual, 'enforce');
  assert.equal(e.layers.visual, '--enforce');
  e = resolveEnforcement(proj(cfg, src), { env: { PXSIG_ENFORCEMENT: 'enforce' } });
  assert.ok(
    GATES.every((g) => e.gates[g] === 'enforce'),
    'PXSIG_ENFORCEMENT=enforce raises every gate'
  );
  // The variable can never lower one.
  assert.throws(
    () => resolveEnforcement(proj(undefined), { env: { PXSIG_ENFORCEMENT: 'warn' } }),
    (/** @type {Error & { exit?: number }} */ x) => x.exit === 2 && /refused/.test(x.message)
  );
  assert.throws(
    () => resolveEnforcement(proj(undefined), { env: { PXSIG_ENFORCEMENT: 'loose' } }),
    (/** @type {Error & { exit?: number }} */ x) => x.exit === 2
  );
  // --warn: a person at a terminal only; CI, assistants and pipes are refused with exit 3.
  assert.throws(
    () => resolveEnforcement(proj(undefined), { env: {}, flags: { warn: true }, ...robot }),
    (/** @type {Error & { exit?: number }} */ x) =>
      x.exit === 3 && /person at a terminal/.test(x.message)
  );
  e = resolveEnforcement(proj(undefined), { env: {}, flags: { warn: 'visual,doctor' }, ...person });
  assert.equal(e.gates.visual, 'warn');
  assert.equal(e.layers.visual, '--warn');
  assert.deepEqual(e.configured.sort(), ['doctor', 'visual']);
  // A raise beats a person's lower in the same run.
  e = resolveEnforcement(proj(undefined), {
    env: { PXSIG_ENFORCEMENT: 'enforce' },
    flags: { warn: true },
    ...person,
  });
  assert.equal(e.gates.visual, 'enforce');
  assert.throws(
    () => resolveEnforcement(proj(undefined), { env: {}, flags: { enforce: 'pixels' } }),
    /unknown gate "pixels"/
  );
});

test('an unknown gate or value in the config is a setup error when the project loads', () => {
  const f = fixture({ withSigs: false });
  const cfgPath = join(f.repo, 'pxsig.config.json');
  const base = JSON.parse(readFileSync(cfgPath, 'utf8'));
  for (const [bad, why] of [
    [{ gates: { pixels: 'warn' } }, /unknown gate "pixels"/],
    [{ gates: { visual: 'off' } }, /gates\.visual must be/],
    [{ advisoryExit: 1 }, /advisoryExit must be 0, or 10 to 125/],
    [{ warnUntil: 'soon' }, /warnUntil must be a date/],
    [{ mode: 'warn' }, /unknown key "mode"/],
  ]) {
    writeFileSync(cfgPath, JSON.stringify({ ...base, enforcement: bad }));
    assert.throws(() => openProject({ cwd: f.repo }), why);
  }
  // The workspace file's defaults and the project's own config: the layer is recorded per gate.
  writeFileSync(cfgPath, JSON.stringify({ ...base, enforcement: { gates: { visual: 'warn' } } }));
  const P = openProject({ cwd: f.repo });
  const e = resolveEnforcement(P, { env: {} });
  assert.equal(e.layers.visual, 'project config');
  assert.equal(e.gates.visual, 'warn');
});

test('the exit: enforce 1, warn advisoryExit, a real failure always wins, the quiet gate exits 0', () => {
  const warnVisual = resolveEnforcement(proj({ gates: { visual: 'warn' } }), { env: {} });
  const changed = [
    { gate: 'visual', exit: 1, count: 3, what: 'changed' },
    { gate: 'a11y', exit: 0, count: 0, what: 'x' },
  ];
  assert.equal(
    outcome(resolveEnforcement(proj(undefined), { env: {} }), changed).exit,
    1,
    'enforce'
  );
  let o = outcome(warnVisual, changed);
  assert.equal(o.exit, 0);
  assert.equal(o.wouldExit, 1);
  assert.equal(o.advisory, true);
  assert.deepEqual(o.reasons, [{ gate: 'visual', count: 3, what: 'changed' }]);
  o = outcome(
    resolveEnforcement(proj({ gates: { visual: 'warn' }, advisoryExit: 78 }), { env: {} }),
    changed
  );
  assert.equal(o.exit, 78, 'advisoryExit');
  // warn on visual, but a verify mismatch (never warned) fails the run.
  o = outcome(warnVisual, [
    ...changed,
    { gate: null, exit: 1, count: 1, what: 'differ from their logged approval' },
  ]);
  assert.equal(o.exit, 1);
  assert.equal(o.advisory, false);
  // A setup error is never warned.
  assert.equal(
    outcome(warnVisual, [{ gate: null, exit: 2, count: 1, what: 'setup' }, ...changed]).exit,
    2
  );
  // The quiet built-in a11y gate: a new violation exits 0, even when the team chose advisoryExit 78.
  const quiet = resolveEnforcement(proj({ advisoryExit: 78 }), { env: {} });
  o = outcome(quiet, [
    { gate: 'visual', exit: 0, count: 0, what: 'changed' },
    { gate: 'a11y', exit: 1, count: 1, what: 'entry with new a11y violations' },
  ]);
  assert.equal(o.exit, 0);
  assert.equal(o.wouldFail, true);
  // a11y: enforce makes a new violation fail; off drops the gate.
  const a11yFound = [{ gate: 'a11y', exit: 1, count: 2, what: 'entries' }];
  assert.equal(
    outcome(resolveEnforcement(proj({ gates: { a11y: 'enforce' } }), { env: {} }), a11yFound).exit,
    1
  );
  o = outcome(resolveEnforcement(proj({ gates: { a11y: 'off' } }), { env: {} }), a11yFound);
  assert.equal(o.exit, 0);
  assert.equal(o.wouldFail, false, 'off: not even a would-fail');
  // Several projects: an advisory exit never hides a real failure.
  assert.equal(combineExits([{ exit: 78, advisory: true }, { exit: 1 }]), 1);
  assert.equal(combineExits([{ exit: 78, advisory: true }, { exit: 0 }]), 78);
  assert.equal(combineExits([{ exit: 0 }, { exit: 2 }, { exit: 1 }]), 2);
});

test('the quiet a11y default says nothing unless a new violation appears (decision 88)', () => {
  const e = resolveEnforcement(proj(undefined), { env: {} });
  const clean = outcome(
    e,
    checkFindings([{ id: 'a', pass: true, a11y: { violations: [], new: 0 } }])
  );
  // speaks' `out` defaults to null; it takes an outcome.
  assert.equal(
    /** @type {(enf: ReturnType<typeof resolveEnforcement>, out?: ReturnType<typeof outcome> | null) => boolean} */ (
      speaks
    )(e, clean),
    false
  );
  assert.equal(reportBlock(e, clean), null, 'no check.json key');
  assert.equal(lastLine(e, clean), null, 'no line');
  assert.equal(
    appendReadiness({ name: 'p', workspaceRoot: tmpdir() }, e, clean, { source: 'check' }),
    null,
    'no readiness line'
  );
  const fired = outcome(
    e,
    checkFindings([
      {
        id: 'a',
        pass: true,
        a11y: { violations: [{ id: 'color-contrast' }], new: 1, baseline: [] },
      },
    ])
  );
  assert.equal(
    /** @type {(enf: ReturnType<typeof resolveEnforcement>, out?: ReturnType<typeof outcome> | null) => boolean} */ (
      speaks
    )(e, fired),
    true
  );
  assert.equal(fired.exit, 0);
  assert.match(
    // A quiet gate that would fail speaks: a line.
    /** @type {string} */ (lastLine(e, fired)),
    /^ADVISORY: would have failed \(exit 1\): 1 entry with new a11y violations\. Not blocking\.$/
  );
  assert.deepEqual(
    // It speaks (above): a block.
    /** @type {NonNullable<ReturnType<typeof reportBlock>>} */ (reportBlock(e, fired)).configured,
    [],
    'the summary.md lead says "warn by default"'
  );
  assert.equal(
    appendReadiness({ name: 'p', workspaceRoot: tmpdir() }, e, fired, { source: 'check' }),
    null,
    'never a readiness line for the quiet default'
  );
});

test('the lead and last lines, and the per-gate-set contexts (decision R1)', () => {
  const e = resolveEnforcement(
    proj(
      { gates: { visual: 'warn' }, warnUntil: '2026-12-31' },
      { 'enforcement.gates.visual': 'project config' }
    ),
    { env: {}, now: at('2026-11-01T00:00:00Z') }
  );
  assert.equal(
    leadLine(e),
    'ADVISORY: warn mode for visual (pxsig.config.json; until 2026-12-31). Failures are reported; the exit stays 0.'
  );
  const o = outcome(e, [
    { gate: 'visual', exit: 1, count: 3, what: 'changed' },
    { gate: 'visual', exit: 1, count: 1, what: 'new' },
    { gate: 'a11y', exit: 0, count: 0, what: 'x' },
  ]);
  assert.equal(
    // lastLine's `tally` defaults to null; it takes readinessTally's result.
    /** @type {(enf: ReturnType<typeof resolveEnforcement>, out: ReturnType<typeof outcome>, tally?: { runs: number, wouldFail: number, main: { branch: string, runs: number, wouldFail: number } | null } | null) => string | null} */ (
      lastLine
    )(e, o, { runs: 31, wouldFail: 4, main: { branch: 'main', runs: 9, wouldFail: 0 } }),
    'ADVISORY: would have failed (exit 1): 3 changed, 1 new. Not blocking. Would-fail runs: 4 of 31 (main 0 of 9).'
  );
  assert.equal(
    lastLine(e, outcome(e, [{ gate: 'visual', exit: 0, count: 0, what: 'changed' }])),
    'ADVISORY: would have passed.'
  );
  // a11y on its quiet warn and visual enforced: the enforce context carries visual, the advisory one a11y.
  const mixed = resolveEnforcement(
    proj({ gates: { verify: 'warn' } }, { 'enforcement.gates.verify': 'project config' }),
    { env: {} }
  );
  // The a11y gate would fail: it speaks, so a block.
  const r = /** @type {NonNullable<ReturnType<typeof reportBlock>>} */ (
    reportBlock(
      mixed,
      outcome(mixed, [
        { gate: 'visual', exit: 0, count: 0, what: 'changed' },
        { gate: 'a11y', exit: 1, count: 1, what: 'entry' },
      ])
    )
  );
  assert.deepEqual(r.contexts, { enforce: ['visual'], advisory: ['a11y'] });
  assert.match(
    // Configured warn: a lead line.
    /** @type {string} */ (
      leadLine(
        resolveEnforcement(
          proj(
            { gates: { doctor: 'warn' }, advisoryExit: 78 },
            { 'enforcement.gates.doctor': 'project config' }
          ),
          { env: {} }
        )
      )
    ),
    /a failure in it exits 78\.$/
  );
});

test('warnUntil: announced from noticeDays before, enforced after it, then said for noticeDays', () => {
  const cfg = { gates: { visual: 'warn' }, warnUntil: '2026-12-31', noticeDays: 14 };
  const sources = { 'enforcement.gates.visual': 'project config' };
  const P = proj(cfg, sources);
  let e = resolveEnforcement(P, { env: {}, now: at('2026-11-01T12:00:00Z') });
  assert.deepEqual(
    enforcementProblems(e).map((x) => x.code),
    ['enforcement-warn']
  );
  e = resolveEnforcement(P, { env: {}, now: at('2026-12-26T12:00:00Z') });
  assert.equal(e.ending, true);
  assert.equal(e.daysLeft, 6);
  assert.deepEqual(
    enforcementProblems(e).map((x) => [x.code, x.severity]),
    [
      ['enforcement-warn', 'info'],
      ['enforcement-ending', 'warn'],
    ]
  );
  // Configured warn (and, below, just expired): a lead line.
  assert.match(/** @type {string} */ (leadLine(e)), /until 2026-12-31, enforced in 6 days/);
  // The end of that day in UTC is still warn; the next instant is enforced, with no commit.
  assert.equal(
    resolveEnforcement(P, { env: {}, now: at('2026-12-31T23:59:59Z') }).gates.visual,
    'warn'
  );
  e = resolveEnforcement(P, { env: {}, now: at('2027-01-02T00:00:00Z') });
  assert.equal(e.gates.visual, 'enforce');
  assert.equal(e.layers.visual, 'warnUntil');
  assert.deepEqual(
    enforcementProblems(e).map((x) => x.code),
    ['enforcement-expired']
  );
  assert.match(
    /** @type {string} */ (leadLine(e)),
    /warn mode ended on 2026-12-31; visual is enforced again/
  );
  assert.equal(outcome(e, [{ gate: 'visual', exit: 1, count: 1, what: 'changed' }]).exit, 1);
  assert.deepEqual(
    enforcementProblems(resolveEnforcement(P, { env: {}, now: at('2027-02-01T00:00:00Z') })),
    [],
    'said for noticeDays only'
  );
  // A person's --warn after the date still lowers it for one local run.
  assert.equal(
    resolveEnforcement(P, {
      env: {},
      now: at('2027-01-02T00:00:00Z'),
      flags: { warn: 'visual' },
      ...person,
    }).gates.visual,
    'warn'
  );
});

test('the readiness tally: one line per configured-warn run, shared by every worktree, kept 90 days', () => {
  const home = tempDir('home');
  const opts = {
    env: { XDG_STATE_HOME: join(home, 'state'), LOCALAPPDATA: join(home, 'state') },
    home,
  };
  const repo = tempDir('ready');
  /**
   * @param {string} cwd
   * @param {...string} a
   */
  const g = (cwd, ...a) =>
    spawnSync('git', a, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    });
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'commit', '-q', '--allow-empty', '-m', 'x');
  const wt = join(tempDir('wt'), 'checkout');
  // A branch name of its own: git would name it after the folder, and a space is not allowed in one.
  g(repo, 'worktree', 'add', '-q', '-b', 'wt', wt);
  assert.equal(
    repoKey(repo, opts),
    repoKey(wt, opts),
    "a worktree shares its clone's state folder (R7)"
  );
  const P = { name: 'p', workspaceRoot: repo };
  const W = { name: 'p', workspaceRoot: wt };
  const e = resolveEnforcement(
    proj({ gates: { visual: 'warn' } }, { 'enforcement.gates.visual': 'project config' }),
    { env: {} }
  );
  const fail = outcome(e, [{ gate: 'visual', exit: 1, count: 2, what: 'changed' }]);
  const pass = outcome(e, [{ gate: 'visual', exit: 0, count: 0, what: 'changed' }]);
  // Configured warn: a readiness line, in a git repository (so it has a sha).
  const line = /** @type {NonNullable<ReturnType<typeof appendReadiness>>} */ (
    appendReadiness(P, e, fail, { source: 'check', counts: { changed: 2 }, opts })
  );
  assert.equal(line.branch, 'main');
  assert.equal(line.wouldFail, true);
  assert.match(/** @type {string} */ (line.sha), /^[0-9a-f]{40}$/);
  appendReadiness(W, e, pass, { source: 'check', opts });
  assert.equal(readinessPath(P, opts), readinessPath(W, opts));
  assert.ok(
    readinessPath(P, opts).startsWith(
      process.platform === 'darwin' ? join(home, 'Library') : join(home, 'state', 'pxsig')
    )
  );
  // Lines were written above: a tally.
  const t = /** @type {NonNullable<ReturnType<typeof readinessTally>>} */ (
    readinessTally(P, { opts })
  );
  assert.equal(t.runs, 2);
  assert.equal(t.wouldFail, 1);
  assert.deepEqual(t.main, { branch: 'main', runs: 1, wouldFail: 1 });
  // Nothing personal on a line.
  assert.doesNotMatch(readFileSync(readinessPath(P, opts), 'utf8'), /t@example\.com|"by"/);
  // R26: lines older than 90 days go at the next write.
  appendFileSync(
    readinessPath(P, opts),
    `${JSON.stringify({ at: '2020-01-01T00:00:00Z', project: 'p', gates: ['visual'], wouldFail: true })}\n`
  );
  appendReadiness(P, e, pass, { source: 'check', opts });
  assert.equal(
    /** @type {NonNullable<ReturnType<typeof readinessTally>>} */ (readinessTally(P, { opts }))
      .runs,
    3
  );
  rmSync(home, { recursive: true, force: true });
});

test('--sarif: only the new violations, as SARIF 2.1.0 at the story file', () => {
  const rows = [
    {
      id: 'a--x',
      mode: 'dark',
      a11y: {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            help: 'Elements must meet contrast',
            nodes: 2,
            targets: ['#a'],
          },
          { id: 'label', impact: 'critical', help: 'Form elements need labels', nodes: 1 },
        ],
        new: 1,
        baseline: ['label'],
      },
    },
    {
      id: 'b--y',
      a11y: {
        violations: [{ id: 'label', impact: 'minor', help: 'x', nodes: 1 }],
        new: 0,
        baseline: ['label'],
      },
    },
    { id: 'c--z', pass: false },
  ];
  const log = sarifLog(rows, {
    entries: new Map([['a--x', { importPath: 'src/A/A.stories.tsx' }]]),
    version: '0.5.0',
  });
  assert.equal(log.version, '2.1.0');
  assert.match(log.$schema, /sarif-2\.1\.0/);
  const run = log.runs[0];
  assert.equal(run.tool.driver.name, 'pxsig');
  assert.deepEqual(
    run.tool.driver.rules.map((r) => r.id),
    ['color-contrast']
  );
  assert.equal(run.results.length, 1, 'an accepted rule is not a result');
  const r = run.results[0];
  assert.equal(r.ruleId, 'color-contrast');
  assert.equal(r.level, 'error');
  // The entry has an importPath: the result has a physical location.
  assert.equal(
    /** @type {{ artifactLocation: { uri: string } }} */ (r.locations[0].physicalLocation)
      .artifactLocation.uri,
    'src/A/A.stories.tsx'
  );
  assert.equal(r.locations[0].logicalLocations[0].name, 'a--x');
  assert.ok(r.message.text.startsWith('a--x: Elements must meet contrast'));
});

// --- the gated commands, end to end ---------------------------------------------------------------------

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Secret Person',
  GIT_AUTHOR_EMAIL: 'secret@example.com',
  GIT_COMMITTER_NAME: 'Secret Person',
  GIT_COMMITTER_EMAIL: 'secret@example.com',
};
/**
 * @param {string} cwd
 * @param {...string} args
 */
const must = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...AUTHOR } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/**
 * The fixture as a git repository, its baselines logged unless `log` is false, with `enforcement`.
 * @param {{ log?: boolean, enforcement?: Record<string, unknown> }} [opts]
 */
function repoFixture({ log = true, enforcement } = {}) {
  const f = fixture({ withSigs: true });
  rmSync(join(f.repo, '.git'), { recursive: true, force: true });
  must(f.repo, 'init', '-q', '-b', 'main');
  must(f.repo, 'config', 'commit.gpgsign', 'false');
  if (enforcement) {
    const p = join(f.repo, 'pxsig.config.json');
    writeFileSync(
      p,
      JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), enforcement }, null, 2)
    );
  }
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  if (log)
    for (const e of f.manifest.stories)
      record(P, e, { batch: 'b0-cli', via: 'cli', reason: 'first baselines', before: null });
  must(f.repo, 'add', '-A');
  must(f.repo, 'commit', '-q', '-m', 'base');
  const home = tempDir('home');
  /**
   * @param {string[]} args
   * @param {NodeJS.ProcessEnv} [env]
   */
  const cli = (args, env = {}) =>
    spawnSync(process.execPath, [join(src, 'cli.mjs'), ...args], {
      cwd: f.repo,
      encoding: 'utf8',
      // Readiness lines land in this test's own home, never the machine's.
      env: {
        ...testEnv(testHome),
        HOME: home,
        USERPROFILE: home,
        XDG_STATE_HOME: join(home, 'state'),
        LOCALAPPDATA: join(home, 'state'),
        PXSIG_FORMAT: '',
        PXSIG_URL: 'http://127.0.0.1:1',
        PXSIG_BIN: rustBin,
        PXSIG_WORKSPACE: '',
        PXSIG_PROJECT: '',
        PXSIG_ENFORCEMENT: '',
        CI: '',
        ...env,
      },
    });
  return { ...f, P, cli, home };
}

test(
  'approve verify under warn: only untracked baselines are warned; a mismatch still fails',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture({ log: false, enforcement: { gates: { verify: 'warn' } } });
    let r = f.cli(['approve', 'verify']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ADVISORY: warn mode for verify \(pxsig\.config\.json\)/);
    assert.match(
      r.stdout,
      /ADVISORY: would have failed \(exit 1\): \d+ baselines without a log line\. Not blocking\./
    );
    const j = JSON.parse(f.cli(['approve', 'verify', '--json']).stdout);
    assert.equal(j.enforcement.wouldFail, true);
    assert.deepEqual(j.enforcement.contexts, { enforce: [], advisory: ['verify'] });
    // Anyone may raise it back for a run; nobody but a person may lower one, and not by variable.
    assert.equal(f.cli(['approve', 'verify', '--enforce']).status, 1);
    assert.equal(f.cli(['approve', 'verify'], { PXSIG_ENFORCEMENT: 'enforce' }).status, 1);
    r = f.cli(['approve', 'verify'], { PXSIG_ENFORCEMENT: 'warn' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    // A baseline written outside the trail fails in every mode (decision 10.4).
    const g = new Map(f.manifest.stories.map((e) => [e.id, e]));
    const P = f.P;
    for (const e of f.manifest.stories)
      record(P, e, { batch: 'b1-cli', via: 'cli', reason: 'adopted for the test', before: null });
    // The fixture's manifest holds the `ok` entry.
    const sig = join(f.repo, /** @type {ManifestEntry} */ (g.get(f.ids.ok)).sig);
    writeFileSync(sig, Buffer.concat([readFileSync(sig), Buffer.from('x')]));
    r = f.cli(['approve', 'verify']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    // The tally: one line per configured-warn run, in this test's home.
    const lines = readFileSync(
      readinessPath(f.P, {
        env: { XDG_STATE_HOME: join(f.home, 'state'), LOCALAPPDATA: join(f.home, 'state') },
        home: f.home,
      }),
      'utf8'
    )
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(
      lines.length >= 2 && lines.every((l) => l.source === 'verify' && l.project === 'fixture')
    );
  }
);

test(
  '--warn needs a person at a terminal: piped, it exits 3 and runs nothing',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture();
    const r = f.cli(['approve', 'verify', '--warn']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /warn mode for this run needs a person at a terminal/);
    assert.doesNotMatch(r.stdout, /Baseline integrity/, 'nothing ran');
    assert.equal(f.cli(['stale', '--warn=stale'], { CI: '1' }).status, 3);
  }
);

test(
  'no enforcement key: the gated commands print what they did before, byte for byte',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture({ log: false });
    for (const args of [['approve', 'verify'], ['stale'], ['doctor', '--offline'], ['config']]) {
      const r = f.cli(args);
      assert.doesNotMatch(r.stdout + r.stderr, /ADVISORY|Enforcement|enforcement/, args.join(' '));
    }
    assert.ok(
      !existsSync(join(f.home, 'state')) && !existsSync(join(f.home, 'Library')),
      'and writes no readiness line'
    );
    const j = JSON.parse(f.cli(['approve', 'verify', '--json']).stdout);
    assert.equal('enforcement' in j, false);
  }
);

test(
  'doctor and stale under warn exit advisoryExit and say so; doctor lists the setup code',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture({
      enforcement: {
        gates: { doctor: 'warn', stale: 'warn' },
        advisoryExit: 78,
        warnUntil: '2099-12-31',
      },
    });
    const enforced = repoFixture();
    const plain = enforced.cli(['doctor', '--offline']);
    assert.equal(plain.status, 1, 'the fixture has findings at or above warn');
    const r = f.cli(['doctor', '--offline']);
    assert.equal(r.status, 78, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /ADVISORY: warn mode for doctor, stale \(pxsig\.config\.json; until 2099-12-31\)/
    );
    assert.match(r.stdout, /setup: enforcement-warn/);
    assert.match(r.stdout, /Enforcement.*doctor warn until 2099-12-31/);
    const c = f.cli(['config']);
    assert.match(c.stdout, /Enforcement/);
    assert.match(c.stdout, /stale\s*\|\s*warn\s*\|\s*project config/);
  }
);
