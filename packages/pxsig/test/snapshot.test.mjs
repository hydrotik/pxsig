// `pxsig snapshot` (the deployed Storybook's read-only summary): every committed entry with its
// last log line, PR and commit; history by batch; shallow clones show no PR rather than a wrong
// one; uncommitted lines say so; nothing names a person or says how an approval was made.
// Fixture projects in real git repositories.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { record } from '../src/lib/approvals.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { buildSnapshot, envSummary, SNAPSHOT_FORMAT } from '../src/snapshot.mjs';
import { fixture, hasRust, rustBin } from './fixture.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
// A person's name and email on every commit: the snapshot may contain neither.
const AUTHOR = {
  GIT_AUTHOR_NAME: 'Secret Person',
  GIT_AUTHOR_EMAIL: 'secret@example.com',
  GIT_COMMITTER_NAME: 'Secret Person',
  GIT_COMMITTER_EMAIL: 'secret@example.com',
};
const must = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...AUTHOR } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return (r.stdout ?? '').trim();
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
// Every folder a test makes, removed when the file's tests end.
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
const open = (repo) => openProject({ cwd: repo, env: { PXSIG_BIN: rustBin } });
const skip = { skip: !hasRust && 'Rust binary not built' };

/** The fixture as a git repository on `main`, every entry logged as a first baseline. */
function repoFixture() {
  const f = fixture({ withSigs: true });
  made.push(f.repo);
  rmSync(join(f.repo, '.git'), { recursive: true, force: true });
  must(f.repo, 'init', '-q', '-b', 'main');
  must(f.repo, 'config', 'commit.gpgsign', 'false');
  must(f.repo, 'config', 'core.autocrlf', 'false');
  const P = open(f.repo);
  for (const e of f.manifest.stories)
    record(P, e, { batch: 'b0-cli', via: 'cli', reason: 'first baselines', before: null });
  must(f.repo, 'add', '-A');
  must(f.repo, 'commit', '-q', '-m', 'base');
  return { ...f, P };
}
const entryOf = (snap, id) =>
  Object.values(snap.projects)
    .flatMap((p) => Object.values(p.stories))
    .flatMap((s) => s.entries)
    .find((e) => e.id === id);

test('every manifest entry, with its baseline, last log line and commit', skip, () => {
  const f = repoFixture();
  const snap = buildSnapshot([f.P]);
  assert.equal(snap.format, SNAPSHOT_FORMAT);
  assert.equal(snap.version, 1);
  assert.equal(snap.commit, must(f.repo, 'rev-parse', '--short=12', 'HEAD'));
  assert.equal(snap.shallow, false);
  assert.equal(snap.uncommitted, false);
  const stories = snap.projects[f.P.name].stories;
  for (const e of f.manifest.stories) assert.ok(entryOf(snap, e.id), e.id);
  const ok = entryOf(snap, f.ids.ok);
  assert.equal(ok.baseline, true);
  assert.equal(ok.approved.event, 'first baseline');
  assert.equal(ok.approved.reason, 'first baselines');
  assert.equal(ok.approved.commit, snap.commit, 'committed on main directly: its own commit');
  assert.equal(ok.approved.pr, null, 'no merge, no PR subject: no PR');
  // History: one row per batch per story, counting the story's entries in it.
  const story = stories[f.manifest.stories.find((e) => e.id === f.ids.ok).story];
  assert.equal(story.history.length, 1);
  assert.equal(story.history[0].entries, story.entries.length);
});

test('no person, no route: no `by`, no `via`, no author name or email', skip, () => {
  const f = repoFixture();
  // A line from a team on `approvals.identity: "git-email"`, as pxsig wrote before 0.4.0.
  appendFileSync(
    f.P.store.approvals,
    `${JSON.stringify({ at: new Date().toISOString(), id: f.ids.ok, by: 'secret@example.com', via: 'dashboard', batch: 'b1-dashboard', reason: null, kind: 'colour', gitHead: 'abc', before: 'x', after: 'y' })}\n`
  );
  must(f.repo, 'commit', '-qam', 'approve');
  const text = JSON.stringify(buildSnapshot([open(f.repo)]));
  assert.ok(!/"by":/.test(text), 'no by');
  assert.ok(!/"via":/.test(text), 'no via');
  assert.ok(!text.includes('secret@example.com'), 'no email');
  assert.ok(!text.includes('Secret Person'), 'no name');
  assert.ok(!text.includes(f.repo), 'no absolute path');
  const ok = entryOf(JSON.parse(text), f.ids.ok);
  assert.equal(ok.approved.event, 'approved');
  assert.equal(ok.approved.kind, 'colour');
});

