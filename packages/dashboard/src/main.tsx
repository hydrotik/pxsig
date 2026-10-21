import React from 'react';
import { createRoot } from 'react-dom/client';
import { UiRoot } from '@ui';
import { App } from './App';

// The theme mode is the contract runtime's (light by default); the adapter's provider applies it.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiRoot>
      <App />
    </UiRoot>
  </React.StrictMode>
);
