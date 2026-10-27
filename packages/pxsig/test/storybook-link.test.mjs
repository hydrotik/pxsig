// The dashboard's "Open in Storybook" link: story id plus the entry's globals. No server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storybookLink } from '../../dashboard/src/storybook-link.mjs';

const base = 'http://localhost:6006/';
const modes = {
  dark: { globals: 'theme:dark;colorway:default' },
  light: { globals: 'theme:light;colorway:default' },
};

test('a plain story with no globals links to the story alone', () => {
  const l = storybookLink(base, { id: 'a-b--c', story: 'a-b--c', mode: null, state: null });
  assert.equal(l.url, 'http://localhost:6006/?path=/story/a-b--c');
  assert.equal(l.state, null);
});

test("an @light entry opens in its mode's globals", () => {
  const l = storybookLink(
    base,
    { id: 'a-b--c@light', story: 'a-b--c', mode: 'light', state: null },
    modes
  );
  assert.equal(
    l.url,
    'http://localhost:6006/?path=/story/a-b--c&globals=theme:light;colorway:default'
  );
});

test("the entry's own globals win over the mode table, and values are encoded", () => {
  const l = storybookLink(
    base,
    {
      id: 'x@air',
      story: 'x',
      mode: 'dark',
      state: null,
      globals: 'theme:dark; colorway:lime;preset:air;typeface:mono sans',
    },
    modes
  );
  assert.equal(l.globals, 'theme:dark;colorway:lime;preset:air;typeface:mono%20sans');
  assert.match(l.url, /&globals=theme:dark;colorway:lime;preset:air;typeface:mono%20sans$/);
});

test('an interaction state is returned for a note, not put in the URL', () => {
  const l = storybookLink(
    base,
    { id: 'g--d__cleared@light', story: 'g--d', mode: 'light', state: 'cleared' },
    modes
  );
  assert.equal(l.state, 'cleared');
  assert.doesNotMatch(l.url, /cleared/);
  assert.equal(
    l.url,
    'http://localhost:6006/?path=/story/g--d&globals=theme:light;colorway:default'
  );
});