test('the PR that merged an approval, from the merge subject', skip, () => {
  const f = repoFixture();
  must(f.repo, 'switch', '-q', '-c', 'feat/x');
  record(
    f.P,
    f.manifest.stories.find((e) => e.id === f.ids.changed),
    {
      batch: 'b1-cli',
      via: 'cli',
      reason: 'new border colour',
      kind: 'colour',
      before: 'x',
    }
  );
  must(f.repo, 'commit', '-qam', 'approve the border');
  must(f.repo, 'switch', '-q', 'main');
  must(f.repo, 'merge', '-q', '--no-ff', 'feat/x', '-m', 'Merge pull request #12 from org/feat-x');
  const e = entryOf(buildSnapshot([open(f.repo)]), f.ids.changed);
  assert.equal(e.approved.pr, 12);
  assert.equal(e.approved.reason, 'new border colour');
  assert.equal(e.approved.kind, 'colour');
});

test('a shallow clone shows no PR and no commit, never a wrong one', skip, () => {
  const f = repoFixture();
  must(f.repo, 'commit', '-q', '--allow-empty', '-m', 'Merge pull request #99 from org/other');
  const dir = tmp('pxsig-shallow-');
  must(dir, 'clone', '-q', '--depth', '1', `file://${f.repo}`, 'repo');
  const snap = buildSnapshot([open(join(dir, 'repo'))]);
  assert.equal(snap.shallow, true);
  const ok = entryOf(snap, f.ids.ok);
  assert.equal(ok.approved.pr, null);
  assert.equal(ok.approved.commit, null);
  assert.equal(ok.approved.event, 'first baseline', 'the log itself is still read');
});

test('uncommitted log lines: no commit, and the snapshot says the store has changes', skip, () => {
  const f = repoFixture();
  record(
    f.P,
    f.manifest.stories.find((e) => e.id === f.ids.drift),
    {
      batch: 'b2-cli',
      via: 'cli',
      reason: 'not yet committed',
      before: 'x',
    }
  );
  const snap = buildSnapshot([open(f.repo)]);
  assert.equal(snap.uncommitted, true);
  assert.equal(entryOf(snap, f.ids.drift).approved.commit, null);
  assert.equal(entryOf(snap, f.ids.drift).approved.pr, null);
});

test(
  "a migration's reason (the old file path) is left out; accepted a11y rules are read",
  skip,
  () => {
    const f = repoFixture();
    appendFileSync(
      f.P.store.approvals,
      `${JSON.stringify({ at: new Date().toISOString(), id: f.ids.a11y, via: 'migrate', batch: 'b3-migrate', reason: 'moved from packages/x/.baselines/a.json', before: null })}\n`
    );
    writeFileSync(
      f.P.store.a11y,
      JSON.stringify({ [f.ids.a11y]: ['region', { id: 'color-contrast' }, 'region'] })
    );
    const e = entryOf(buildSnapshot([open(f.repo)]), f.ids.a11y);
    assert.equal(e.approved.event, 'migrated');
    assert.equal(e.approved.reason, null);
    assert.deepEqual(e.a11y, ['color-contrast', 'region']);
  }
);

test('the environment, reduced to browser, OS and image', () => {
  assert.equal(envSummary(null), null);
  assert.deepEqual(
    envSummary({
      browser: { name: 'chromium', version: '141.0.7390.37' },
      os: { platform: 'linux', arch: 'x64', release: '6.1' },
      container: { image: 'ghcr.io/hydrotik/pxsig:0.5.1-pw1.58.2' },
      fonts: { probe: { serif: 'x' } },
    }),
    { browser: 'chromium 141', os: 'linux x64', container: 'pxsig:0.5.1-pw1.58.2' }
  );
});

test(
  'pxsig snapshot --out writes the file; --json reports it; an unknown project is exit 2',
  skip,
  () => {
    const f = repoFixture();
    const out = join(tmp('pxsig-snap-'), 'site', 'pxsig-snapshot.json');
    let r = cli(f.repo, ['snapshot', '--out', out, '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.out, out);
    assert.equal(j.entries, f.manifest.stories.length);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).format, SNAPSHOT_FORMAT);
    r = cli(f.repo, ['snapshot']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).format, SNAPSHOT_FORMAT, 'no --out: the snapshot on stdout');
    r = cli(f.repo, ['snapshot', '--project', 'nope']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no project nope/);
  }
);
