/**
 * approve-story.test.mjs — approving a story's entries together (lib/approvals/story.mjs): off
 * unless `approvals.byStory` is true, and which entries a batch leaves out, with why.
 *
 *   node --test packages/pxsig/test/approve-story.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byStory, storySkip } from '../src/lib/approvals/story.mjs';

test('approving a story together is off unless the config says true', () => {
  assert.equal(byStory(null), false);
  assert.equal(byStory({}), false);
  assert.equal(byStory({ approvals: {} }), false);
  assert.equal(byStory({ approvals: { byStory: false } }), false);
  assert.equal(byStory({ approvals: { byStory: true } }), true);
});

test('a batch takes changed and new entries, and says why it leaves out the others', () => {
  const row = (/** @type {object} */ o) =>
    /** @type {import('../src/types.js').CheckRow} */ ({ id: 'a--b', pass: false, ...o });
  assert.equal(storySkip(undefined, row({})), null, 'changed');
  assert.equal(storySkip(undefined, row({ pass: true, new: true })), null, 'new');
  assert.equal(storySkip('approved', row({})), 'already approved');
  assert.equal(storySkip('rejected', row({})), 'rejected: decide on it alone');
  assert.equal(storySkip(undefined, undefined), 'not checked yet');
  assert.equal(storySkip(undefined, row({ skipped: true })), 'not checked yet');
  assert.equal(storySkip(undefined, row({ error: 'boom\nstack' })), 'did not render (boom)');
  assert.equal(storySkip(undefined, row({ pass: true })), 'passes: nothing to approve');
});
