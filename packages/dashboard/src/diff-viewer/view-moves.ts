/**
 * The view changes the Viewport makes (DiffViewer.tsx): register its element, pan, drag, and run
 * a fit or focus that waited for the first pane's size. They live in the Root, which owns the
 * view's refs, so the Viewport holds no ref of its own and passes only these functions to a
 * render prop.
 */
import React from 'react';

type View = { z: number; tx: number; ty: number };

export function useViewMoves(
  viewportRef: React.RefObject<HTMLElement | null>,
  viewRef: React.RefObject<View>,
  pendingRef: React.RefObject<(() => void) | null>,
  place: () => void
) {
  const drag = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const setViewport = React.useCallback(
    (el: HTMLElement | null) => {
      viewportRef.current = el;
    },
    [viewportRef]
  );
  const panBy = React.useCallback(
    (dx: number, dy: number) => {
      viewRef.current = {
        ...viewRef.current,
        tx: viewRef.current.tx + dx,
        ty: viewRef.current.ty + dy,
      };
      place();
    },
    [viewRef, place]
  );
  const dragStart = React.useCallback(
    (x: number, y: number) => {
      drag.current = { x, y, tx: viewRef.current.tx, ty: viewRef.current.ty };
    },
    [viewRef]
  );
  const dragMove = React.useCallback(
    (x: number, y: number) => {
      const d = drag.current;
      if (!d) return;
      viewRef.current = { ...viewRef.current, tx: d.tx + x - d.x, ty: d.ty + y - d.y };
      place();
    },
    [viewRef, place]
  );
  const dragEnd = React.useCallback(() => {
    drag.current = null;
  }, []);
  const runPending = React.useCallback(() => {
    const run = pendingRef.current;
    pendingRef.current = null;
    run?.();
  }, [pendingRef]);
  return { setViewport, panBy, dragStart, dragMove, dragEnd, runPending };
}
