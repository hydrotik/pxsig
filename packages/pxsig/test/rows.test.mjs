// buildRow: what a render error and an engine error leave in a check row. No Rust, no server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRow, dropStaleRows } from '../src/lib/rows.mjs';

const entry = { id: 'a-b--c', story: 'a-b--c', mode: 'dark' };
const manifest = { defaultMode: 'dark' };
const stale = { id: entry.id, pass: false, metrics: { ssim: 0.1 }, reasons: ['ssim 0.1 < min 0.99'] };

test('a render error carries no comparison of the image it left behind, and is not a change', () => {
  const row = buildRow(entry, stale, { error: 'storybook-error: Vite error overlay: Failed to resolve import' }, null, manifest);
  assert.equal(row.pass, false);
  assert.equal(row.changed, false);
  assert.match(row.error, /Vite error overlay/);
  assert.equal(row.metrics, undefined, 'the stale metrics are dropped');
  assert.equal(row.reasons, undefined);
});

test("an engine error (identical renders across many entries) is not a change either", () => {
  const row = buildRow(entry, { ...stale, error: 'identical render to 40 other failing entries: …' }, { ms: 5 }, null, manifest);
  assert.equal(row.changed, false);
  assert.match(row.error, /identical render/);
});

test('a new entry and a real change are still reviewable', () => {
  const fresh = buildRow(entry, { id: entry.id, pass: false, error: 'no baseline sig (run baseline first): x.psig' }, { ms: 5 }, null, manifest);
  assert.equal(fresh.new, true);
  assert.equal(fresh.changed, true);
  assert.equal(fresh.error, null);
  const changed = buildRow(entry, stale, { ms: 5 }, null, manifest);
  assert.equal(changed.changed, true);
  assert.equal(changed.error, null);
  assert.deepEqual(changed.metrics, { ssim: 0.1 });
});

test('rows for entries no longer in the manifest are dropped, and the summary follows', () => {
  const kept = buildRow(entry, { id: entry.id, pass: true }, { ms: 5 }, null, manifest);
  const gone = buildRow({ id: 'gone--story', mode: 'dark' }, { id: 'gone--story', pass: false, error: 'no baseline sig (run baseline first): x.psig' }, { ms: 5 }, null, manifest);
  const check = { rows: [kept, gone], summary: { entries: 2, generatedBy: 'check' } };
  assert.deepEqual(dropStaleRows(check, { stories: [entry] }), ['gone--story']);
  assert.deepEqual(check.rows.map((r) => r.id), [entry.id]);
  assert.equal(check.summary.entries, 1);
  assert.equal(check.summary.generatedBy, 'check', 'other summary fields are kept');
});

test('an empty (unloaded) manifest drops nothing', () => {
  const check = { rows: [buildRow(entry, { id: entry.id, pass: true }, { ms: 5 }, null, manifest)], summary: {} };
  assert.deepEqual(dropStaleRows(check, { stories: [] }), []);
  assert.equal(check.rows.length, 1);
});
