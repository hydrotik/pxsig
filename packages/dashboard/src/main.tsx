import React from 'react';
import { createRoot } from 'react-dom/client';
import { UiRoot } from '@ui';
import { App } from './App';
import { Decide } from './views/Decide';

// `?decide=1` is the small window the Storybook panel decides through (link.ts).
const decideWindow = new URLSearchParams(location.search).has('decide');

// The theme mode is the contract runtime's (light by default); the adapter's provider applies it.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiRoot>{decideWindow ? <Decide /> : <App />}</UiRoot>
  </React.StrictMode>
);
