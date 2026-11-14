/**
 * The source-parity page (scripts/parity-check.mjs, packages/pxsig/src/dashboard-check/parity.mjs):
 * one contract component, as the adapter draws it, with the props a pair in the adapter's
 * conformance.json gives (`window.__pxsigParity`, set before the page loads), on the dashboard's
 * own page styles, in the theme the URL names (`?theme=`). The component is the first element of
 * `[data-parity-frame]`, a block with the same 2rem inset the design system's stories have, so
 * both sit on whole pixels.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as UI from '@ui';
import '../src/styles/base.css';

interface ParitySpec {
  component: string;
  props?: Record<string, unknown>;
  children?: string;
}
declare global {
  interface Window {
    __pxsigParity?: ParitySpec;
  }
}

const spec = window.__pxsigParity ?? { component: '' };
// The contract's components by name: a pair names one (conformance.json).
const Component = (UI as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[
  spec.component
];

createRoot(document.getElementById('root')!).render(
  <UI.UiRoot>
    <div data-parity-frame="" style={{ padding: '2rem' }}>
      {Component ? (
        <Component {...spec.props}>{spec.children}</Component>
      ) : (
        <p data-parity-missing="">{spec.component}</p>
      )}
    </div>
  </UI.UiRoot>
);
