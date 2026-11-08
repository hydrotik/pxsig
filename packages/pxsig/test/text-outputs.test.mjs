/**
 * text-outputs.test.mjs — text labels where agents and people read them (text-aware diffs PR 4):
 * `pxsig list` (the Why column, `--text`), `pxsig entry` (the Text block, `--json`), and MCP
 * `pxsig_list` (the brief, the `text` filter) and `pxsig_entry` (`textDiff`, `textLines`), from a
 * fixture project whose check.json rows carry `textDiff`. Exit codes stay as they are. No server.
 *
 *   node --test packages/pxsig/test/text-outputs.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { textLines } from '../src/lib/text/say.mjs';
import { fixture, rustBin, testEnv, testHome } from './fixture.mjs';
import { ENV_DIFFERS, REFLOW } from './text-say-helpers.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const CHANGED = 'components-beta--default';
const PASSING = 'components-alpha--default';
const DRIFT = 'components-alpha--with-icon';

const { repo } = fixture({ withSigs: false });
{
  const file = join(repo, '.pxsig/reports/check.json');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  /** @type {Record<string, unknown>} */
  const labels = { [CHANGED]: REFLOW, [PASSING]: REFLOW, [DRIFT]: ENV_DIFFERS };
  for (const r of report.rows) if (labels[r.id]) r.textDiff = labels[r.id];
  writeFileSync(file, JSON.stringify(report));
}

/**
 * @param {string} script
 * @param {string[]} args
 */
const node = (script, args) =>
  spawnSync(process.execPath, [join(src, script), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...testEnv(testHome),
      PXSIG_FORMAT: '',
      PXSIG_URL: 'http://127.0.0.1:1',
      PXSIG_BIN: rustBin,
    },
  });
/** @param {string[]} args */
const cli = (args) => node('cli.mjs', args);
/**
 * @param {string} tool
 * @param {Record<string, unknown>} args
 */
const mcp = (tool, args) => node('mcp-call.mjs', [tool, JSON.stringify(args)]);

test('pxsig list names the text kind after the first reason, and exits as before', () => {
  const r = cli(['list']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ssim 0\.8 < min 0\.99 · text: copy, reflow \|/);
});

test('pxsig list --text searches every state; a bad kind is a usage error', () => {
  const r = cli(['list', '--text', 'copy-reflow', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const ids = JSON.parse(r.stdout).entries.map((/** @type {{ id: string }} */ e) => e.id);
  assert.deepEqual(ids.sort(), [PASSING, CHANGED].sort(), 'the passing copy change too');
  const changed = cli(['list', 'changed', '--text', 'copy-reflow', '--json']);
  assert.deepEqual(
    JSON.parse(changed.stdout).entries.map((/** @type {{ id: string }} */ e) => e.id),
    [CHANGED]
  );
  const bad = cli(['list', '--text', 'nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr + bad.stdout, /--text is one of copy, copy-reflow, moved, restyled, any/);
});

test('pxsig entry shows a Text block; --json carries textDiff and textLines', () => {
  const r = cli(['entry', CHANGED]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /### Text — Copy, reflow/);
  for (const line of textLines(REFLOW)) assert.ok(r.stdout.includes(line), line);
  assert.match(r.stdout, /Labels only\. The gate and the decision are unchanged\./);
  const j = JSON.parse(cli(['entry', CHANGED, '--json']).stdout);
  assert.deepEqual(j.textDiff, REFLOW);
  assert.deepEqual(j.textLines, textLines(REFLOW));
  assert.equal(j.textKind, 'copy-reflow');
  const env = cli(['entry', DRIFT]);
  assert.match(env.stdout, /### Text — Not compared/);
  assert.match(env.stdout, /text is compared only within one environment/);
  assert.doesNotMatch(cli(['entry', 'components-beta--flaky']).stdout, /### Text/);
});

test('pxsig_list: the brief carries the text kind; text filters it; a bad kind is an error', () => {
  const r = mcp('pxsig_list', { text: 'copy-reflow' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.total, 2);
  for (const e of out.entries) {
    assert.equal(e.textKind, 'copy-reflow');
    assert.match(e.textSummary, /^Copy, reflow: 3 copy changes, 3 runs moved\./);
  }
  const all = JSON.parse(mcp('pxsig_list', { state: 'all', limit: 500 }).stdout);
  const drift = all.entries.find((/** @type {{ id: string }} */ e) => e.id === DRIFT);
  assert.equal(drift.textState, 'env-differs');
  const bad = mcp('pxsig_list', { text: 'nope' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /text must be one of/);
});

test('pxsig_entry carries textDiff in full and its sentences', () => {
  const r = mcp('pxsig_entry', { id: CHANGED, images: [] });
  assert.equal(r.status, 0, r.stderr);
  const e = JSON.parse(r.stdout);
  assert.deepEqual(e.textDiff, REFLOW);
  assert.deepEqual(e.textLines, textLines(REFLOW));
  assert.equal(e.state, 'changed', 'the label changes no state');
});
