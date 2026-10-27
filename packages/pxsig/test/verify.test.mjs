// The approval trail in CI (P7): strict `approve verify` by default, `--since` (the log only
// appended to), suites, the PR summary line by route, `approve log --trace` (commit and PR, no
// names), and store files a merge left conflicted. Fixture projects in real git repositories.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendedSince,
  changedByRoute,
  conflictedStoreFiles,
  mergeBase,
  record,
} from '../src/lib/approvals.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
// A person's name and email on every commit: nothing pxsig prints may contain them.
const AUTHOR = {
  GIT_AUTHOR_NAME: 'Secret Person',
  GIT_AUTHOR_EMAIL: 'secret@example.com',
  GIT_COMMITTER_NAME: 'Secret Person',
  GIT_COMMITTER_EMAIL: 'secret@example.com',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...AUTHOR } });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: r.stderr };
};
const must = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.err}`);
  return r.out;
};
const cli = (repo, args) =>
  spawnSync(process.execPath, [join(src, 'cli.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PXSIG_FORMAT: '',
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
      PXSIG_WORKSPACE: '',
      PXSIG_PROJECT: '',
      CI: '',
    },
  });

/** The fixture as a git repository on `main`, with every baseline logged unless `log` is false. */
function repoFixture({ log = true } = {}) {
  const f = fixture({ withSigs: true });
  rmSync(join(f.repo, '.git'), { recursive: true, force: true });
  must(f.repo, 'init', '-q', '-b', 'main');
  must(f.repo, 'config', 'commit.gpgsign', 'false');
  must(f.repo, 'config', 'core.autocrlf', 'false');
  const P = openProject({ cwd: f.repo, env: { PXSIG_BIN: rustBin } });
  if (log)
    for (const e of f.manifest.stories)
      record(P, e, { batch: 'b0-cli', via: 'cli', reason: 'first baselines', before: null });
  must(f.repo, 'add', '-A');
  must(f.repo, 'commit', '-q', '-m', 'base');
  return { ...f, P };
}

test(
  'approve verify is strict by default: a baseline with no log line fails, --no-strict reports it',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture({ log: false });
    let r = cli(f.repo, ['approve', 'verify']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /baselines have no approval log line/);
    assert.match(r.stdout, /approve verify --adopt/, 'the failure prints the exact command');
    assert.match(r.stdout, new RegExp(f.ids.ok), 'and names the entries');
    const j = JSON.parse(cli(f.repo, ['approve', 'verify', '--json']).stdout);
    assert.equal(j.strict, true);
    assert.ok(
      !j.untrackedSample.includes(f.ids.unbaselined),
      'an entry with no baseline yet has nothing to verify'
    );
    r = cli(f.repo, ['approve', 'verify', '--no-strict']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /not a failure with --no-strict/);
    // doctor warns before the gate bites
    const d = JSON.parse(cli(f.repo, ['doctor', '--json', '--offline']).stdout);
    const setup = (d.projects?.[0] ?? d).setup ?? [];
    assert.ok(
      setup.some((x) => x.code === 'verify-unlogged' && x.severity === 'warn'),
      JSON.stringify(setup)
    );
  }
);

test(
  'approve verify --since: the log may only be appended to',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture();
    must(f.repo, 'checkout', '-q', '-b', 'pr');
    const e = f.manifest.stories.find((x) => x.id === f.ids.ok);
    record(f.P, e, { batch: 'b1-dashboard', via: 'dashboard', reason: 'a new look', before: null });
    must(f.repo, 'commit', '-q', '-am', 'approve');
    let r = cli(f.repo, ['approve', 'verify', '--since', 'main', '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(
      [JSON.parse(r.stdout).range.rewritten, JSON.parse(r.stdout).range.appended],
      [false, 1]
    );
    // A rewritten log (a line removed) fails, committed or not.
    const log = f.P.store.approvals;
    writeFileSync(log, readFileSync(log, 'utf8').split('\n').slice(1).join('\n'));
    r = cli(f.repo, ['approve', 'verify', '--since', 'main', '--no-strict']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /rewritten since main, not appended to/);
    r = cli(f.repo, ['approve', 'verify', '--since', 'no-such-ref']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /not a commit here/);
  }
);

test(
  'approve verify --suite and --all-suites; a suite not in the checkout is listed, not failed',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture();
    const cfg = JSON.parse(readFileSync(join(f.repo, 'pxsig.config.json'), 'utf8'));
    writeFileSync(
      join(f.repo, 'pxsig.config.json'),
      JSON.stringify({ ...cfg, suites: { matrix: { modes: ['dark'] } } })
    );
    let r = cli(f.repo, ['approve', 'verify', '--all-suites', '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).notCommitted, ['matrix']);
    r = cli(f.repo, ['approve', 'verify', '--suite', 'nope']);
    assert.equal(r.status, 2);
    assert.match(r.stderr + r.stdout, /unknown suite "nope"/);
    r = cli(f.repo, ['approve', 'verify', '--suite', 'matrix']);
    assert.equal(r.status, 2, 'only a missing suite: nothing to verify');
  }
);

test(
  'the PR summary counts changed baselines by how they were approved, and names markers, not people',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const c = changedByRoute([
      { id: 'a', via: 'dashboard' },
      { id: 'b', via: 'cli', by: 'someone@example.com' },
      { id: 'a', via: 'mcp', agent: 'copilot' },
      { id: 'c', via: 'undo', reason: 'undo b0 (dashboard)' },
      { id: 'd', via: 'check-update' },
    ]);
    assert.deepEqual(c, {
      total: 4,
      dashboard: 1,
      terminal: 2,
      mcp: 1,
      other: 0,
      agents: { copilot: 1 },
    });
    const dir = mkdtempSync(join(tmpdir(), 'pxsig-summary-'));
    const md = (approvals) => {
      writeFileSync(
        join(dir, 'check.json'),
        JSON.stringify({
          summary: { totalMs: 1, ...(approvals ? { approvals } : {}) },
          rows: [{ id: 'a', pass: true, metrics: {} }],
        })
      );
      const r = spawnSync(
        rustBin,
        ['report', '--input', join(dir, 'check.json'), '--format', 'markdown'],
        { encoding: 'utf8' }
      );
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    assert.match(
      md(c),
      /Baselines changed in this PR: 4 \(1 approved in the dashboard, 2 in the terminal, 1 via MCP\); 1 with an assistant marker: copilot\./
    );
    assert.match(
      md({ total: 2, dashboard: 2, terminal: 0, mcp: 0, other: 0, agents: {} }),
      /Baselines changed in this PR: 2 \(2 approved in the dashboard, 0 in the terminal, 0 via MCP\)\.\n/
    );
    assert.match(md({ rewritten: true }), /the approval log was rewritten/);
    assert.doesNotMatch(md(null), /Baselines changed/);
    // From git: the lines a branch appended since its merge base.
    const f = repoFixture();
    must(f.repo, 'checkout', '-q', '-b', 'pr');
    record(f.P, f.manifest.stories[0], {
      batch: 'b2-dashboard',
      via: 'dashboard',
      reason: 'x',
      before: null,
    });
    const mb = mergeBase(f.P.store.root, 'main');
    assert.ok(mb.base);
    assert.deepEqual(changedByRoute(appendedSince(f.P, mb.base).lines), {
      total: 1,
      dashboard: 1,
      terminal: 0,
      mcp: 0,
      other: 0,
      agents: {},
    });
  }
);

test(
  'approve log --trace points at the commit and the pull request, and shows no names',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture();
    must(f.repo, 'checkout', '-q', '-b', 'feature');
    record(f.P, f.manifest.stories[0], {
      batch: 'b3-dashboard',
      via: 'dashboard',
      reason: 'merged by a PR',
      before: null,
    });
    must(f.repo, 'commit', '-q', '-am', 'approve the new look');
    must(f.repo, 'checkout', '-q', 'main');
    must(
      f.repo,
      'merge',
      '-q',
      '--no-ff',
      'feature',
      '-m',
      'Merge pull request #12 from acme/feature'
    );
    record(f.P, f.manifest.stories[1], {
      batch: 'b4-cli',
      via: 'cli',
      reason: 'not yet committed',
      before: null,
    });
    const r = cli(f.repo, ['approve', 'log', '--trace', '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rows = new Map(JSON.parse(r.stdout).map((b) => [b.batch, b]));
    assert.equal(rows.get('b3-dashboard').pr, '#12');
    assert.match(rows.get('b3-dashboard').commit, /^[0-9a-f]{12}$/);
    assert.equal(rows.get('b4-cli').commit, 'not committed');
    assert.equal(rows.get('b0-cli').pr, '', 'committed straight to main: no PR');
    const text = cli(f.repo, ['approve', 'log', '--trace']).stdout + r.stdout;
    for (const secret of ['Secret Person', 'secret@example.com', homedir()])
      assert.ok(!text.includes(secret), `--trace printed ${secret}`);
    assert.ok(!('by' in rows.get('b3-dashboard')));
  }
);

test(
  'a store file a merge left conflicted stops check and is a doctor setup error',
  { skip: !hasRust && 'Rust binary not built' },
  () => {
    const f = repoFixture();
    const e = f.manifest.stories.find((x) => x.id === f.ids.ok);
    const sig = join(f.repo, e.sig);
    must(f.repo, 'checkout', '-q', '-b', 'other');
    appendFileSync(sig, Buffer.from([1, 2, 3]));
    must(f.repo, 'commit', '-q', '-am', 'other baseline');
    must(f.repo, 'checkout', '-q', 'main');
    appendFileSync(sig, Buffer.from([4, 5, 6]));
    must(f.repo, 'commit', '-q', '-am', 'main baseline');
    assert.equal(git(f.repo, 'merge', '-q', 'other').ok, false, 'the merge conflicts');
    assert.deepEqual(conflictedStoreFiles(f.P), [e.sig]);
    const r = spawnSync(process.execPath, [join(src, 'check.mjs'), '--full'], {
      cwd: f.repo,
      encoding: 'utf8',
      env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_URL: 'http://127.0.0.1:1' },
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /store files are conflicted/);
    assert.match(r.stderr, /Rebasing with baselines/);
    const d = JSON.parse(cli(f.repo, ['doctor', '--json', '--offline']).stdout);
    assert.ok(
      ((d.projects?.[0] ?? d).setup ?? []).some(
        (x) => x.code === 'store-conflict' && x.severity === 'error'
      )
    );
  }
);
