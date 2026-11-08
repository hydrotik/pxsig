/**
 * text-say.test.mjs — one wording of a row's text labels (lib/text/say.mjs, text-aware diffs PR 4):
 * each state and kind in words, a change per sentence, the boxes for crops, the brief and the
 * `text` filter, and summary.md's suffix (the engine's, crates/pxsig-cli/src/report_text.rs) in
 * the same words. No Rust, no server.
 *
 *   node --test packages/pxsig/test/text-say.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  sayChange,
  TEXT_FILTERS,
  TEXT_KIND_LABEL,
  TEXT_SUFFIX,
  textBoxes,
  textBrief,
  textKindLabel,
  textLines,
  textMatches,
  textSuffix,
  textSummary,
} from '../src/lib/text/say.mjs';
import { ENV_DIFFERS, ERROR, MIXED, NO_BASELINE, REFLOW, SAME } from './text-say-helpers.mjs';

const ENV_SENTENCE =
  "Text not compared: text is compared only within one environment, and this render's environment is not its baseline's. Labels appear once a render from this environment is approved as the baseline.";

test('the #256 case: a space added, three runs pushed by it, nothing outside text', () => {
  assert.equal(
    textSummary(REFLOW),
    'Copy, reflow: 3 copy changes, 3 runs moved. No pixels changed outside text.'
  );
  assert.deepEqual(textLines(REFLOW), [
    'Copy: "1" → "1␠" (whitespace only: a space added)',
    '"new · of 1" moved 4.2px right, and 2 more runs the same way, pushed by the copy change "1" → "1␠"',
    'Copy: "1" → "1␠" (whitespace only: a space added)',
    'Copy: "1" → "1␠" (whitespace only: a space added)',
    'No pixels changed outside text.',
  ]);
});

test('every change kind, more changes than listed, pixels outside text, and a truncated record', () => {
  assert.equal(
    textSummary(MIXED),
    'Pixel change: 1 copy change, 1 run restyled, 1 run added, 1 run removed. 1,300 changed pixels outside text, besides 40 in boxes a copy change moved or resized.'
  );
  assert.deepEqual(textLines(MIXED), [
    'Copy: "Total" → "Sum", font weight changed too',
    '"Overview": font size and line height changed, moved 2px down',
    'Added: "Beta"',
    'Removed: "Legacy"',
    'And 21 more changes.',
    '1,300 changed pixels outside text, besides 40 in boxes a copy change moved or resized.',
    'Text past the capture cap (5,000 runs) is not compared.',
  ]);
});

test('the states that compare nothing: one sentence each, none of them an error but the error', () => {
  assert.deepEqual(textLines(ENV_DIFFERS), [ENV_SENTENCE]);
  assert.doesNotMatch(ENV_SENTENCE, /\b(you|your|error|fail\w*)\b|\?/i);
  assert.deepEqual(textLines(NO_BASELINE), [
    'No text record in the baseline. One is recorded at its next approval.',
  ]);
  assert.deepEqual(textLines(ERROR), [
    "Text record not read: the baseline's text record: not a text record",
  ]);
  assert.deepEqual(textLines(SAME), ['No text changed.']);
  assert.deepEqual(textLines({ ...SAME, kind: 'pixel', outsidePx: 9 }), [
    'No text changed. The change is outside text.',
  ]);
  assert.deepEqual(textLines(undefined), []);
  assert.equal(textSummary(undefined), null);
});

test('moves, rewraps and whitespace in words', () => {
  const at = { path: '0/#0', box: /** @type {[number, number, number, number]} */ ([0, 0, 1, 1]) };
  assert.equal(
    sayChange({ kind: 'moved', s: 'Card', dx: -1.5, dy: -3, ...at }),
    '"Card" moved 1.5px left and 3px up'
  );
  assert.equal(
    sayChange({ kind: 'rewrapped', s: 'A long label', dx: 0, dy: 18, pushed: true, ...at }),
    '"A long label" rewrapped, moved 18px down, pushed by a copy change'
  );
  assert.equal(
    sayChange({ kind: 'copy', was: 'a  b', now: 'a b', whitespace: true, ...at }),
    'Copy: "a␠␠b" → "a␠b" (whitespace only: a space removed)'
  );
  assert.equal(
    sayChange({ kind: 'copy', was: 'Line\tone', now: 'Line one\nmore', ...at }),
    'Copy: "Line⇥one" → "Line one↵more"'
  );
  const long = 'x'.repeat(100);
  assert.equal(sayChange({ kind: 'added', s: long, ...at }), `Added: "${'x'.repeat(79)}…"`);
});

