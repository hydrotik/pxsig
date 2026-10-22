/**
 * The inspector's image stage, composed from the diff-viewer primitives: which layers each mode
 * shows, and the dashboard's classes on them. Pan, zoom, the probe, the swipe handle and the view
 * state live in `DiffViewer.Root`, which the inspector wraps around its toolbar, this stage and its
 * side panel.
 */
import type React from 'react';
import type { Analysis } from './analyse';
import { DiffViewer, useDiffViewer } from '../diff-viewer';
import { t } from '../copy';
import * as s from '../dashboard.css';

export type { DiffMode as Mode, Probe } from '../diff-viewer';
export { canvasOf } from './analyse';

interface Props {
  analysis: Analysis | null;
  cells: HTMLCanvasElement | null;
  heatImg: HTMLImageElement | null;
  /** Rust detail tiles that tripped (row-major indices) + tile size. */
  tiles: { indices: number[]; tile: number } | null;
  labels: [string, string];
  onion: number;
  heat: number;
  showBoxes: boolean;
  showHighlight: boolean;
  showTiles: boolean;
  tol: number;
}

export function Stage(p: Props) {
  const { mode, baseline } = useDiffViewer();
  const boxes = (
    <DiffViewer.Regions
      className={s.boxes}
      regions={p.showBoxes ? (p.analysis?.regions ?? []) : []}
      tiles={p.showTiles && p.tiles ? { indices: p.tiles.indices, size: p.tiles.tile } : null}
    />
  );
  const pane = (label: string, layers: React.ReactNode, extra?: React.ReactNode) => (
    <DiffViewer.Pane className={s.vp}>
      <DiffViewer.Frame className={s.layer}>{layers}</DiffViewer.Frame>
      <span className={`${s.vpLabel} ${s.micro}`}>{label}</span>
      <DiffViewer.Marker className={s.marker} />
      {extra}
    </DiffViewer.Pane>
  );

  let panes: React.ReactNode;
  const [bl, al] = p.labels;
  if (!baseline) {
    // Nothing to compare against: every mode shows the one render.
    panes = pane(al, <DiffViewer.Layer kind="latest" />);
  } else if (mode === 'side') {
    panes = (
      <>
        {pane(
          bl,
          <>
            <DiffViewer.Layer kind="baseline" />
            {boxes}
          </>
        )}
        {pane(
          al,
          <>
            <DiffViewer.Layer kind="latest" />
            {p.analysis && p.showHighlight ? <DiffViewer.Layer kind="highlight" source={p.analysis.highlight} /> : null}
            {boxes}
          </>
        )}
      </>
    );
  } else if (mode === 'swipe') {
    panes = pane(
      `${bl} | ${al}`,
      <>
        <DiffViewer.Layer kind="latest" />
        <DiffViewer.Layer kind="baseline" clip="split" />
        {boxes}
      </>,
      <DiffViewer.SwipeHandle className={s.swipeHandle} label={t('inspector.stage.swipe')} />
    );
  } else if (mode === 'onion') {
    panes = pane(
      `${bl} → ${al} at ${p.onion}%`,
      <>
        <DiffViewer.Layer kind="baseline" />
        <DiffViewer.Layer kind="latest" opacity={p.onion / 100} />
        {boxes}
      </>
    );
  } else if (mode === 'diff') {
    panes = p.analysis
      ? pane(
          `changed pixels (Δ > ${p.tol})`,
          <>
            <DiffViewer.Layer kind="diff" source={p.analysis.diff} />
            {boxes}
          </>
        )
      : pane(
          'difference blend (black = identical)',
          <>
            <DiffViewer.Layer kind="baseline" />
            <DiffViewer.Layer kind="latest" blend="difference" />
          </>
        );
  } else {
    const overlay = p.cells ?? p.heatImg;
    panes = pane(
      `${al} + signature cells`,
      <>
        <DiffViewer.Layer kind="latest" />
        {overlay ? <DiffViewer.Layer kind="heat" source={overlay} stretch opacity={p.cells ? 1 : p.heat / 100} alpha={p.cells ? p.heat / 100 : 1} /> : null}
        {boxes}
      </>
    );
  }

  // The inspector has its own shortcuts (window-wide), so the stage's keys stay off.
  return (
    <DiffViewer.Viewport className={s.insStage} label={t('inspector.stage.label')} keyboard={false}>
      {panes}
    </DiffViewer.Viewport>
  );
}
