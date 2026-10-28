// The CLI's output contract: piped output is clean Markdown, --json is one JSON document, and the
// exit codes hold. Runs in a fixture project; no server or Storybook needed.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixture, rustBin } from './fixture.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const { repo } = fixture({ withSigs: false });
/**
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
const run = (args, env = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PXSIG_FORMAT: '',
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
      ...env,
    },
  });
const ANSI = /\x1b[[\]]/;

test('piped output is Markdown with no terminal control codes', () => {
  const r = run(['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^## pxsig — \d+ entries/);
  assert.doesNotMatch(r.stdout, ANSI);
  assert.doesNotMatch(r.stdout, /\r/);
});

test('--json prints one parseable document', () => {
  const r = run(['status', '--json']);
  const data = JSON.parse(r.stdout);
  assert.equal(data.project, 'fixture');
  assert.equal(typeof data.entries, 'number');
  assert.ok(data.counts);
});

test('--pretty styles output even when piped; NO_COLOR strips the colour', () => {
  assert.match(run(['status', '--pretty']).stdout, ANSI);
  assert.doesNotMatch(run(['status', '--pretty'], { NO_COLOR: '1' }).stdout, ANSI);
});

test('list renders a GFM table and names the next command', () => {
  const r = run(['list', 'all', '--limit', '3']);
  assert.match(r.stdout, /\| State \| Entry \| SSIM \| Cells \| Why \|/);
  assert.match(r.stdout, /`pxsig entry /);
});

test('entry names where each image lives; the baseline is inside its .psig', () => {
  const r = run(['entry', 'components-alpha--default']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /- baseline: .*components-alpha--default\.psig \(image section\)/);
  assert.match(r.stdout, /- current: .*renders\/latest\/components-alpha--default\.png/);
});

test('projects and config describe the workspace', () => {
  const p = JSON.parse(run(['projects', '--json']).stdout);
  assert.deepEqual(
    p.projects.map((/** @type {{ name: string }} */ x) => x.name),
    ['fixture']
  );
  const c = JSON.parse(run(['config', '--json']).stdout);
  assert.equal(c.project, 'fixture');
  assert.match(c.store.root, /\.pxsig$/);
});

test('usage errors exit 2', () => {
  assert.equal(run(['nope']).status, 2);
  assert.equal(run(['entry']).status, 2);
  assert.equal(run(['check']).status, 2);
  assert.equal(run(['migrate']).status, 2);
});
