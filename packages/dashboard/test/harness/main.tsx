/**
 * A page for the diff-viewer tests: two generated images in a Root, every part rendered with its
 * defaults. `window.harness.mount(options)` re-renders it controlled or not; callbacks are logged
 * to `window.harness.log`.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DiffViewer, type DiffMode } from '../../src/diff-viewer';

const canvas = (w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  paint(c.getContext('2d')!);
  return c;
};
const baseline = canvas(40, 20, (c) => ((c.fillStyle = '#000000'), c.fillRect(0, 0, 40, 20)));
const latest = canvas(
  40,
  20,
  (c) => (
    (c.fillStyle = '#000000'),
    c.fillRect(0, 0, 40, 20),
    (c.fillStyle = '#ff0000'),
    c.fillRect(10, 5, 4, 4)
  )
);

interface Options {
  mode?: DiffMode;
  split?: number;
  activeRegion?: number;
}
const log: unknown[][] = [];
const root = createRoot(document.getElementById('root')!);
const actions = React.createRef<import('../../src/diff-viewer').DiffViewerActions>();

function mount(o: Options = {}) {
  log.length = 0;
  root.render(
    <DiffViewer.Root
      baseline={baseline}
      latest={latest}
      mode={o.mode}
      onModeChange={(m) => log.push(['mode', m])}
      split={o.split}
      onSplitChange={(v) => log.push(['split', v])}
      activeRegion={o.activeRegion}
      onZoomChange={(z) => log.push(['zoom', z])}
      actionsRef={actions}
    >
      <DiffViewer.ModeGroup label="View" />
      <DiffViewer.ZoomControls />
      <div style={{ inlineSize: '400px', blockSize: '200px', display: 'grid' }}>
        <DiffViewer.Viewport label="Image stage" className={(st) => `stage stage-${st.mode}`}>
          <DiffViewer.Pane className="pane">
            <DiffViewer.Frame className="frame">
              <DiffViewer.Layer kind="baseline" />
              <DiffViewer.Layer kind="latest" clip="split" />
              <DiffViewer.Regions
                regions={[
                  { x: 10, y: 5, w: 4, h: 4 },
                  { x: 0, y: 0, w: 2, h: 2 },
                ]}
                tiles={{ indices: [0], size: 8 }}
              />
            </DiffViewer.Frame>
            <DiffViewer.Marker className="marker" />
            <DiffViewer.SwipeHandle label="Swipe" />
          </DiffViewer.Pane>
        </DiffViewer.Viewport>
      </div>
      <DiffViewer.Probe>
        {(p) => (
          <output id="probe">
            {p ? `${p.x},${p.y} ${p.baseline?.join('/')} ${p.latest?.join('/')}` : 'none'}
          </output>
        )}
      </DiffViewer.Probe>
    </DiffViewer.Root>
  );
}

const style = document.createElement('style');
style.textContent =
  '.pane{position:relative;overflow:hidden;inline-size:400px;block-size:200px}.frame{position:absolute;top:0;left:0;transform-origin:0 0}.frame>*{position:absolute;inset:0}.marker{position:absolute}[data-handle]{position:absolute;inset-block:0;inline-size:8px}';
document.head.appendChild(style);
Object.assign(window, { harness: { mount, log, actions } });
mount();
