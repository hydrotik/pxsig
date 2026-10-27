import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { knownFlags, parseArgs, unknownFlagLines, unknownFlags } from '../src/lib/args.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const flagsIn = (text) => new Set([...text.matchAll(/--([a-z][a-z0-9-]+)/g)].map((m) => m[1]));
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
    'pxsig: unknown flag --zzzz, ignored',
  ]);
});

test('an unknown flag is still parsed as before: a warning, not a change in what runs', () => {
  assert.deepEqual(parseArgs(['init', '--nmae', 'foo']), {
    positional: ['init'],
    flags: { nmae: 'foo' },
  });
});

// The registry is the CLI's flags (test/help.test.mjs); the help a person reads names no other.
// (docs/cli.md also documents the engine binary's own flags, which `pxsig` does not take.)
test('every flag the help topics and `pxsig --help` name is known', () => {
  const topics = join(pkg, 'src', 'help', 'topics');
  for (const f of readdirSync(topics))
    assert.deepEqual(missing(flagsIn(readFileSync(join(topics, f), 'utf8'))), [], f);
  const help = spawnSync(process.execPath, [join(pkg, 'bin', 'pxsig.mjs'), '--help'], {
    encoding: 'utf8',
  });
  assert.deepEqual(missing(flagsIn(help.stdout)), [], 'pxsig --help');
});

test('pxsig --version and pxsig version: the CLI, the engine it would run and the UI contract', () => {
  const run = (...args) =>
    spawnSync(process.execPath, [join(pkg, 'bin', 'pxsig.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PXSIG_BIN: join(here, 'no-such-engine') },
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
