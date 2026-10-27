// The panel's look comes from Storybook's theme; the inspector and dashboard URLs carry its mode.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonStyle, dashboardUrl, panelColors, themeMode } from '../panel-style.mjs';

const dark = {
  base: 'dark',
  appBorderColor: 'hsl(0 0% 100% / 0.1)',
  appBorderRadius: 4,
  color: { defaultText: '#C9CCCF' },
  background: { content: '#222325' },
  input: {
    background: '#1B1C1D',
    border: 'hsl(0 0% 100% / 0.1)',
    borderRadius: 4,
    color: '#C9CCCF',
  },
};
const light = {
  base: 'light',
  appBorderColor: 'hsl(212 50% 30% / 0.15)',
  color: { defaultText: '#2E3438' },
  background: { content: '#FFFFFF' },
  input: {
    background: '#FFFFFF',
    border: 'hsl(212 50% 30% / 0.15)',
    borderRadius: 4,
    color: '#2E3438',
  },
};

test("the mode is the theme's base, else read from its background", () => {
  assert.equal(themeMode(dark), 'dark');
  assert.equal(themeMode(light), 'light');
  assert.equal(themeMode({ background: { content: '#101010' } }), 'dark');
  assert.equal(themeMode({ background: { content: '#fafafa' } }), 'light');
  assert.equal(themeMode(undefined), 'light');
});

test("buttons take Storybook's input colours, so they change with its theme", () => {
  assert.deepEqual([buttonStyle(dark).color, buttonStyle(dark).background], ['#C9CCCF', '#1B1C1D']);
  assert.deepEqual(
    [buttonStyle(light).color, buttonStyle(light).background],
    ['#2E3438', '#FFFFFF']
  );
  assert.notEqual(buttonStyle(dark).border, buttonStyle(light).border);
  assert.equal(buttonStyle(dark, true).opacity, 0.5);
  // A theme without input colours still gets readable, inherited ones.
  assert.equal(buttonStyle({}).color, 'inherit');
  assert.equal(panelColors(dark).text, '#C9CCCF');
});

test('dashboard links carry the mode, the project, the story and the inspect hash', () => {
  assert.equal(
    dashboardUrl(
      'http://127.0.0.1:6070',
      { project: 'ui', story: 'a-b--c', hash: 'inspect=a-b--c%40light' },
      'dark'
    ),
    'http://127.0.0.1:6070/report/?project=ui&story=a-b--c&theme=dark#inspect=a-b--c%40light'
  );
  assert.equal(
    dashboardUrl('http://x', { project: null, embed: 1, story: 'a-b--c' }, 'light'),
    'http://x/report/?embed=1&story=a-b--c&theme=light'
  );
});
