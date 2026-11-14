// The design-system source never stays on disk: after a fetch, a failed fetch and the pin-age
// check, no file in the checkout (.git included) holds it, and the checkout has no remote.
// PXSIG_DS_DIR puts the checkout outside the repository (CI: the runner's temp folder).
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dsDir, ensureDesignSystem, reportBehind, stampFile } from './ds-fetch.mjs';

const MARKER = 'PXSIGMARKER7Q3Z';
const ENV = {
  ...process.env,
  PXSIG_DS_SOURCE: '',
  PXSIG_DS_DIR: '',
  GITHUB_ACTIONS: '',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

/** @param {import('node:test').TestContext} t @param {string} name */
const tmp = (t, name) => {
  const dir = mkdtempSync(join(tmpdir(), `pxsig-scrub-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** @param {string} dir @param {...string} args */
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** Every file under `dir` whose bytes contain `text`. @param {string} dir @param {string} text */
function filesWith(dir, text) {
  /** @type {string[]} */
  const hits = [];
  if (!existsSync(dir)) return hits;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = join(e.parentPath, e.name);
    if (readFileSync(f).includes(text)) hits.push(f);
  }
  return hits;
}

/** A source repository whose path holds the marker, two commits; a checkout pinned to the first. */
const setup = (/** @type {import('node:test').TestContext} */ t) => {
  const source = join(tmp(t, 'src'), `ds-${MARKER}`);
  spawnSync('git', ['init', '-q', source], { env: ENV });
  writeFileSync(join(source, 'README.md'), 'one\n');
  git(source, 'add', '.');
  git(source, 'commit', '-q', '-m', 'one');
  const pin = git(source, 'rev-parse', 'HEAD');
  writeFileSync(join(source, 'README.md'), 'two\n');
  git(source, 'commit', '-q', '-am', 'two');
  const repo = tmp(t, 'repo');
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'design-system.json'), JSON.stringify({ commit: pin }));
  return { source, repo, pin };
};

test('a fetch and the pin-age check leave the source in no file, and no remote', (t) => {
  const { source, repo, pin } = setup(t);
  const env = { ...ENV, PXSIG_DS_SOURCE: source };
  ensureDesignSystem({ repo, env, install: () => {}, log: () => {} });
  const dir = dsDir(repo, env);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), pin);
  assert.deepEqual(filesWith(join(repo, 'target'), MARKER), []);
  assert.equal(spawnSync('git', ['-C', dir, 'remote'], { encoding: 'utf8' }).stdout, '');

  const b = reportBehind({ repo, env, log: () => {} });
  assert.equal(b?.commits, 1);
  assert.deepEqual(filesWith(join(repo, 'target'), MARKER), [], 'the upstream fetch leaves none');
});

test('a failed fetch leaves the source in no file either', (t) => {
  const { source, repo } = setup(t);
  // Pinned to a commit the source does not have.
  writeFileSync(join(repo, 'design-system.json'), JSON.stringify({ commit: 'f'.repeat(40) }));
  const env = { ...ENV, PXSIG_DS_SOURCE: source };
  assert.throws(
    () => ensureDesignSystem({ repo, env, install: () => {}, log: () => {} }),
    /git fetch failed/
  );
  assert.deepEqual(filesWith(join(repo, 'target'), MARKER), []);
  assert.ok(!existsSync(stampFile(repo, env)));
});

test('PXSIG_DS_DIR: the checkout and its stamp go there, and the build finds it there', (t) => {
  const { source, repo, pin } = setup(t);
  const out = join(tmp(t, 'out'), 'design-system');
  const env = { ...ENV, PXSIG_DS_SOURCE: source, PXSIG_DS_DIR: out };
  assert.equal(ensureDesignSystem({ repo, env, install: () => {}, log: () => {} }), out);
  assert.equal(git(out, 'rev-parse', 'HEAD'), pin);
  assert.ok(existsSync(`${out}.stamp.json`));
  assert.ok(!existsSync(join(repo, 'target')), 'nothing in the repository');
  assert.deepEqual(filesWith(out, MARKER), []);
  /** @type {string[]} */
  const logs = [];
  ensureDesignSystem({
    repo,
    env,
    install: () => assert.fail('no install'),
    log: (l) => logs.push(l),
  });
  assert.match(logs[0], /nothing to fetch/);
});
