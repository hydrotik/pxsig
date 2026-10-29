// Warn mode (P13, PHASE-1 §10, 10a core), end to end: the gated commands on fixture projects in git
// repositories (approve verify, --warn, no enforcement key, doctor and stale).
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readinessPath } from '../src/lib/enforcement.mjs';
import { record } from '../src/lib/approvals.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { src } from './enforcement-helpers.mjs';

/** @import { ManifestEntry } from '../src/types.js' */

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
