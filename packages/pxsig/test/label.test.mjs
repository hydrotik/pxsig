/**
 * The dashboard title's label (config `label`): set by `pxsig init`, validated when a project
 * loads, and carried in the dashboard data with the versions that drew the page.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildData } from '../src/report.mjs';
import { initProject } from '../src/lib/setup.mjs';
import { openProject, PXSIG_VERSION } from '../src/lib/workspace.mjs';

const cli = fileURLToPath(new URL('../bin/pxsig.mjs', import.meta.url));
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'pxsig-label-'));
  mkdirSync(join(root, '.git'));
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), JSON.stringify(v));
  }
  return root;
};
const config = (dir) => JSON.parse(readFileSync(join(dir, 'pxsig.config.json'), 'utf8'));
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20_000, env: { ...process.env, PXSIG_FORMAT: 'plain', PXSIG_WORKSPACE: '', PXSIG_PROJECT: '', PXSIG_NO_DELEGATE: '1' } });

test('init --label writes the label, trimmed; an empty or over-long label is refused', () => {
  const root = tree({ 'package.json': { name: 'ui' } });
  initProject({ dir: root, label: '  Hydrotik ' });
  assert.equal(config(root).label, 'Hydrotik');
  for (const label of ['   ', 'x'.repeat(61)]) {
    const dir = tree({});
    assert.throws(() => initProject({ dir, label }), /1 to 60 characters/);
    assert.equal(existsSync(join(dir, 'pxsig.config.json')), false, 'a refused init writes nothing');
  }
});

test('init without a terminal never asks: no label is written, and the title stays the project name', () => {
  const root = tree({ 'package.json': { name: 'ui' } });
  const r = run(['init', root], root);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Title in the dashboard/);
  assert.equal('label' in config(root), false);
  const labelled = tree({ 'package.json': { name: 'ui' } });
  assert.equal(run(['init', labelled, '--label', 'Hydrotik'], labelled).status, 0);
  assert.equal(config(labelled).label, 'Hydrotik');
});

test('a project with a bad label does not load; a good one reaches the dashboard data with the versions', () => {
  for (const label of ['', '  ', 'x'.repeat(61), 7]) {
    const root = tree({ 'pxsig.config.json': { version: 1, name: 'ui', label } });
    assert.throws(() => openProject({ cwd: root }), /label must be text of 1 to 60 characters/, JSON.stringify(label));
  }
  const root = tree({ 'pxsig.config.json': { version: 1, name: 'ui', label: ' Hydrotik ' } });
  const P = openProject({ cwd: root });
  assert.equal(P.label, 'Hydrotik');
  const d = buildData(P);
  assert.equal(d.label, 'Hydrotik');
  assert.equal(d.versions.pxsig, PXSIG_VERSION);
  assert.match(d.versions.contract, /^\d+\.\d+\.\d+$/);
  // Without a label the data carries the name, so the title reads as before.
  assert.equal(buildData(openProject({ cwd: tree({ 'pxsig.config.json': { version: 1, name: 'ui' } }) })).label, 'ui');
});

test('pxsig config names the dashboard title and the layer that set the label', () => {
  const root = tree({ 'pxsig.config.json': { version: 1, name: 'ui', label: 'Hydrotik' } });
  const r = run(['config', '--json'], root);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.label, 'Hydrotik');
  assert.equal(d.sources.label, 'project config');
  assert.match(run(['config'], root).stdout, /Dashboard title.*pxsig · Hydrotik/);
});

test("the schema holds a label to 1–60 characters with something besides spaces", () => {
  const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../schema/project.json', import.meta.url)), 'utf8'));
  const l = schema.properties.label;
  assert.deepEqual([l.type, l.minLength, l.maxLength], ['string', 1, 60]);
  assert.ok(new RegExp(l.pattern).test('Hydrotik') && !new RegExp(l.pattern).test('   '));
});
