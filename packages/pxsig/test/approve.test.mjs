// The approval tollgate: the shape classifier, and the refusals that keep bulk baseline writes
// in a person's hands. Synthetic images and a fixture project; needs no server or Storybook.
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLog, record, snapshot, undo, verify } from '../src/lib/approvals.mjs';
import { classify } from '../src/lib/shape.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { fixture, hasRust, png, rustBin } from './fixture.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const { repo, sig } = fixture({ withSigs: hasRust });
const node = (args, env = {}) =>
  spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', env: { ...process.env, PXSIG_URL: 'http://127.0.0.1:1', PXSIG_BIN: rustBin, ...env } });

// A light page with a dark "thumb" at x0, and the same thumb moved, recoloured, or on a bigger page.
const page = (w, h, x0, ink = [30, 40, 60]) => png(w, h, (x, y) => (x >= x0 && x < x0 + 24 && y >= 20 && y < 44 ? ink : [245, 245, 245]));
const OFF = page(96, 64, 12);
const ON = page(96, 64, 60);
const RECOLOURED = page(96, 64, 12, [60, 30, 40]);
const WIDE = page(160, 64, 12);

test('identical renders are colour-only', () => {
  assert.equal(classify(OFF, OFF).kind, 'colour');
});

test('a recolour with content in place is colour-only', () => {
  assert.equal(classify(OFF, RECOLOURED).kind, 'colour');
});

test('a moved element (switch thumb off → on) is a shape change', () => {
  assert.equal(classify(OFF, ON).kind, 'shape');
});

test('a size change is a shape change', () => {
  const r = classify(OFF, WIDE);
  assert.equal(r.kind, 'shape');
  assert.match(r.reason, /size/);
});

test('approve apply / undo / verify --adopt refuse without a person at a terminal (exit 3)', () => {
  for (const args of [
    ['approve', 'apply'],
    ['approve', 'undo', 'x'],
    ['approve', 'verify', '--adopt'],
  ]) {
    const r = node([join(src, 'cli.mjs'), ...args]);
    assert.equal(r.status, 3, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /needs a person at a terminal/);
  }
});

test('approve plan needs a reason', () => {
  const r = node([join(src, 'cli.mjs'), 'approve', 'plan', '--all-changed']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--reason/);
});

test('check --update refuses before rendering when piped', () => {
  const r = node([join(src, 'check.mjs'), '--update', '--only', 'components-alpha--default']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /without review/);
});

test('snapshot + record + undo round-trip, and verify catches an out-of-band write', { skip: !hasRust && 'Rust binary not built' }, () => {
  const P = openProject({ cwd: repo, env: { PXSIG_BIN: rustBin } });
  const id = 'components-alpha--default';
  const entry = { id, sig: `.pxsig/baselines/components/Alpha/${id}.psig` };
  const manifest = { stories: [entry] };
  const original = readFileSync(sig(id));
  // approve: snapshot the old baseline, write the new one, log it
  const { before } = snapshot(P, entry, 'b1');
  cpSync(sig('components-alpha--with-icon'), sig(id));
  record(P, entry, { batch: 'b1', via: 'test', before });
  assert.equal(readLog(P).length, 1);
  assert.deepEqual(verify(P, manifest).mismatched, []);
  // a write outside the trail is caught
  writeFileSync(sig(id), Buffer.concat([readFileSync(sig(id)), Buffer.from([0])]));
  assert.equal(verify(P, manifest).mismatched.length, 1);
  // undo restores the pre-approval baseline, byte for byte
  assert.deepEqual(undo(P, manifest, 'b1').restored, [id]);
  assert.deepEqual(readFileSync(sig(id)), original);
  assert.ok(existsSync(join(P.store.history, 'b1', `${id}.psig`)));
});
