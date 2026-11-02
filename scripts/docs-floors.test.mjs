/**
 * The Storybook version the docs name for the addon is its peer floor (packages/storybook-addon
 * `peerDependencies.storybook`), so a project that trusts a page never gets ERESOLVE from npm.
 * Each page and the sentence that names the version are listed; a page that stops naming it
 * fails here too, so the list stays true.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (/** @type {string} */ f) => readFileSync(`${repo}${f}`, 'utf8');

const peer = JSON.parse(read('packages/storybook-addon/package.json')).peerDependencies.storybook;
const floor = /^>=(\d+)$/.exec(peer)?.[1];

/** Each page, and a pattern whose first group is the major it names for the addon. */
const PAGES = [
  ['README.md', /the addon needs (\d+) or later/],
  ['docs/storybook.md', /The addon needs Storybook (\d+) or later/],
  ['docs/migrating.md', /`@pxsig\/storybook-addon`, `storybook >=(\d+)`/],
  ['packages/storybook-addon/README.md', /Requires Storybook (\d+) or later/],
];

test("the addon's Storybook floor is a plain major", () => {
  assert.ok(floor, `peerDependencies.storybook is "${peer}", expected ">=<major>"`);
});

for (const [page, pattern] of PAGES)
  test(`${page} names the addon's Storybook floor`, () => {
    const named = pattern.exec(read(page))?.[1];
    assert.ok(named, `${page} no longer matches ${pattern}: update this test's list`);
    assert.equal(named, floor, `${page} says Storybook ${named}; the addon needs ${peer}`);
  });
