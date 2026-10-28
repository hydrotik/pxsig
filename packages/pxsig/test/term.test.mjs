// lib/term.mjs pretty output. No terminal: stdout is captured.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emit } from '../src/lib/term.mjs';

/** @param {() => void} fn */
const captured = (fn) => {
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (/** @type {string} */ s) =>
    ((out += s), true);
  try {
    fn();
  } finally {
    process.stdout.write = write;
  }
  return out;
};

test('pretty output prints a cell with an unknown colour name without colour', () => {
  const out = captured(() =>
    emit('pretty', [{ kv: [['state', { text: 'ready', color: 'chartreuse' }]] }])
  );
  assert.match(out, /state\S*\s+ready/);
  assert.equal(out[out.indexOf('ready') - 1], ' ', 'no colour code before the text');
});
