import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { knownFlags, parseArgs, unknownFlagLines, unknownFlags } from '../src/lib/args.mjs';
import { tempDir, testEnv, testHome } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
/** @param {string} text */
const flagsIn = (text) => new Set([...text.matchAll(/--([a-z][a-z0-9-]+)/g)].map((m) => m[1]));
/** @param {Iterable<string>} names */
const missing = (names) => [...names].filter((n) => !knownFlags().has(n)).sort();

test('a misspelled flag is reported with the closest known one and the word it took', () => {
  assert.deepEqual(unknownFlags(['init', '--nmae', 'foo', '--storybok-url=x', '--ful', '--json']), [
    { name: 'nmae', suggestion: 'name', took: 'foo' },
    { name: 'storybok-url', suggestion: 'storybook-url', took: null },
    { name: 'ful', suggestion: 'full', took: null },
  ]);
  assert.deepEqual(unknownFlags(['check', '--full', '--project', 'web', '--', '--x']), [
    { name: 'x', suggestion: null, took: null },
  ]);
  assert.deepEqual(unknownFlagLines([{ name: 'zzzz', suggestion: null, took: null }]), [
    'pxsig: unknown flag --zzzz',
  ]);
});

test('the parser keeps an unknown flag; the CLI refuses it before any command runs', () => {
  assert.deepEqual(parseArgs(['init', '--nmae', 'foo']), {
    positional: ['init'],
    flags: { nmae: 'foo' },
  });
});

test('an unknown flag exits 2 with the nearest known one, and nothing runs', () => {
  const dir = tempDir('unknown-flag');
  /** @param {string[]} args */
  const run = (...args) =>
    spawnSync(process.execPath, [join(pkg, 'bin', 'pxsig.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...testEnv(testHome), PXSIG_WORKSPACE: dir, PXSIG_NO_DELEGATE: '1' },
    });
  const init = run('init', '--nmae', 'foo');
  assert.equal(init.status, 2);
  assert.equal(
    init.stderr,
    'pxsig: unknown flag --nmae (did you mean --name?); it took "foo" as its value\n'
  );
  assert.equal(init.stdout, '');
  assert.equal(existsSync(join(dir, 'pxsig.config.json')), false, 'init did not run');
  for (const args of [
    ['status', '--ful'],
    ['check', '--zzzz=1'],
    ['--help', '--jsno'],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^pxsig: unknown flag --/, args.join(' '));
  }
  // `cat` hands its flags to the engine, which checks them itself.
  assert.doesNotMatch(run('cat', 'none.psig', '--image', 'x.png').stderr, /unknown flag/);
});

// The registry is the CLI's flags (test/help.test.mjs); the help a person reads names no other.
// (docs/cli.md also documents the engine binary's own flags, which `pxsig` does not take.)
test('every flag the help topics and `pxsig --help` name is known', () => {
  const topics = join(pkg, 'src', 'help', 'topics');
  for (const f of readdirSync(topics))
    assert.deepEqual(missing(flagsIn(readFileSync(join(topics, f), 'utf8'))), [], f);
  const help = spawnSync(process.execPath, [join(pkg, 'bin', 'pxsig.mjs'), '--help'], {
    encoding: 'utf8',
    env: testEnv(testHome),
  });
  assert.deepEqual(missing(flagsIn(help.stdout)), [], 'pxsig --help');
});

test('pxsig --version and pxsig version: the CLI, the engine it would run and the UI contract', () => {
  /** @param {string[]} args */
  const run = (...args) =>
    spawnSync(process.execPath, [join(pkg, 'bin', 'pxsig.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...testEnv(testHome), PXSIG_BIN: join(here, 'no-such-engine') },
    });
  const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const text = run('--version');
  assert.equal(text.status, 0);
  assert.match(
    text.stdout,
    new RegExp(
      `^pxsig ${version.replace(/\./g, '\\.')} \\(engine not found, UI contract \\d+\\.\\d+\\.\\d+\\)\\n$`
    )
  );
  assert.equal(text.stderr, '', 'no warning: --version is a known flag');
  const json = JSON.parse(run('version', '--json').stdout);
  assert.deepEqual(Object.keys(json), ['pxsig', 'engine', 'contract']);
  assert.equal(json.pxsig, version);
  assert.equal(json.engine, null);
});
