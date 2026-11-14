// ds-fetch.mjs: the pin, the source and its message, the fetch from a throwaway git repository, the
// stamp that makes a second run a no-op, a changed pin fetching again, and the source never printed.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DsFetchError,
  dsDir,
  dsSource,
  ensureDesignSystem,
  readPin,
  redact,
  stampFile,
} from './ds-fetch.mjs';

const script = fileURLToPath(new URL('./ds-fetch.mjs', import.meta.url));
// No machine's own git settings: no global or system config (a pxsig.dsSource there included).
const ENV = {
  ...process.env,
  PXSIG_DS_SOURCE: '',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

/** @param {import('node:test').TestContext} t @param {string} name */
const tmp = (t, name) => {
  const dir = mkdtempSync(join(tmpdir(), `pxsig-ds-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** @param {string} dir @param {...string} args */
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** A checkout with design-system.json pinning `commit`, as a git repository of its own. */
const checkout = (/** @type {import('node:test').TestContext} */ t, commit = 'a'.repeat(40)) => {
  const dir = tmp(t, 'repo');
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'design-system.json'), JSON.stringify({ commit }));
  return dir;
};

/** A throwaway design-system repository with two commits; returns it and their SHAs. */
const source = (/** @type {import('node:test').TestContext} */ t) => {
  const dir = tmp(t, 'source');
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'README.md'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'one');
  const one = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'README.md'), 'two\n');
  git(dir, 'commit', '-q', '-am', 'two');
  return { dir, one, two: git(dir, 'rev-parse', 'HEAD') };
};

/** @param {string} repo @param {string[]} [args] @param {NodeJS.ProcessEnv} [env] */
const cli = (repo, args = [], env = ENV) =>
  spawnSync(process.execPath, [script, '--repo', repo, ...args], { encoding: 'utf8', env });

test('the pin: 40 lower-case hex, else a message naming the file', (t) => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(readPin(checkout(t, sha)), sha);
  for (const bad of ['main', sha.toUpperCase(), sha.slice(0, 12), ''])
    assert.throws(() => readPin(checkout(t, bad)), /design-system\.json: "commit" must be/);
  assert.throws(() => readPin(tmp(t, 'empty')), /cannot read design-system\.json/);
  assert.equal(cli(checkout(t, sha), ['--pin']).stdout, `${sha}\n`);
  assert.equal(cli(checkout(t, 'main'), ['--pin']).status, 1);
});

test('no source: exit 1, and the message names git config pxsig.dsSource and PXSIG_DS_SOURCE', (t) => {
  const r = cli(checkout(t));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /git config pxsig\.dsSource <git URL or local checkout/);
  assert.match(r.stderr, /PXSIG_DS_SOURCE/);
});

test('the source: PXSIG_DS_SOURCE, else the clone’s git config pxsig.dsSource', (t) => {
  const repo = checkout(t);
  assert.equal(dsSource({ repo, env: ENV }), null);
  git(repo, 'config', 'pxsig.dsSource', 'from-config');
  assert.equal(dsSource({ repo, env: ENV }), 'from-config');
  assert.equal(dsSource({ repo, env: { ...ENV, PXSIG_DS_SOURCE: 'from-env' } }), 'from-env');
});

test('a source that fails is never printed: not a URL with a token, its host, or a folder', (t) => {
  const secret = 'SEKRET-TOKEN-42';
  for (const src of [
    `https://x-access-token:${secret}@${secret.toLowerCase()}.invalid/org/${secret}.git`,
    `git@${secret.toLowerCase()}.invalid:org/${secret}.git`,
    join(tmpdir(), `no-such-${secret}`),
  ]) {
    const r = cli(checkout(t), [], { ...ENV, PXSIG_DS_SOURCE: src });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /git fetch failed/);
    const out = `${r.stdout}${r.stderr}`;
    assert.ok(!out.toLowerCase().includes(secret.toLowerCase()), out);
  }
  assert.equal(
    redact(`fatal: '/srv/checkouts/x' and https://a.b/c`, 'zzz'),
    "fatal: '<path>' and <url>"
  );
});

test('fetch, then a no-op with the same pin, then a fetch again when the pin changes', (t) => {
  const src = source(t);
  const repo = checkout(t, src.one);
  git(repo, 'config', 'pxsig.dsSource', src.dir);
  /** @type {string[]} */
  const installs = [];
  /** @type {string[]} */
  const logs = [];
  const run = () =>
    ensureDesignSystem({
      repo,
      env: ENV,
      install: (dir) => installs.push(dir),
      log: (l) => logs.push(l),
    });

  assert.equal(run(), dsDir(repo));
  assert.equal(git(dsDir(repo), 'rev-parse', 'HEAD'), src.one);
  assert.equal(readFileSync(join(dsDir(repo), 'README.md'), 'utf8'), 'one\n');
  assert.equal(
    git(dsDir(repo), 'status', '--porcelain'),
    '',
    'the stamp lives outside the checkout'
  );
  assert.deepEqual(installs, [dsDir(repo)]);
  assert.deepEqual(JSON.parse(readFileSync(stampFile(repo), 'utf8')), { commit: src.one });

  run();
  assert.equal(installs.length, 1, 'the same pin: nothing fetched or installed');
  assert.match(logs.at(-1) ?? '', /nothing to fetch/);

  writeFileSync(join(repo, 'design-system.json'), JSON.stringify({ commit: src.two }));
  run();
  assert.equal(installs.length, 2);
  assert.equal(git(dsDir(repo), 'rev-parse', 'HEAD'), src.two);
  assert.deepEqual(JSON.parse(readFileSync(stampFile(repo), 'utf8')), { commit: src.two });

  // A checkout moved off the pin by hand is fetched again, whatever the stamp says.
  git(dsDir(repo), 'checkout', '-q', '--detach', 'HEAD~0');
  writeFileSync(join(dsDir(repo), 'README.md'), 'edited\n');
  git(dsDir(repo), 'commit', '-q', '-am', 'local');
  run();
  assert.equal(installs.length, 3);
  assert.equal(git(dsDir(repo), 'rev-parse', 'HEAD'), src.two);

  const said = `${logs.join('\n')}${readFileSync(stampFile(repo), 'utf8')}`;
  assert.ok(!said.includes(src.dir), 'the source is in no log line and not in the stamp');
});

test('an install that fails leaves no stamp, so the next run tries again', (t) => {
  const src = source(t);
  const repo = checkout(t, src.two);
  const env = { ...ENV, PXSIG_DS_SOURCE: src.dir };
  const fail = () => {
    throw new DsFetchError('[ds-fetch] pnpm install in target/design-system failed (exit 1)');
  };
  assert.throws(() => ensureDesignSystem({ repo, env, install: fail, log: () => {} }), /install/);
  assert.throws(() => readFileSync(stampFile(repo)));
  let installed = 0;
  ensureDesignSystem({ repo, env, install: () => installed++, log: () => {} });
  assert.equal(installed, 1);
});
