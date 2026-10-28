// check-file-size.mjs against a temporary git repository made here (`git init`: no hooks).
// This file and the script are the same in pxsig and hydrotik.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-file-size.mjs', import.meta.url));

// The script's sha256, recorded in both repositories' copy of this test. A change to the script
// changes this constant; make the same change, script and constant, in the other repository.
const SCRIPT_SHA256 = '2797ed70984f4426123a3146f3ce74bb3aeb20eba82014a88f360a8f7ca19a28';

/** @param {number} tokens */
const bytes = (tokens) => 'x'.repeat(tokens * 4);

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'file-size-'));
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'core.autocrlf', 'false']);
  /** @param {string} rel @param {string} content */
  const write = (rel, content) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  /** @param {Record<string, number>} files @param {Record<string, string>} [exempt] */
  const baseline = (files, exempt = {}) =>
    write(
      'scripts/file-size-baseline.json',
      JSON.stringify({ limit: 5000, exempt, files }, null, 2)
    );
  const readBaseline = () =>
    JSON.parse(readFileSync(join(dir, 'scripts/file-size-baseline.json'), 'utf8'));
  /** @param {string} rel @param {string} content */
  const stage = (rel, content) => {
    write(rel, content);
    git(['add', rel]);
  };
  const commit = () => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'seed']);
  };
  /** @param {...string} args */
  const run = (...args) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  /** @param {...string} args */
  const runJson = (...args) => {
    const r = spawnSync(process.execPath, [script, ...args, '--json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    return { status: r.status, result: JSON.parse(r.stdout) };
  };
  const done = () => rmSync(dir, { recursive: true, force: true });
  return { dir, git, write, baseline, readBaseline, stage, commit, run, runJson, done };
}

test('the script is the copy recorded in both repositories', () => {
  // LF line endings, as committed, whatever the checkout's.
  const text = readFileSync(script, 'utf8').replace(/\r\n/g, '\n');
  const sha = createHash('sha256').update(text).digest('hex');
  assert.equal(sha, SCRIPT_SHA256);
});

test('a new file at the limit passes; one over it fails with the agreed message', () => {
  const r = repo();
  r.baseline({});
  r.stage('src/ok.mjs', bytes(5000));
  assert.equal(r.run('--staged').status, 0);
  r.stage('src/thing.mjs', `${bytes(5411)}x`);
  const { status, out } = r.run('--staged');
  assert.equal(status, 1);
  assert.match(
    out,
    /\[file-size\] ✗ src\/thing\.mjs: 5,412 tokens; a file not in the baseline may have at most 5,000\./
  );
  assert.match(out, /Tokens = bytes \/ 4 of the staged file\./);
  assert.match(
    out,
    /6\. Lower the baseline in its own commit: node scripts\/check-file-size\.mjs --update/
  );
  assert.doesNotMatch(out, /no-verify/);
  r.done();
});

test('a recorded file may not grow; at its size it passes, smaller it passes with a note', () => {
  const r = repo();
  r.baseline({ 'src/cli.mjs': 6000 });
  r.write('src/cli.mjs', bytes(6000));
  r.commit();
  r.stage('src/cli.mjs', bytes(6001));
  const grew = r.run('--staged');
  assert.equal(grew.status, 1);
  assert.match(
    grew.out,
    /✗ src\/cli\.mjs: 6,001 tokens; its recorded size is 6,000\. A file over 5,000 tokens may not grow\./
  );
  r.stage('src/cli.mjs', bytes(6000));
  assert.equal(r.run('--staged').status, 0);
  r.stage('src/cli.mjs', bytes(5900));
  const shrunk = r.run('--staged');
  assert.equal(shrunk.status, 0);
  assert.match(shrunk.out, /note: src\/cli\.mjs is 5,900 tokens, recorded 6,000/);
  r.done();
});

test('a renamed file keeps the old path’s recorded size; a deletion is ignored', () => {
  const r = repo();
  r.baseline({ 'src/a.mjs': 6000, 'src/b.mjs': 7000 });
  r.write('src/a.mjs', bytes(6000));
  r.write('src/b.mjs', bytes(7000));
  r.commit();
  r.git(['mv', 'src/a.mjs', 'src/moved.mjs']);
  r.git(['rm', '-q', 'src/b.mjs']);
  const moved = r.runJson('--staged');
  assert.equal(moved.status, 0);
  assert.deepEqual(moved.result.failures, []);
  assert.match(moved.result.notes.join('\n'), /src\/a\.mjs → src\/moved\.mjs/);
  r.stage('src/moved.mjs', bytes(6010));
  const grew = r.runJson('--staged');
  assert.equal(grew.status, 1);
  assert.deepEqual(grew.result.failures, [
    { path: 'src/moved.mjs', tokens: 6010, recorded: 6000, from: 'src/a.mjs' },
  ]);
  r.stage('src/moved.mjs', bytes(6000));
  assert.equal(r.run('--update').status, 0);
  assert.deepEqual(r.readBaseline().files, { 'src/moved.mjs': 6000 });
  r.done();
});

test('exempt files, non-source files and never-counted directories are not counted', () => {
  const r = repo();
  r.baseline({}, { 'src/contract.css.ts': 'generated by the token build' });
  r.stage('src/contract.css.ts', bytes(9000));
  r.stage('docs/big.md', bytes(9000));
  r.stage('data/big.json', bytes(9000));
  r.stage('styles/big.css', bytes(9000));
  for (const d of ['node_modules', 'dist', 'build', 'coverage', 'target', '.pxsig', '.desloppify'])
    r.stage(`pkg/${d}/big.js`, bytes(9000));
  const { status, result } = r.runJson('--staged');
  assert.equal(status, 0);
  assert.equal(result.checked, 0);
  r.done();
});

test('the size is the index blob’s, whatever the working tree’s line endings', () => {
  const r = repo();
  r.baseline({});
  r.write('.gitattributes', '*.mjs text\n');
  // 2,000 lines of 10 bytes: 20,000 bytes (5,000 tokens) with LF, 22,000 with CRLF.
  r.stage('src/crlf.mjs', `${'x'.repeat(8)};\r\n`.repeat(2000));
  const { status, result } = r.runJson('--staged');
  assert.equal(status, 0);
  assert.equal(result.checked, 1);
  r.commit();
  assert.equal(r.run('--all').status, 0);
  r.done();
});

test('--all checks every tracked file, as CI does', () => {
  const r = repo();
  r.baseline({ 'src/big.mjs': 6000 });
  r.write('src/big.mjs', bytes(6000));
  r.write('src/small.ts', bytes(10));
  r.commit();
  assert.equal(r.run('--all').status, 0);
  r.write('src/new.tsx', bytes(5001));
  r.commit();
  const { status, result } = r.runJson('--all');
  assert.equal(status, 1);
  assert.deepEqual(result.failures, [{ path: 'src/new.tsx', tokens: 5001, recorded: null }]);
  r.done();
});

test('--update lowers an entry and drops one now within the limit or deleted', () => {
  const r = repo();
  r.baseline(
    { 'src/a.mjs': 7000, 'src/b.mjs': 6000, 'src/gone.mjs': 8000 },
    { 'x.ts': 'vendored' }
  );
  r.write('src/a.mjs', bytes(6500));
  r.write('src/b.mjs', bytes(4000));
  r.commit();
  const { status } = r.run('--update');
  assert.equal(status, 0);
  const b = r.readBaseline();
  assert.deepEqual(b.files, { 'src/a.mjs': 6500 });
  assert.deepEqual(b.exempt, { 'x.ts': 'vendored' });
  assert.equal(b.limit, 5000);
  r.done();
});

test('--update refuses to raise or add an entry, and writes nothing', () => {
  const r = repo();
  r.baseline({ 'src/a.mjs': 6000 });
  r.write('src/a.mjs', bytes(6500));
  r.write('src/new.mjs', bytes(5500));
  r.commit();
  const before = readFileSync(join(r.dir, 'scripts/file-size-baseline.json'), 'utf8');
  const { status, out } = r.run('--update');
  assert.equal(status, 1);
  assert.match(out, /never raises or adds an entry\. Nothing written\./);
  assert.match(out, /✗ src\/a\.mjs: 6,500 tokens; its recorded size is 6,000\./);
  assert.match(out, /✗ src\/new\.mjs: 5,500 tokens; a file not in the baseline/);
  assert.equal(readFileSync(join(r.dir, 'scripts/file-size-baseline.json'), 'utf8'), before);
  r.done();
});

test('--init records every file over the limit once, keeping exempt', () => {
  const r = repo();
  r.baseline({}, { 'gen.ts': 'generated' });
  r.write('src/a.rs', bytes(5001));
  r.write('src/b.cjs', bytes(5000));
  r.write('gen.ts', bytes(9000));
  r.commit();
  assert.equal(r.run('--init').status, 0);
  assert.deepEqual(r.readBaseline().files, { 'src/a.rs': 5001 });
  assert.deepEqual(r.readBaseline().exempt, { 'gen.ts': 'generated' });
  assert.equal(r.run('--init').status, 1);
  r.done();
});

test('an unknown or missing mode is a usage error', () => {
  const r = repo();
  assert.equal(r.run().status, 2);
  assert.equal(r.run('--staged', '--all').status, 2);
  assert.equal(r.run('--bogus').status, 2);
  r.done();
});
