/**
 * The parts of the dashboard loaded on first use (App.tsx): the inspector with the diff viewer,
 * and the Review, Accessibility, Runs and Help sections. The served dashboard fetches each as its
 * own chunk; the classic build `pxsig report` uses has them inline (build-config.mjs). The page
 * shows no loading state: App changes section in a transition, so the section on screen stays
 * until the next one is in.
 */
import React from 'react';

export const Inspector = React.lazy(() =>
  import('./inspector/Inspector').then((m) => ({ default: m.Inspector }))
);
export const Stories = React.lazy(() =>
  import('./views/Stories').then((m) => ({ default: m.Stories }))
);
export const Accessibility = React.lazy(() =>
  import('./views/Accessibility').then((m) => ({ default: m.Accessibility }))
);
export const History = React.lazy(() =>
  import('./views/History').then((m) => ({ default: m.History }))
);
export const Help = React.lazy(() => import('./views/Help').then((m) => ({ default: m.Help })));
