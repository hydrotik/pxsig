// screen-locks.mjs: each screen's structure is locked as text, alike in every theme.
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkStructure, firstDifference, structureFile } from './lib/screen-locks.mjs';

const dark = '- heading "Overview" [level=2]\n- button "Light theme"';
const light = '- heading "Overview" [level=2]\n- button "Dark theme"';
/** Both themes of overview.counts #1, with the given texts. */
const screens = (d = dark, l = light) => [
  { feature: 'overview.counts', index: 0, theme: 'dark', aria: d },
  { feature: 'overview.counts', index: 0, theme: 'light', aria: l },
];
const fresh = () => mkdtempSync(join(tmpdir(), 'screen-locks-'));

test('a structure file is <section>/<name>-<n>.aria.yml', () => {
  assert.equal(structureFile('inspector.header', 2), 'inspector/header-2.aria.yml');
  assert.equal(structureFile('a11y.rules.more', 1), 'a11y/rules-more-1.aria.yml');
});

test('--update-locks writes the dark theme as it is; a check then passes', () => {
  const dir = fresh();
  const w = checkStructure({ screens: screens(), dir, update: true });
  assert.deepEqual(w, { problems: [], written: ['overview/counts-1.aria.yml'], removed: [] });
  assert.equal(readFileSync(join(dir, 'overview/counts-1.aria.yml'), 'utf8'), `${dark}\n`);
  assert.deepEqual(checkStructure({ screens: screens(), dir }).problems, []);
});

test('a missing or changed structure fails, and says where', () => {
  const dir = fresh();
  assert.deepEqual(checkStructure({ screens: screens(), dir }).problems, [
    'overview/counts-1.aria.yml: no locked structure',
  ]);
  checkStructure({ screens: screens(), dir, update: true });
  const moved = checkStructure({
    screens: screens(dark.replace('Overview', 'Summary'), light.replace('Overview', 'Summary')),
    dir,
  });
  assert.match(moved.problems[0], /structure changed \(line 1: - .*"Overview".* \/ \+ .*"Summary"/);
});

test('the themes must agree, except where a mask says why not', () => {
  const dir = fresh();
  const p = checkStructure({ screens: screens(dark, `${light}\n- button "Extra"`), dir }).problems;
  assert.match(p[0], /the dark and light themes differ in structure \(line 3/);
  assert.ok(
    !existsSync(join(dir, 'overview')),
    'nothing is written for a screen whose themes differ'
  );
});

test('with every screen rendered, a locked file with no screen is stale', () => {
  const dir = fresh();
  mkdirSync(join(dir, 'gone'));
  writeFileSync(join(dir, 'gone/old-1.aria.yml'), 'x\n');
  checkStructure({ screens: screens(), dir, update: true });
  assert.deepEqual(checkStructure({ screens: screens(), dir }).problems, []);
  assert.deepEqual(checkStructure({ screens: screens(), dir, complete: true }).problems, [
    'gone/old-1.aria.yml: locked, but no screen has it',
  ]);
  assert.deepEqual(
    checkStructure({ screens: screens(), dir, complete: true, update: true }).removed,
    ['gone/old-1.aria.yml']
  );
});

test('firstDifference names the line', () => {
  assert.equal(firstDifference('a\nb', 'a\nc'), 'line 2: - b / + c');
  assert.equal(firstDifference('a', 'a\nb'), 'line 2: - (nothing) / + b');
});
