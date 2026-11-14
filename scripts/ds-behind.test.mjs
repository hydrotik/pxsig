// lib/ds-behind.mjs and ds-fetch's report: how far the pin is behind a throwaway design-system
// repository's default branch, which of the adapter's files changed, the warning past the
// thresholds, and the source never printed.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { dsDir, ensureDesignSystem, reportBehind } from './ds-fetch.mjs';
import {
  MAX_BEHIND_COMMITS,
  MAX_BEHIND_DAYS,
  behind,
  describe,
  usedPaths,
} from './lib/ds-behind.mjs';

const DAY = 86400;
const T0 = 1_800_000_000;
const ENV = {
  ...process.env,
  PXSIG_DS_SOURCE: '',
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
  const dir = mkdtempSync(join(tmpdir(), `pxsig-behind-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** @param {string} dir @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const git = (dir, args, env = ENV) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** @param {string} root @param {Record<string, string>} files */
const write = (root, files) => {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
};

/**
 * A commit of `files` at `when` (seconds).
 * @param {string} dir @param {Record<string, string>} files @param {number} when
 */
const commit = (dir, files, when) => {
  write(dir, files);
  git(dir, ['add', '.']);
  const date = `@${when} +0000`;
  git(dir, ['commit', '-q', '-m', 'x'], {
    ...ENV,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  return git(dir, ['rev-parse', 'HEAD']);
};

/** A design-system monorepo in miniature. */
const LAYOUT = {
  'packages/ds/package.json': JSON.stringify({ name: '@hydrotik/design-system' }),
  'packages/ds/src/index.ts':
    "export {\n  Badge,\n  BadgeDot,\n} from './components/Badge';\nexport * from './components/Card';\n",
  'packages/ds/src/components/Badge/index.ts':
    'export const Badge = 1; export const BadgeDot = 2;\n',
  'packages/ds/src/components/Card/index.ts': 'export const Card = 1;\n',
  'packages/ds/src/components/Other/index.ts': 'export const Other = 1;\n',
  'packages/ds/src/internal/ring.ts': 'export const ring = 1;\n',
  'packages/tokens/package.json': JSON.stringify({ name: '@hydrotik/tokens' }),
  'packages/tokens/src/index.ts': 'export const vars = {};\n',
  'apps/site/README.md': 'site\n',
};
const IMPORTS = new Map([
  [
    '@hydrotik/design-system',
    new Map([
      ['Badge', new Set()],
      ['Card', new Set()],
      ['Gone', new Set()],
    ]),
  ],
  ['@hydrotik/tokens', new Map([['vars', new Set()]])],
]);

/** The source with the pin, a checkout fetched at it; returns both and the pin. */
const setup = (/** @type {import('node:test').TestContext} */ t) => {
  const source = tmp(t, 'source');
  git(source, ['init', '-q']);
  const pin = commit(source, LAYOUT, T0);
  const repo = tmp(t, 'repo');
  git(repo, ['init', '-q']);
  writeFileSync(join(repo, 'design-system.json'), JSON.stringify({ commit: pin }));
  ensureDesignSystem({
    repo,
    env: { ...ENV, PXSIG_DS_SOURCE: source },
    install: () => {},
    log: () => {},
  });
  return { source, repo, pin };
};

test('the files the adapter uses: named and star exports followed to their folders', (t) => {
  const root = tmp(t, 'layout');
  write(root, LAYOUT);
  const { paths, unresolved } = usedPaths(root, IMPORTS);
  assert.deepEqual(paths, [
    'packages/ds/package.json',
    'packages/ds/src/components/Badge/',
    'packages/ds/src/components/Card/',
    'packages/ds/src/index.ts',
    'packages/ds/src/internal/',
    'packages/tokens/',
  ]);
  assert.deepEqual(unresolved, ['@hydrotik/design-system:Gone']);
});

test('behind: commits and days since the pin, and the adapter files that changed', (t) => {
  const { source, repo, pin } = setup(t);
  const dir = dsDir(repo);
  assert.deepEqual(behind({ dir, source, commit: pin, imports: IMPORTS }), {
    commits: 0,
    days: 0,
    changed: [],
    unresolved: ['@hydrotik/design-system:Gone'],
  });
  commit(
    source,
    { 'apps/site/README.md': 'site 2\n', 'packages/ds/src/components/Other/index.ts': '//\n' },
    T0 + DAY
  );
  let b = behind({ dir, source, commit: pin, imports: IMPORTS });
  assert.equal(b.commits, 1);
  assert.equal(b.days, 1);
  assert.deepEqual(b.changed, [], 'nothing the adapter uses');
  assert.match(describe(b).text, /none of the files the reference adapter uses changed/);
  assert.equal(describe(b).level, 'notice');
  commit(
    source,
    { 'packages/ds/src/components/Badge/index.ts': 'export const Badge = 3;\n' },
    T0 + 3 * DAY
  );
  b = behind({ dir, source, commit: pin, imports: IMPORTS });
  assert.equal(b.commits, 2);
  assert.equal(b.days, 3);
  assert.deepEqual(b.changed, ['packages/ds/src/components/Badge/index.ts']);
  assert.match(
    describe(b).text,
    /changed since the pin \(1\): packages\/ds\/src\/components\/Badge\//
  );
  assert.equal(git(dir, ['rev-parse', 'HEAD']), pin, 'the checkout stays at the pin');
  assert.equal(git(dir, ['status', '--porcelain']), '');
});

test('describe: a warning past either threshold, a notice within them', () => {
  const b = { commits: MAX_BEHIND_COMMITS, days: MAX_BEHIND_DAYS, changed: [], unresolved: [] };
  assert.equal(describe(b).level, 'notice');
  assert.equal(describe({ ...b, commits: MAX_BEHIND_COMMITS + 1 }).level, 'warning');
  assert.equal(describe({ ...b, days: MAX_BEHIND_DAYS + 1 }).level, 'warning');
  assert.match(
    describe({ ...b, days: MAX_BEHIND_DAYS + 1 }).text,
    /more than 20 commits or 14 days/
  );
});

test('the report: ::warning:: in GitHub Actions, never failing, never naming the source', (t) => {
  const { source, repo } = setup(t);
  for (let i = 1; i <= MAX_BEHIND_COMMITS + 1; i++)
    commit(
      source,
      { 'packages/ds/src/components/Card/index.ts': `export const Card = ${i + 100};\n` },
      T0 + i * 60
    );
  /** @type {string[]} */
  const lines = [];
  const env = { ...ENV, PXSIG_DS_SOURCE: source, GITHUB_ACTIONS: 'true' };
  const b = reportBehind({ repo, env, log: (l) => lines.push(l) });
  assert.equal(b?.commits, MAX_BEHIND_COMMITS + 1);
  assert.match(lines[0], /^::warning::the design-system pin is 21 commits and 0 days behind/);
  assert.match(lines[0], /packages\/ds\/src\/components\/Card\//);

  const gone = join(tmpdir(), 'no-such-SEKRET-source');
  lines.length = 0;
  assert.equal(
    reportBehind({ repo, env: { ...env, PXSIG_DS_SOURCE: gone }, log: (l) => lines.push(l) }),
    null
  );
  assert.match(lines[0], /how far the pin is behind: not checked/);
  assert.ok(
    !lines.join('\n').includes('SEKRET') && !lines.join('\n').includes(source),
    lines.join('\n')
  );

  lines.length = 0;
  reportBehind({ repo, env: ENV, log: (l) => lines.push(l) });
  assert.deepEqual(lines, ['[ds-fetch] how far the pin is behind: not checked (no source)']);
});
