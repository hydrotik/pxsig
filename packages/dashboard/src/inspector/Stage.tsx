/**
 * The image stage: one or two viewports sharing a zoom/pan transform. Pan and
 * zoom are applied imperatively (a ref'd transform, no React render per frame);
 * the layer contents re-render only when the mode or the analysis changes.
 */
import React from 'react';
import type { Region } from '../data';
import type { Analysis } from './analyse';
import { canvasOf } from './analyse';
import { t } from '../copy';
import * as s from '../dashboard.css';

export type Mode = 'side' | 'swipe' | 'onion' | 'diff' | 'heat';

export interface StageApi {
  fit(): void;
  zoomBy(k: number): void;
  zoomTo(z: number): void;
  focus(r: Region): void;
}

export interface Hover {
  ix: number;
  iy: number;
  before: number[] | null;
  after: number[] | null;
}

interface Props {
  mode: Mode;
  /** The baseline render. Null for a new entry: the stage shows `b` alone. */
  a: HTMLImageElement | null;
  b: HTMLImageElement;
  analysis: Analysis | null;
  cells: HTMLCanvasElement | null;
  heatImg: HTMLImageElement | null;
  /** Rust detail tiles that tripped (row-major indices) + tile size. */
  tiles: { indices: number[]; tile: number } | null;
  labels: [string, string];
  split: number;
  onion: number;
  heat: number;
  showBoxes: boolean;
  showHighlight: boolean;
  showTiles: boolean;
  activeRegion: number;
  tol: number;
  pa: ImageData | null;
  pb: ImageData | null;
  onSplit(v: number): void;
  onZoom(z: number): void;
  onHover(h: Hover | null): void;
}

function Paint({ draw, W, H, style }: { draw: (ctx: CanvasRenderingContext2D) => void; W: number; H: number; style?: React.CSSProperties }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
  });
  return <canvas ref={ref} width={W} height={H} style={style} />;
}

