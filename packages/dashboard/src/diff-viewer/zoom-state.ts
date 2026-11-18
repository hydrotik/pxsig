/**
 * ZoomControls' state (DiffViewer.tsx): the zoom and its four actions, held stable while the zoom
 * and the Root's actions are the same, so a memoised render of the controls skips the Root's
 * other renders.
 */
import React from 'react';
import type { DiffViewerActions, ZoomState } from './DiffViewer';

export function useZoomState(zoom: number, actions: DiffViewerActions, step: number): ZoomState {
  return React.useMemo(
    () => ({
      zoom,
      zoomIn: () => actions.zoomBy(step),
      zoomOut: () => actions.zoomBy(1 / step),
      fit: () => actions.fit(),
      actual: () => actions.zoomTo(1),
    }),
    [zoom, actions, step]
  );
}