test('the copy is neutral: no "you", no questions', () => {
  const all = [REFLOW, MIXED, SAME, ENV_DIFFERS, NO_BASELINE, ERROR].flatMap((t) => [
    ...textLines(t),
    textSummary(t),
  ]);
  for (const line of all) assert.doesNotMatch(String(line), /\byou(r)?\b|\?/i, String(line));
});

test('textBoxes: each listed change where the render draws it, and where a moved run was', () => {
  assert.deepEqual(textBoxes(REFLOW), [
    [12, 40, 12.27, 18],
    [28.2, 40, 61, 18],
    [24, 40, 61, 18],
    [112, 40, 12.27, 18],
    [212, 40, 12.27, 18],
  ]);
  assert.deepEqual(textBoxes(SAME), []);
  assert.deepEqual(textBoxes(ENV_DIFFERS), []);
  assert.deepEqual(textBoxes(undefined), []);
});

test('the brief: the kind and its summary, the state that compared nothing, or nothing', () => {
  assert.deepEqual(textBrief(REFLOW), {
    textKind: 'copy-reflow',
    textSummary: 'Copy, reflow: 3 copy changes, 3 runs moved. No pixels changed outside text.',
  });
  assert.deepEqual(textBrief(SAME), { textKind: null });
  assert.deepEqual(textBrief(ENV_DIFFERS), { textState: 'env-differs', textSummary: ENV_SENTENCE });
  assert.deepEqual(textBrief(undefined), {});
});

test('the text filter: an entry kind, or any text change', () => {
  assert.deepEqual(TEXT_FILTERS, ['copy', 'copy-reflow', 'moved', 'restyled', 'any']);
  assert.equal(textMatches(REFLOW, 'copy-reflow'), true);
  assert.equal(textMatches(REFLOW, 'copy'), false);
  assert.equal(textMatches(REFLOW, 'any'), true);
  assert.equal(textMatches(MIXED, 'any'), true, 'a pixel change with text changes too');
  assert.equal(textMatches(SAME, 'any'), false);
  assert.equal(textMatches(ENV_DIFFERS, 'any'), false);
  assert.equal(textMatches(undefined, 'any'), false);
});

test('labels and suffixes: every kind but pixel has a suffix', () => {
  assert.equal(textKindLabel('copy-reflow'), 'Copy, reflow');
  assert.equal(textKindLabel(null), null);
  assert.deepEqual(Object.keys(TEXT_KIND_LABEL), [
    'copy',
    'copy-reflow',
    'moved',
    'restyled',
    'pixel',
  ]);
  assert.equal(textSuffix('copy-reflow'), 'text: copy, reflow');
  assert.equal(textSuffix('pixel'), '');
  assert.equal(textSuffix(null), '');
});

test("summary.md's suffix (the engine's) is said in the same words", () => {
  const rs = readFileSync(
    new URL('../../../crates/pxsig-cli/src/report_text.rs', import.meta.url),
    'utf8'
  );
  const arms = [...rs.matchAll(/Some\("([a-z-]+)"\) => "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(arms), TEXT_SUFFIX);
  assert.match(rs, /format!\(" · text: \{kind\}"\)/);
});
