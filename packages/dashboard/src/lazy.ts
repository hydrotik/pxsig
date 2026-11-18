/**
 * The parts of the dashboard loaded on first use (App.tsx): the inspector with the diff viewer,
 * and the Review, Accessibility, Runs and Help sections. The served dashboard fetches each as its
 * own chunk; the classic build `pxsig report` uses has them inline (build-config.mjs).
 *
 * The page shows no loading state. App changes section in a transition, so the section on screen
 * stays until the next one is in. And a part is fetched before it is needed: the ones the address
 * opens on before the first render (main.tsx `preloadFor`), the others once the page is idle
 * (`preloadAll`). A part whose code is in renders at once; React would otherwise wait out its
 * fallback throttle (about 300 ms) before showing a part that suspended.
 */
import React from 'react';

/**
 * A part loaded on first use. Its component renders the part directly once its code is in, else
 * through React.lazy (it suspends); which one is decided once per mount, so the part keeps its
 * state when its code arrives.
 */
function part<P extends object>(load: () => Promise<React.ComponentType<P>>) {
  let loaded: React.ComponentType<P> | null = null;
  let pending: Promise<React.ComponentType<P>> | null = null;
  const preload = () =>
    (pending ??= load().then((c) => {
      loaded = c;
      return c;
    }));
  const Lazy = React.lazy(() => preload().then((c) => ({ default: c })));
  function Part(props: P) {
    const [Direct] = React.useState(() => loaded);
    return Direct ? React.createElement(Direct, props) : React.createElement(Lazy, props);
  }
  return Object.assign(Part, { preload });
}

export const Inspector = part(() => import('./inspector/Inspector').then((m) => m.Inspector));
export const Stories = part(() => import('./views/Stories').then((m) => m.Stories));
export const Accessibility = part(() =>
  import('./views/Accessibility').then((m) => m.Accessibility)
);
export const History = part(() => import('./views/History').then((m) => m.History));
export const Help = part(() => import('./views/Help').then((m) => m.Help));

const BY_SECTION: Record<string, { preload: () => Promise<unknown> }> = {
  stories: Stories,
  a11y: Accessibility,
  history: History,
  help: Help,
};

/**
 * The parts an address opens on (a section, an inspector deep link, the Storybook panel): fetched
 * before the first render, so the page does not draw without them first.
 */
export function preloadFor(search: string, hash: string): Promise<unknown> {
  const h = new URLSearchParams(
    hash.slice(1).includes('=') ? hash.slice(1) : `tab=${hash.slice(1)}`
  );
  const parts = [
    BY_SECTION[h.get('tab') ?? ''],
    h.get('inspect') || new URLSearchParams(search).get('embed') ? Inspector : null,
  ].filter((x) => !!x);
  return Promise.all(parts.map((x) => x.preload())).catch(() => {});
}

/** Every part, once the page is idle: none waits for its code when it first opens. */
export function preloadAll() {
  for (const x of [Inspector, Stories, Accessibility, History, Help])
    void x.preload().catch(() => {});
}
