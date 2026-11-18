/**
 * A callback whose identity never changes and which calls the last render's function. Memoised
 * children given it skip the renders that only made a new callback. For events and effects: it
 * calls the last committed render's function, so never call it during render.
 */
import React from 'react';

export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const latest = React.useRef(fn);
  // Before any layout effect: a fit scheduled there already calls this render's function.
  React.useInsertionEffect(() => {
    latest.current = fn;
  });
  return React.useCallback((...args: A): R => latest.current(...args), []);
}
