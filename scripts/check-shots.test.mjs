// check-shots.mjs: a release ships shots that still show its own dashboard.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { gitChangedScreens, SCREENS, screenOf, shotsProblem } from './check-shots.mjs';

const all = () => true;
const none = () => [];
const shots = (/** @type {string} */ version) => ({
  version,
  files: ['overview.png', 'inspector.png'],
});

test('a minor or major release needs shots taken at that minor', () => {
  assert.equal(shotsProblem('v0.7.0', shots('0.7.0'), all, none), null);
  assert.equal(shotsProblem('v1.0.0', shots('1.0.0'), all, none), null);
  assert.match(String(shotsProblem('v0.7.0', shots('0.6.0'), all, none)), /from 0\.6\.0, not 0\.7/);
  assert.match(String(shotsProblem('v0.8.0', shots('0.7.3'), all, none)), /from 0\.7\.3, not 0\.8/);
  assert.match(String(shotsProblem('v0.7.0', null, all, none)), /shots\.json is missing/);
  assert.match(String(shotsProblem('v0.7.1', null, all, none)), /shots\.json is missing/);
  assert.match(
    String(shotsProblem('v0.7.0', { version: '0.7.0', files: [] }, all, none)),
    /no shots/
  );
  assert.match(String(shotsProblem('v0.7.1', { files: ['a.png'] }, all, none)), /names no version/);
});

test('every listed shot must exist', () => {
  const problem = shotsProblem('v0.7.1', shots('0.7.0'), (f) => f !== 'inspector.png', none);
  assert.match(String(problem), /missing: inspector\.png/);
});

test('a patch with no screen change since the shots passes', () => {
  /** @type {string[]} */
  const asked = [];
  const changed = (/** @type {string} */ since) =>
    (asked.push(since), []);
  assert.equal(shotsProblem('v0.7.3', shots('0.7.0'), all, changed), null);
  assert.deepEqual(asked, ['v0.7.0']);
});

test('a patch with a screen changed since the shots fails, naming the screens and the fix', () => {
  const changed = () => [
    `${SCREENS}/overview/overview--status-1@dark.psig`,
    `${SCREENS}/overview/overview--status-1@light.psig`,
    `${SCREENS}/shell/shell--top-bar-1@dark.psig`,
  ];
  const problem = String(shotsProblem('v0.7.3', shots('0.7.0'), all, changed));
  assert.match(problem, /3 of the dashboard's screens changed since the product shots \(0\.7\.0\)/);
  assert.match(
    problem,
    /overview--status-1@dark, overview--status-1@light, shell--top-bar-1@dark\./
  );
  assert.match(problem, /node scripts\/showcase-shots\.mjs/);
});

test('a long list of changed screens is cut short', () => {
  const changed = () => Array.from({ length: 20 }, (_, i) => `${SCREENS}/g/s-${i}@dark.psig`);
  assert.match(String(shotsProblem('v0.7.3', shots('0.7.0'), all, changed)), /, and 8 more\./);
});

test('a missing tag for the shots version fails', () => {
  const problem = shotsProblem('v0.7.3', shots('0.7.1'), all, () => null);
  assert.match(String(problem), /no tag v0\.7\.1 to compare/);
});

test("shots taken at the release's own version need no comparison", () => {
  const changed = () => assert.fail('no diff for shots of this very release');
  assert.equal(shotsProblem('v0.7.4', shots('0.7.4'), all, changed), null);
  assert.equal(shotsProblem('v0.8.0', shots('0.8.0'), all, changed), null);
});

test('a prerelease is exempt', () => {
  const changed = () => assert.fail('a prerelease compares nothing');
  assert.equal(shotsProblem('v0.8.0-rc.1', null, all, changed), null);
  assert.equal(
    shotsProblem('v0.7.4-pre.1', shots('0.6.0'), () => false, changed),
    null
  );
});

test('a tag that is not a version is a usage error', () => {
  assert.throws(() => shotsProblem('latest', null, all, none), /not a version tag/);
});

test('a screen is its baseline file name', () => {
  assert.equal(screenOf(`${SCREENS}/live/live--review-2@light.psig`), 'live--review-2@light');
});

test('git: the baselines changed since a tag, or null without the tag', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'check-shots-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  /** @param {...string} a */
  const git = (...a) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], {
      cwd: root,
      stdio: 'pipe',
    });
  const put = (/** @type {string} */ rel, /** @type {string} */ body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  git('init', '-q');
  put(`${SCREENS}/shell/a@dark.psig`, '1');
  put('packages/dashboard/fixtures/locked/shell/a.aria.yml', '1');
  git('add', '.');
  git('commit', '-qm', 'one');
  git('tag', 'v0.1.0');
  assert.deepEqual(gitChangedScreens(root, 'v0.1.0'), []);
  put('packages/dashboard/fixtures/locked/shell/a.aria.yml', '2');
  put(`${SCREENS}/shell/b@dark.psig`, '1');
  put(`${SCREENS}/shell/a@dark.psig`, '2');
  git('add', '.');
  git('commit', '-qm', 'two');
  assert.deepEqual(gitChangedScreens(root, 'v0.1.0'), [
    `${SCREENS}/shell/a@dark.psig`,
    `${SCREENS}/shell/b@dark.psig`,
  ]);
  assert.equal(gitChangedScreens(root, 'v0.0.9'), null);
});
