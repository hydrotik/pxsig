import React from 'react';
import '@hydrotik/design-system/fonts';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@hydrotik/theme-provider';
import { App } from './App';

// The dashboard defaults to the light theme (the design system's default is dark).
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="pxsig-dashboard-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