export const Stage = React.forwardRef<StageApi, Props>(function Stage(p, ref) {
  const W = Math.max(p.a?.naturalWidth ?? 0, p.b.naturalWidth);
  const H = Math.max(p.a?.naturalHeight ?? 0, p.b.naturalHeight);
  const stage = React.useRef<HTMLDivElement>(null);
  const view = React.useRef({ z: 1, tx: 0, ty: 0 });
  const drag = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const place = React.useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const { z, tx, ty } = view.current;
    el.querySelectorAll<HTMLElement>('[data-layer]').forEach((l) => (l.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`));
    el.querySelectorAll<HTMLElement>('[data-handle]').forEach((h) => (h.style.insetInlineStart = `${tx + (W * p.split * z) / 100}px`));
    el.style.setProperty('--z', String(z));
    if (z >= 2) el.setAttribute('data-pixelated', '');
    else el.removeAttribute('data-pixelated');
    p.onZoom(z);
  }, [W, p.split, p.onZoom]);

  // The viewport's size, or null while it has none: the Storybook panel mounts this page in a
  // hidden iframe, and a fit measured against 0 × 0 parks the image as a 25% thumbnail in the
  // corner. Calls made then wait in `pending` and run once the viewport is laid out.
  const vpSize = (): [number, number] | null => {
    const v = stage.current?.querySelector<HTMLElement>('[data-vp]');
    if (!v) return [800, 600];
    return v.clientWidth && v.clientHeight ? [v.clientWidth, v.clientHeight] : null;
  };
  const pending = React.useRef<(() => void) | null>(null);
  const api = React.useMemo<StageApi>(() => {
    const sized = (run: (w: number, h: number) => void) => () => {
      const s = vpSize();
      if (!s) return void (pending.current = () => run(...(vpSize() ?? [800, 600])));
      pending.current = null;
      run(...s);
    };
    return {
      fit: sized((w, h) => {
        // Fill the frame, anchored to the top (what switching modes showed and reads best):
        // centred horizontally, a small top margin, upscale capped at 2× for small components.
        const z = Math.min((w - 32) / W, (h - 32) / H, 2);
        view.current = { z, tx: (w - W * z) / 2, ty: 16 };
        place();
      }),
      zoomBy: (k) => sized((w, h) => zoomAround(view.current.z * k, w / 2, h / 2))(),
      zoomTo: (z) =>
        sized((w, h) => {
          view.current = { z, tx: (w - W * z) / 2, ty: Math.min(16, (h - H * z) / 2) };
          place();
        })(),
      focus: (r) =>
        sized((w, h) => {
          const z = Math.max(0.25, Math.min((w - 48) / r.w, (h - 48) / r.h, 12));
          view.current = { z, tx: w / 2 - (r.x + r.w / 2) * z, ty: h / 2 - (r.y + r.h / 2) * z };
          place();
        })(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, place]);
  React.useImperativeHandle(ref, () => api, [api]);
  // Run a deferred fit / focus as soon as the viewport gets a size.
  React.useEffect(() => {
    const v = stage.current?.querySelector<HTMLElement>('[data-vp]');
    if (!v) return;
    const ro = new ResizeObserver(() => {
      if (pending.current && v.clientWidth && v.clientHeight) {
        const run = pending.current;
        pending.current = null;
        run();
      }
    });
    ro.observe(v);
    return () => ro.disconnect();
  }, []);
  const zoomAround = (z: number, cx: number, cy: number) => {
    z = Math.max(0.05, Math.min(64, z));
    const v = view.current;
    view.current = { z, tx: cx - ((cx - v.tx) * z) / v.z, ty: cy - ((cy - v.ty) * z) / v.z };
    place();
  };
  React.useLayoutEffect(place);

  // wheel zoom needs a non-passive listener
  React.useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = (e.target as HTMLElement).closest('[data-vp]') ?? el.querySelector('[data-vp]');
      if (!v) return;
      const r = v.getBoundingClientRect();
      zoomAround(view.current.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      view.current = { ...view.current, tx: drag.current.tx + e.clientX - drag.current.x, ty: drag.current.ty + e.clientY - drag.current.y };
      place();
    }
    const v = (e.target as HTMLElement).closest<HTMLElement>('[data-vp]');
    if (!v) return;
    const r = v.getBoundingClientRect();
    const { z, tx, ty } = view.current;
    const ix = Math.floor((e.clientX - r.left - tx) / z);
    const iy = Math.floor((e.clientY - r.top - ty) / z);
    const inside = ix >= 0 && iy >= 0 && ix < W && iy < H;
    stage.current?.querySelectorAll<HTMLElement>('[data-marker]').forEach((mk) => {
      mk.hidden = !inside;
      const sz = Math.max(z, 1);
      if (inside) mk.style.cssText = `inset-inline-start:${tx + ix * z}px;inset-block-start:${ty + iy * z}px;inline-size:${sz}px;block-size:${sz}px`;
    });
    if (!inside) return p.onHover(null);
    const px = (img: ImageData | null) => {
      if (!img || ix >= img.width || iy >= img.height) return null;
      const i = (iy * img.width + ix) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    };
    p.onHover({ ix, iy, before: px(p.pa), after: px(p.pb) });
  };

  const boxes = () => {
    const regs = p.showBoxes ? p.analysis?.regions ?? [] : [];
    const t = p.showTiles ? p.tiles : null;
    if (!regs.length && !t?.indices.length) return null;
    const cols = t ? Math.ceil(W / t.tile) : 0;
    return (
      <svg className={s.boxes} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        {t?.indices.map((i) => (
          <rect key={`t${i}`} data-tile="" x={(i % cols) * t.tile} y={Math.floor(i / cols) * t.tile} width={t.tile} height={t.tile} />
        ))}
        {regs.map((r, i) => (
          <rect key={i} x={r.x - 0.5} y={r.y - 0.5} width={r.w + 1} height={r.h + 1} {...(i === p.activeRegion ? { 'data-on': '' } : {})} />
        ))}
      </svg>
    );
  };
  const img = (im: HTMLImageElement, style?: React.CSSProperties) => <Paint W={W} H={H} style={style} draw={(c) => c.drawImage(im, 0, 0)} />;

  const viewport = (label: string, kids: React.ReactNode, extra?: React.ReactNode) => (
    <div className={s.vp} data-vp="">
      <div className={s.layer} data-layer="" style={{ inlineSize: W, blockSize: H }}>
        {kids}
      </div>
      <span className={`${s.vpLabel} ${s.micro}`}>{label}</span>
      <div className={s.marker} data-marker="" hidden />
      {extra}
    </div>
  );

  let views: React.ReactNode;
  const [bl, al] = p.labels;
  if (!p.a) {
    // Nothing to compare against: every mode shows the one render.
    views = viewport(al, img(p.b));
  } else if (p.mode === 'side') {
    views = (
      <>
        {viewport(bl, <>{img(p.a)}{boxes()}</>)}
        {viewport(al, <>{img(p.b)}{p.analysis && p.showHighlight ? <Paint W={W} H={H} draw={(c) => c.drawImage(p.analysis!.highlight, 0, 0)} /> : null}{boxes()}</>)}
      </>
    );
  } else if (p.mode === 'swipe') {
    const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const h = e.currentTarget;
      h.setPointerCapture(e.pointerId);
      const vpEl = h.parentElement!;
      const move = (ev: PointerEvent) => {
        const r = vpEl.getBoundingClientRect();
        const ix = (ev.clientX - r.left - view.current.tx) / view.current.z;
        p.onSplit(Math.round(Math.max(0, Math.min(100, (ix / W) * 100))));
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', () => h.removeEventListener('pointermove', move), { once: true });
    };
    views = viewport(
      `${bl} | ${al}`,
      <>
        {img(p.b)}
        {img(p.a, { clipPath: `inset(0 ${100 - p.split}% 0 0)` })}
        {boxes()}
      </>,
      <div
        className={s.swipeHandle}
        data-handle=""
        role="slider"
        tabIndex={0}
        aria-label={t('inspector.stage.swipe')}
        aria-valuenow={p.split}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={handleDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') p.onSplit(Math.max(0, p.split - 2));
          if (e.key === 'ArrowRight') p.onSplit(Math.min(100, p.split + 2));
        }}
      />
    );
  } else if (p.mode === 'onion') {
    views = viewport(`${bl} → ${al} at ${p.onion}%`, <>{img(p.a)}{img(p.b, { opacity: p.onion / 100 })}{boxes()}</>);
  } else if (p.mode === 'diff') {
    views = p.analysis
      ? viewport(`changed pixels (Δ > ${p.tol})`, <><Paint W={W} H={H} draw={(c) => c.drawImage(p.analysis!.diff, 0, 0)} />{boxes()}</>)
      : viewport('difference blend (black = identical)', <>{img(p.a)}{img(p.b, { mixBlendMode: 'difference' })}</>);
  } else {
    const overlay = p.cells ?? p.heatImg;
    views = viewport(
      `${al} + signature cells`,
      <>
        {img(p.b)}
        {overlay ? <Paint W={W} H={H} style={{ opacity: p.cells ? 1 : p.heat / 100 }} draw={(c) => ((c.globalAlpha = p.cells ? p.heat / 100 : 1), c.drawImage(overlay, 0, 0, W, H))} /> : null}
        {boxes()}
      </>
    );
  }

  return (
    <div
      ref={stage}
      className={s.insStage}
      tabIndex={0}
      aria-label={t('inspector.stage.label')}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, tx: view.current.tx, ty: view.current.ty };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.currentTarget.setAttribute('data-grabbing', '');
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.removeAttribute('data-grabbing');
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        stage.current?.querySelectorAll<HTMLElement>('[data-marker]').forEach((m) => (m.hidden = true));
        p.onHover(null);
      }}
    >
      {views}
    </div>
  );
});

export { canvasOf };
