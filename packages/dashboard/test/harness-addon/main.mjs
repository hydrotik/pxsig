// The addon's manager.mjs, registered and rendered as Storybook would, on the stubbed manager.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../storybook-addon/manager.mjs';
import { captured } from './storybook-stub.mjs';

captured.register?.();
const panel = captured.panel;
createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  panel
    ? React.createElement(() => panel.render({ active: true }))
    : React.createElement('p', null, 'no panel registered')
);
