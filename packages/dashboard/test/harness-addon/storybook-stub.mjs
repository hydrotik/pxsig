/**
 * The parts of Storybook's manager the addon uses (storybook/manager-api, storybook/internal/
 * components, storybook/theming), as far as the panel test needs them: the registered panel is
 * kept for main.mjs to render, the story and theme come from the page's query, and the status
 * store records what it is given on `window.__statuses`.
 */
import React from 'react';

const q = new URLSearchParams(window.location.search);
/** @type {{ register?: () => void, panel?: { title: string, render: (p: { active: boolean }) => React.ReactNode } }} */
export const captured = {};

export const types = { PANEL: 'panel' };
export const addons = {
  register: (/** @type {string} */ _name, /** @type {() => void} */ fn) => {
    captured.register = fn;
  },
  add: (/** @type {string} */ _id, /** @type {NonNullable<typeof captured.panel>} */ def) => {
    captured.panel = def;
  },
};
export const experimental_getStatusStore = () => ({
  set: (/** @type {unknown[]} */ list) => {
    /** @type {{ __statuses?: unknown[] }} */ (window).__statuses = list;
  },
  unset: () => {},
});
export const useStorybookState = () => ({ storyId: q.get('story') ?? 'ui-button--primary' });
export const useTheme = () => ({ base: q.get('theme') ?? 'dark' });
export function AddonPanel(/** @type {{ active: boolean, children: React.ReactNode }} */ p) {
  return p.active ? React.createElement('div', { 'data-addon-panel': '' }, p.children) : null;
}
