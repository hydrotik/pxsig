// screen-locks.mjs: each screen's structure is locked as text, alike in every theme.
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  checkGeometry,
  checkStructure,
  firstDifference,
  structureFile,
} from './lib/screen-locks.mjs';

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

/**
 * Screens of one feature with anchor boxes, in both themes.
 * @param {(Record<string, [number, number, number, number] | null>)[]} perScreen
 */
const anchored = (perScreen) =>
  perScreen.flatMap((anchors, index) =>
    ['dark', 'light'].map((theme) => ({ feature: 'inspector.header', index, theme, anchors }))
  );
const approve = /** @type {[number, number, number, number]} */ ([1115, 41, 75, 28]);

test('geometry: --update-locks writes the boxes; a check then passes', () => {
  const file = join(fresh(), 'geometry.json');
  const s = anchored([{ approve }, { approve }]);
  assert.equal(checkGeometry({ screens: s, file, update: true, complete: true }).written, true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    'inspector.header': { 1: { approve }, 2: { approve } },
  });
  assert.deepEqual(checkGeometry({ screens: s, file, complete: true }).problems, []);
});

test('geometry: an anchor that moves between screens, or everywhere at once, fails', () => {
  const file = join(fresh(), 'geometry.json');
  checkGeometry({ screens: anchored([{ approve }, { approve }]), file, update: true });
  const moved = /** @type {[number, number, number, number]} */ ([1115, 45, 75, 28]);
  assert.match(
    checkGeometry({ screens: anchored([{ approve }, { approve: moved }]), file }).problems[0],
    /inspector.header: anchor approve moves between screens \(#1 \[1115, 41, 75, 28\], #2 \[1115, 45/
  );
  assert.deepEqual(
    checkGeometry({ screens: anchored([{ approve: moved }, { approve: moved }]), file }).problems,
    [
      'inspector.header #1: anchor approve moved ([1115, 41, 75, 28] → [1115, 45, 75, 28])',
      'inspector.header #2: anchor approve moved ([1115, 41, 75, 28] → [1115, 45, 75, 28])',
    ]
  );
});

test('geometry: an anchor absent on one screen is locked as absent, not compared', () => {
  const file = join(fresh(), 'geometry.json');
  const s = anchored([{ approve }, { approve: null }]);
  checkGeometry({ screens: s, file, update: true });
  assert.deepEqual(checkGeometry({ screens: s, file }).problems, []);
  assert.match(
    checkGeometry({ screens: anchored([{ approve }, { approve }]), file }).problems[0],
    /#2: anchor approve moved \(absent → \[1115/
  );
});

test('geometry: a removed anchor or feature fails a full run only', () => {
  const file = join(fresh(), 'geometry.json');
  checkGeometry({ screens: anchored([{ approve, close: approve }]), file, update: true });
  const fewer = anchored([{ approve }]);
  assert.deepEqual(checkGeometry({ screens: fewer, file }).problems, []);
  assert.match(
    checkGeometry({ screens: fewer, file, complete: true }).problems[0],
    /inspector.header: the locked geometry has an anchor, screen or feature this run does not/
  );
});
