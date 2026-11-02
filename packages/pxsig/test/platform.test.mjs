/**
 * platform.test.mjs — what differs between macOS, Linux and Windows: paths Windows cannot hold,
 * CRLF checkouts, the store's .gitattributes, and `pxsig serve` giving its lock back when stopped.
 *
 *   node --test packages/pxsig/test/platform.test.mjs
 *
 * The serve test needs the Rust binary; skipped without it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { toPosix } from '../src/lib/paths.mjs';
import {
  caseCollisions,
  crlfFiles,
  MAX_PATH,
  portabilityProblems,
  windowsPathProblem,
} from '../src/lib/portability.mjs';
import { initProject } from '../src/lib/setup.mjs';
import { fixture, hasRust, rustBin, tempDir, testEnv, testHome } from './fixture.mjs';
import { startServer } from './server-proc.mjs';
import { skipUnless } from './strict.mjs';

const tmp = () => tempDir('platform');

test('paths Windows cannot check out are named', () => {
  // In assert.match below, a null (no problem) fails the match on its own: the casts lose nothing.
  for (const ok of [
    '.pxsig/baselines/components/Button/components-button--default.psig',
    'a/b.c/d.psig',
  ])
    assert.equal(windowsPathProblem(ok), null, ok);
  assert.match(
    /** @type {string} */ (windowsPathProblem('.pxsig/baselines/con/x.psig')),
    /reserved/
  );
  assert.match(
    /** @type {string} */ (windowsPathProblem('.pxsig/baselines/x/NUL.psig')),
    /reserved/
  );
  assert.match(
    /** @type {string} */ (windowsPathProblem('.pxsig/baselines/x/com1.psig')),
    /reserved/
  );
  assert.equal(
    windowsPathProblem('.pxsig/baselines/console/x.psig'),
    null,
    'only the exact device names'
  );
  assert.match(
    /** @type {string} */ (windowsPathProblem('.pxsig/baselines/x./a.psig')),
    /dot or a space/
  );
  assert.match(
    /** @type {string} */ (windowsPathProblem('.pxsig/baselines/x /a.psig')),
    /dot or a space/
  );
  assert.match(
    /** @type {string} */ (windowsPathProblem('.pxsig/baselines/a:b/c.psig')),
    /character/
  );
  assert.match(
    /** @type {string} */ (windowsPathProblem(`.pxsig/${'a'.repeat(MAX_PATH)}.psig`)),
    /characters/
  );
});

test('paths that differ only in case are pairs', () => {
  assert.deepEqual(caseCollisions(['a/Button.psig', 'a/button.psig', 'a/Card.psig']), [
    ['a/Button.psig', 'a/button.psig'],
  ]);
  assert.deepEqual(
    caseCollisions(['a/x.psig', 'a/x.psig']),
    [],
    'the same path twice is not a pair'
  );
});

test('CRLF text records and unportable baselines become warnings, never errors', () => {
  const root = tmp();
  writeFileSync(join(root, 'manifest.json'), '{\r\n  "stories": []\r\n}\r\n');
  writeFileSync(join(root, 'approvals.ndjson'), '{"id":"a"}\n');
  assert.deepEqual(
    crlfFiles([
      join(root, 'manifest.json'),
      join(root, 'approvals.ndjson'),
      join(root, 'gone.json'),
    ]),
    [join(root, 'manifest.json')]
  );
  const problems = portabilityProblems({
    repoRoot: root,
    sigPaths: new Set([
      join(root, '.pxsig/baselines/aux/a.psig'),
      join(root, '.pxsig/A.psig'),
      join(root, '.pxsig/a.psig'),
    ]),
    records: [join(root, 'manifest.json')],
  });
  assert.deepEqual(problems.map((p) => p.code).sort(), [
    'line-endings',
    'path-portability',
    'path-portability',
  ]);
  assert.ok(problems.every((p) => p.severity === 'warn'));
  assert.match(
    // Asserted just above: one problem is line-endings.
    /** @type {{ reason: string }} */ (problems.find((p) => p.code === 'line-endings')).reason,
    /^manifest\.json checked out with CRLF/
  );
  assert.deepEqual(
    portabilityProblems({
      repoRoot: root,
      sigPaths: new Set(),
      records: [join(root, 'approvals.ndjson')],
    }),
    []
  );
});

test(
  'git not treating .psig as binary is a line-endings warning',
  { skip: skipUnless(spawnSync('git', ['--version']).status === 0, 'no git') },
  () => {
    const root = tmp();
    spawnSync('git', ['init', '-q', root]);
    const sig = new Set([join(root, '.pxsig/baselines/a.psig')]);
    assert.match(
      portabilityProblems({ repoRoot: root, sigPaths: sig, records: [] })[0]?.reason ?? '',
      /not treat \.psig files as binary/
    );
    writeFileSync(join(root, '.gitattributes'), '*.psig binary\n');
    assert.deepEqual(portabilityProblems({ repoRoot: root, sigPaths: sig, records: [] }), []);
  }
);

test('one path helper: toPosix gives / on every OS', () => {
  assert.equal(toPosix(join('a', 'b', 'c.psig')), 'a/b/c.psig');
});

test('a new store keeps its records LF and its baselines binary', () => {
  const dir = tmp();
  initProject({ dir });
  const ga = readFileSync(join(dir, '.pxsig', '.gitattributes'), 'utf8');
  for (const line of ['*.psig binary diff=psig', '*.json text eol=lf', '*.ndjson text eol=lf'])
    assert.ok(ga.split('\n').includes(line), line);
});

/** @param {string} repo */
const startServe = (repo) =>
  startServer({
    cwd: repo,
    env: { ...testEnv(testHome), PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' },
  });

test(
  'stopping pxsig serve gives the store lock back',
  { skip: skipUnless(hasRust, 'Rust binary not built') },
  async () => {
    const f = fixture();
    const lock = join(f.px, 'reports', '.lock');
    const s = await startServe(f.repo);
    assert.ok(existsSync(lock), 'serve holds the lock while it runs');
    if (process.platform === 'win32') {
      // Windows cannot send a console Ctrl+C to a child from Node: kill() terminates it, as a forced
      // stop does. The lock it leaves names a pid that is gone, so the next serve takes it over.
      s.proc.kill();
      await s.exited;
      const again = await startServe(f.repo);
      assert.match(again.log(), /dashboard →/);
      again.proc.kill();
      await again.exited;
    } else {
      s.proc.kill('SIGINT');
      const { code } = await s.exited;
      assert.equal(code, 0, s.log());
      assert.ok(!existsSync(lock), `the lock is released on Ctrl+C:\n${s.log()}`);
    }
  }
);
