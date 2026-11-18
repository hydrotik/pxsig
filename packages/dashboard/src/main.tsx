import React from 'react';
import { createRoot } from 'react-dom/client';
import { UiRoot } from '@ui';
import { App } from './App';
import { Decide } from './views/Decide';
import { preloadAll, preloadFor } from './lazy';

// `?decide=1` is the small window the Storybook panel decides through (link.ts).
const decideWindow = new URLSearchParams(location.search).has('decide');

// The parts the address opens on first (lazy.ts), then the first render; then, once the page is
// idle, the other parts. The theme mode is the contract runtime's (light by default); the
// adapter's provider applies it.
void (decideWindow ? Promise.resolve() : preloadFor(location.search, location.hash)).then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <UiRoot>{decideWindow ? <Decide /> : <App />}</UiRoot>
    </React.StrictMode>
  );
  if (decideWindow) return;
  const idle = () =>
    'requestIdleCallback' in window ? requestIdleCallback(preloadAll) : setTimeout(preloadAll, 1);
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
});
