/**
 * The inspector's moves (Inspector.tsx): to a change (N, the change list), to a box (the text
 * section), and to the next or previous entry of the list (J, K, the arrows). Stable callbacks
 * (useStableCallback), so the memoised controls that take them skip the inspector's other renders.
 */
import type React from 'react';
import type { Row } from '../data';
import type { DiffViewerActions } from '../diff-viewer';
import { useStableCallback } from '../parts/useStableCallback';
import type { InspectTarget } from './Inspector';

type Box = { x: number; y: number; w: number; h: number };

export function useInspectorNav({
  regions,
  region,
  setRegion,
  stage,
  target,
  list,
  index,
  onNavigate,
}: {
  regions: Box[];
  region: number;
  setRegion: (i: number) => void;
  stage: React.RefObject<DiffViewerActions | null>;
  target: InspectTarget | null;
  list: Row[];
  index: number;
  onNavigate: (t: InspectTarget) => void;
}) {
  const focusRegion = useStableCallback((i: number) => {
    const r = regions[i];
    if (!r) return;
    setRegion(i);
    stage.current?.focus(r);
  });
  const focusBox = useStableCallback((r: Box) => {
    setRegion(-1);
    stage.current?.focus(r);
  });
  const stepRegion = useStableCallback(
    (d: number) =>
      regions.length &&
      focusRegion(
        region < 0
          ? d > 0
            ? 0
            : regions.length - 1
          : (region + d + regions.length) % regions.length
      )
  );
  const step = useStableCallback((d: number) => {
    if (!target || list.length < 2) return;
    let i = index;
    do i = (i + d + list.length) % list.length;
    while (!list[i].metrics && !(list[i].new && !list[i].pending) && i !== index);
    onNavigate({ ...target, row: list[i] });
  });
  return { focusRegion, focusBox, stepRegion, step };
}
