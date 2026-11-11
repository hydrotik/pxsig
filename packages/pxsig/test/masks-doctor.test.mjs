/**
 * masks-doctor.test.mjs — `pxsig doctor` lists the masks in force (volatile content PR 3): the
 * attribute, wherever it renders; each config selector with its layer (workspace defaults or
 * project config, as `pxsig config` names it); the baselines that record masks. Terminal,
 * Markdown and JSON. Never the exit. Temp folders only; no Storybook, no server.
 *
 *   node --test packages/pxsig/test/masks-doctor.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanProject, cli } from './features-helpers.mjs';

/** The clean project, with masks at both layers and one baseline that records masks. */
function masked() {
  const root = cleanProject();
  writeFileSync(
    join(root, 'pxsig.workspace.json'),
    JSON.stringify({
      projects: { clean: '.' },
      defaults: { capture: { ignore: ['[data-build]'] } },
    })
  );
  const config = join(root, 'pxsig.config.json');
  const c = JSON.parse(readFileSync(config, 'utf8'));
  writeFileSync(config, JSON.stringify({ ...c, capture: { addIgnore: ['.clock'] } }));
  // The baseline's header gains `masks` (spec section 5), as the engine writes it.
  const sig = join(root, '.pxsig/baselines/A/c-a--one.psig');
  const buf = readFileSync(sig);
  const header = JSON.parse(buf.subarray(10, 10 + buf.readUInt32LE(6)).toString('utf8'));
  header.masks = {
    v: 1,
    masks: [{ selector: '[data-volatile]', source: 'attribute', area: 0.1 }],
  };
  const h = Buffer.from(JSON.stringify(header));
  const pre = Buffer.from(buf.subarray(0, 10));
  pre.writeUInt32LE(h.length, 6);
  writeFileSync(sig, Buffer.concat([pre, h]));
  return root;
}

test('pxsig doctor --json: the masks in force, each config selector with its layer', () => {
  const r = cli(['doctor', '--offline', '--json'], masked());
  assert.equal(r.status, 0, r.stdout.slice(0, 2000) + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).masks, {
    attribute: '[data-volatile]',
    note: 'masked wherever it renders: a component sets it, so it is not listed per project',
    config: [
      { selector: '[data-build]', source: 'workspace', layer: 'workspace defaults' },
      { selector: '.clock', source: 'project', layer: 'project config' },
    ],
    baselines: 2,
    recorded: 1,
  });
});

test('pxsig doctor: a Masks line and the config masks as a table, in the terminal and Markdown', () => {
  const root = masked();
  for (const args of [
    ['doctor', '--offline'],
    ['doctor', '--offline', '--markdown'],
  ]) {
    const r = cli(args, root);
    assert.equal(r.status, 0, r.stdout.slice(0, 2000) + r.stderr);
    assert.match(
      r.stdout,
      /\[data-volatile\] wherever it renders · 2 selectors from config · 1 of 2 baselines record masks/
    );
    assert.match(r.stdout, /Masks/);
    assert.match(r.stdout, /\[data-build\]\s*\|?\s*workspace defaults/);
    assert.match(r.stdout, /\.clock\s*\|?\s*project config/);
  }
  // No config masks: the line only, no table; pxsig config names the same layers.
  const plain = cleanProject();
  const r = cli(['doctor', '--offline'], plain);
  assert.match(
    r.stdout,
    /\[data-volatile\] wherever it renders · 0 selectors from config · 0 of 2/
  );
  assert.doesNotMatch(r.stdout, /Set by/);
  const config = cli(['config'], root);
  assert.match(config.stdout, /\[data-build\]\s*\|?\s*workspace defaults/);
});
