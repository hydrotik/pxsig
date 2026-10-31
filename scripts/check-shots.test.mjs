// check-shots.mjs: a minor or major release ships shots of its own version.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { shotsProblem } from './check-shots.mjs';

const all = () => true;
const shots = (/** @type {string} */ version) => ({
  version,
  files: ['overview.png', 'inspector.png'],
});

test('a minor or major release needs shots taken at that minor', () => {
  assert.equal(shotsProblem('v0.7.0', shots('0.7.0'), all), null);
  assert.equal(shotsProblem('v1.0.0', shots('1.0.0'), all), null);
  assert.match(String(shotsProblem('v0.7.0', shots('0.6.0'), all)), /from 0\.6\.0, not 0\.7/);
  assert.match(String(shotsProblem('v0.7.0', null, all)), /shots\.json is missing/);
  assert.match(String(shotsProblem('v0.7.0', { version: '0.7.0', files: [] }, all)), /no shots/);
});

test('every listed shot must exist', () => {
  const problem = shotsProblem('v0.7.0', shots('0.7.0'), (f) => f !== 'inspector.png');
  assert.match(String(problem), /missing: inspector\.png/);
});

test('a patch or a prerelease keeps the last shots', () => {
  assert.equal(shotsProblem('v0.7.1', shots('0.6.0'), all), null);
  assert.equal(shotsProblem('v0.8.0-rc.1', null, all), null);
});

test('a tag that is not a version is a usage error', () => {
  assert.throws(() => shotsProblem('latest', null, all), /not a version tag/);
});
