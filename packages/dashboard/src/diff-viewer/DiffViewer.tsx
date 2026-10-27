/**
 * DiffViewer: compound, unstyled, accessible parts for comparing a baseline image with its latest
 * render. No CSS ships with it and no design system is involved: every part exposes its state as
 * `data-*` attributes, the shared geometry as CSS custom properties, and takes `className` (a string,
 * or a function of the part's state) and `render` (replace the element, keep the behaviour).
 *
 *   <DiffViewer.Root baseline={img} latest={img} mode={mode} onModeChange={setMode} actionsRef={ref}>
 *     <DiffViewer.ModeGroup label="View" />
 *     <DiffViewer.ZoomControls />
 *     <DiffViewer.Viewport label="Image stage">
 *       <DiffViewer.Pane>
 *         <DiffViewer.Frame>
 *           <DiffViewer.Layer kind="baseline" />
 *           <DiffViewer.Regions regions={regions} />
 *         </DiffViewer.Frame>
 *         <DiffViewer.Marker />
 *       </DiffViewer.Pane>
 *     </DiffViewer.Viewport>
 *     <DiffViewer.Probe>{(probe) => probe && `${probe.x}, ${probe.y}`}</DiffViewer.Probe>
 *   </DiffViewer.Root>
 *
 * Root renders no element: it holds the state (mode, swipe split, active region: each controlled or
 * not), the view transform and the pointer probe, so its parts can sit anywhere inside it (a
 * toolbar, the stage, a side panel). Pan and zoom are applied without a React render per frame:
 * the Viewport's custom properties change, and only ZoomControls and Probe re-render.
 *
 * Custom properties, set on the Viewport element:
 *   --dv-tx, --dv-ty     the image's offset in each pane (px)
 *   --dv-zoom            the scale (a number; divide stroke widths by it for constant lines)
 *   --dv-split-x         the swipe handle's offset in its pane (px)
 *   --dv-marker-x, --dv-marker-y, --dv-marker-size   the probed pixel's box (px)
 * Data attributes: Viewport [data-mode] [data-grabbing] [data-pixelated] (zoom ≥ 2); Pane
 * [data-pane]; Frame [data-frame]; Layer [data-kind]; Region [data-active]; Tile [data-tile];
 * Marker [data-visible]; ModeGroup items [data-mode] [data-checked]; SwipeHandle [data-dragging].
 */
import React from 'react';

// --- types ---------------------------------------------------------------------------------------

export type DiffMode = 'side' | 'swipe' | 'onion' | 'diff' | 'heat';
export const DIFF_MODES: readonly DiffMode[] = ['side', 'swipe', 'onion', 'diff', 'heat'];

/** An image, canvas or bitmap: anything 2D canvases draw. */
export type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
export interface DiffRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** The pixel under the pointer, in image coordinates, with both images' RGBA values there. */
export interface Probe {
  x: number;
  y: number;
  baseline: number[] | null;
  latest: number[] | null;
}
/** Imperative view changes (Root's `actionsRef`). Each waits until the viewport has a size. */
export interface DiffViewerActions {
  fit(): void;
  zoomBy(factor: number): void;
  zoomTo(zoom: number): void;
  focus(region: DiffRegion): void;
}

type ClassName<S> = string | ((state: S) => string | undefined);
type Render<S> = (
  props: React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> },
  state: S
) => React.ReactElement;
const cls = <S,>(c: ClassName<S> | undefined, state: S) => (typeof c === 'function' ? c(state) : c);

const sizeOf = (s: Source | null) =>
  !s
    ? [0, 0]
    : s instanceof HTMLImageElement
      ? [s.naturalWidth, s.naturalHeight]
      : [s.width, s.height];

function pixelsOf(s: Source | null): ImageData | null {
  if (!s) return null;
  try {
    const [w, h] = sizeOf(s);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(s, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // a tainted canvas (file://): no probe values
  }
}

/** A value that is controlled when `value` is defined, else held here. */
function useControllable<T>(
  value: T | undefined,
  initial: T,
  onChange?: (v: T) => void
): [T, (v: T) => void] {
  const [own, setOwn] = React.useState(initial);
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  const set = React.useCallback(
    (v: T) => {
      if (!controlled) setOwn(v);
      onChange?.(v);
    },
    [controlled, onChange]
  );
  return [current, set];
}

/** A tiny external store: zoom and probe change per frame, and only their readers re-render. */
function createStore() {
  let snap: { zoom: number; probe: Probe | null } = { zoom: 1, probe: null };
  const subs = new Set<() => void>();
  return {
    get: () => snap,
    set(patch: Partial<typeof snap>) {
      if (Object.entries(patch).every(([k, v]) => snap[k as keyof typeof snap] === v)) return;
      snap = { ...snap, ...patch };
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

interface Ctx {
  W: number;
  H: number;
  baseline: Source | null;
  latest: Source | null;
  mode: DiffMode;
  setMode(m: DiffMode): void;
  modes: readonly DiffMode[];
  split: number;
  setSplit(v: number): void;
  activeRegion: number;
  setActiveRegion(i: number): void;
  store: ReturnType<typeof createStore>;
  actions: DiffViewerActions;
  /** The Viewport element registers itself here. */
  viewportRef: React.MutableRefObject<HTMLElement | null>;
  view: React.MutableRefObject<{ z: number; tx: number; ty: number }>;
  place(): void;
  zoomAround(z: number, cx: number, cy: number): void;
  probeAt(clientX: number, clientY: number, pane: HTMLElement): void;
  clearProbe(): void;
  pending: React.MutableRefObject<(() => void) | null>;
}
const DiffViewerContext = React.createContext<Ctx | null>(null);

/** The Root's state, for a custom part. */
export function useDiffViewer() {
  const c = React.useContext(DiffViewerContext);
  if (!c) throw new Error('DiffViewer parts must be inside <DiffViewer.Root>');
  return c;
}
const useStore = <T,>(pick: (s: { zoom: number; probe: Probe | null }) => T) => {
  const { store } = useDiffViewer();
  return React.useSyncExternalStore(store.subscribe, () => pick(store.get()));
};

// --- Root ----------------------------------------------------------------------------------------

export interface RootProps {
  /** The baseline image. Null for an entry with none yet: every mode shows `latest` alone. */
  baseline: Source | null;
  latest: Source | null;
  /** Pixel data for the probe. Read from the images when not given. */
  baselineData?: ImageData | null;
  latestData?: ImageData | null;
  mode?: DiffMode;
  defaultMode?: DiffMode;
  onModeChange?: (mode: DiffMode) => void;
  /** The modes offered by ModeGroup and its arrow keys. */
  modes?: readonly DiffMode[];
  /** Swipe position, 0–100 (percent of the width showing the baseline). */
  split?: number;
  defaultSplit?: number;
  onSplitChange?: (split: number) => void;
  /** The highlighted region's index, or -1. */
  activeRegion?: number;
  defaultActiveRegion?: number;
  onActiveRegionChange?: (index: number) => void;
  onZoomChange?: (zoom: number) => void;
  onProbeChange?: (probe: Probe | null) => void;
  actionsRef?: React.Ref<DiffViewerActions>;
  children: React.ReactNode;
}

function Root(p: RootProps) {
  const [bw, bh] = sizeOf(p.baseline);
  const [lw, lh] = sizeOf(p.latest);
  const W = Math.max(bw, lw);
  const H = Math.max(bh, lh);
  const [mode, setMode] = useControllable<DiffMode>(
    p.mode,
    p.defaultMode ?? 'side',
    p.onModeChange
  );
  const [split, setSplit] = useControllable<number>(p.split, p.defaultSplit ?? 50, p.onSplitChange);
  const [activeRegion, setActiveRegion] = useControllable<number>(
    p.activeRegion,
    p.defaultActiveRegion ?? -1,
    p.onActiveRegionChange
  );
  const store = React.useMemo(createStore, []);
  const viewportRef = React.useRef<HTMLElement | null>(null);
  const view = React.useRef({ z: 1, tx: 0, ty: 0 });
  const pending = React.useRef<(() => void) | null>(null);
  const onZoom = React.useRef(p.onZoomChange);
  onZoom.current = p.onZoomChange;
  const onProbe = React.useRef(p.onProbeChange);
  onProbe.current = p.onProbeChange;

  const place = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { z, tx, ty } = view.current;
    el.style.setProperty('--dv-tx', `${tx}px`);
    el.style.setProperty('--dv-ty', `${ty}px`);
    el.style.setProperty('--dv-zoom', String(z));
    el.style.setProperty('--dv-split-x', `${tx + (W * split * z) / 100}px`);
    if (z >= 2) el.setAttribute('data-pixelated', '');
    else el.removeAttribute('data-pixelated');
    store.set({ zoom: z });
    onZoom.current?.(z);
  }, [W, split, store]);

  // The first pane's size, or null while it has none (a hidden iframe, a collapsed panel): calls
  // made then wait in `pending` and run once it is laid out.
  const paneSize = (): [number, number] | null => {
    const v = viewportRef.current?.querySelector<HTMLElement>('[data-pane]');
    if (!v) return [800, 600];
    return v.clientWidth && v.clientHeight ? [v.clientWidth, v.clientHeight] : null;
  };
  const zoomAround = React.useCallback(
    (z: number, cx: number, cy: number) => {
      z = Math.max(0.05, Math.min(64, z));
      const v = view.current;
      view.current = { z, tx: cx - ((cx - v.tx) * z) / v.z, ty: cy - ((cy - v.ty) * z) / v.z };
      place();
    },
    [place]
  );
  const actions = React.useMemo<DiffViewerActions>(() => {
    const sized = (run: (w: number, h: number) => void) => () => {
      const s = paneSize();
      if (!s) return void (pending.current = () => run(...(paneSize() ?? [800, 600])));
      pending.current = null;
      run(...s);
    };
    return {
      // Fill the frame, anchored to the top: centred horizontally, a small top margin, upscale
      // capped at 2× for small images.
      fit: sized((w, h) => {
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
  }, [W, H, place, zoomAround]);
  React.useImperativeHandle(p.actionsRef, () => actions, [actions]);

  const data = React.useMemo(
    () => ({
      baseline: p.baselineData !== undefined ? p.baselineData : pixelsOf(p.baseline),
      latest: p.latestData !== undefined ? p.latestData : pixelsOf(p.latest),
    }),
    [p.baseline, p.latest, p.baselineData, p.latestData]
  );
  const probeAt = React.useCallback(
    (clientX: number, clientY: number, pane: HTMLElement) => {
      const el = viewportRef.current;
      const r = pane.getBoundingClientRect();
      const { z, tx, ty } = view.current;
      const x = Math.floor((clientX - r.left - tx) / z);
      const y = Math.floor((clientY - r.top - ty) / z);
      const inside = x >= 0 && y >= 0 && x < W && y < H;
      if (el) {
        el.style.setProperty('--dv-marker-x', `${tx + x * z}px`);
        el.style.setProperty('--dv-marker-y', `${ty + y * z}px`);
        el.style.setProperty('--dv-marker-size', `${Math.max(z, 1)}px`);
        el.querySelectorAll<HTMLElement>('[data-marker]').forEach((m) => {
          m.hidden = !inside;
          if (inside) m.setAttribute('data-visible', '');
          else m.removeAttribute('data-visible');
        });
      }
      const px = (img: ImageData | null) => {
        if (!img || x >= img.width || y >= img.height) return null;
        const i = (y * img.width + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
      };
      const probe = inside ? { x, y, baseline: px(data.baseline), latest: px(data.latest) } : null;
      store.set({ probe });
      onProbe.current?.(probe);
    },
    [W, H, data, store]
  );
  const clearProbe = React.useCallback(() => {
    viewportRef.current
      ?.querySelectorAll<HTMLElement>('[data-marker]')
      .forEach((m) => ((m.hidden = true), m.removeAttribute('data-visible')));
    store.set({ probe: null });
    onProbe.current?.(null);
  }, [store]);

  const modes = p.modes ?? DIFF_MODES;
  const value: Ctx = {
    W,
    H,
    baseline: p.baseline,
    latest: p.latest,
    mode,
    setMode,
    modes,
    split,
    setSplit,
    activeRegion,
    setActiveRegion,
    store,
    actions,
    viewportRef,
    view,
    place,
    zoomAround,
    probeAt,
    clearProbe,
    pending,
  };
  return <DiffViewerContext.Provider value={value}>{p.children}</DiffViewerContext.Provider>;
}

// --- Viewport ------------------------------------------------------------------------------------

export interface ViewportState {
  mode: DiffMode;
  grabbing: boolean;
}
export interface ViewportProps {
  /** Accessible name of the stage. */
  label: string;
  className?: ClassName<ViewportState>;
  style?: React.CSSProperties;
  /** Keys on the focused stage: + / − zoom, 0 actual size, F fit, arrows pan. Default on. */
  keyboard?: boolean;
  render?: Render<ViewportState>;
  children?: React.ReactNode;
}

/** The interactive stage: drag to pan, wheel to zoom, pointer to probe. Holds the panes. */
function Viewport({ label, className, style, keyboard = true, render, children }: ViewportProps) {
  const c = useDiffViewer();
  const drag = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [grabbing, setGrabbing] = React.useState(false);
  const local = React.useRef<HTMLElement | null>(null);
  const ref = React.useCallback(
    (el: HTMLElement | null) => {
      local.current = el;
      c.viewportRef.current = el;
    },
    [c.viewportRef]
  );
  React.useLayoutEffect(c.place);
  // A deferred fit / focus runs as soon as the first pane gets a size.
  React.useEffect(() => {
    const v = local.current?.querySelector<HTMLElement>('[data-pane]');
    if (!v) return;
    const ro = new ResizeObserver(() => {
      if (c.pending.current && v.clientWidth && v.clientHeight) {
        const run = c.pending.current;
        c.pending.current = null;
        run();
      }
    });
    ro.observe(v);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Wheel zoom needs a non-passive listener.
  React.useEffect(() => {
    const el = local.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = (e.target as HTMLElement).closest('[data-pane]') ?? el.querySelector('[data-pane]');
      if (!v) return;
      const r = v.getBoundingClientRect();
      c.zoomAround(
        c.view.current.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
        e.clientX - r.left,
        e.clientY - r.top
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const state: ViewportState = { mode: c.mode, grabbing };
  const props: React.HTMLAttributes<HTMLElement> & {
    ref: React.Ref<HTMLElement>;
    'data-mode': string;
    'data-grabbing'?: string;
  } = {
    ref,
    className: cls(className, state),
    style,
    tabIndex: 0,
    role: 'group',
    'aria-label': label,
    'aria-roledescription': 'image comparison',
    'data-mode': c.mode,
    ...(grabbing ? { 'data-grabbing': '' } : {}),
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, tx: c.view.current.tx, ty: c.view.current.ty };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setGrabbing(true);
    },
    onPointerUp: () => {
      drag.current = null;
      setGrabbing(false);
    },
    onPointerMove: (e) => {
      if (drag.current) {
        c.view.current = {
          ...c.view.current,
          tx: drag.current.tx + e.clientX - drag.current.x,
          ty: drag.current.ty + e.clientY - drag.current.y,
        };
        c.place();
      }
      const pane = (e.target as HTMLElement).closest<HTMLElement>('[data-pane]');
      if (pane) c.probeAt(e.clientX, e.clientY, pane);
    },
    onPointerLeave: () => c.clearProbe(),
    onKeyDown: (e) => {
      if (
        !keyboard ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.target !== e.currentTarget
      )
        return;
      const pan = (dx: number, dy: number) => (
        (c.view.current = {
          ...c.view.current,
          tx: c.view.current.tx + dx,
          ty: c.view.current.ty + dy,
        }),
        c.place()
      );
      const k = e.key;
      const run = (f: () => void) => (e.preventDefault(), f());
      if (k === '+' || k === '=') return run(() => c.actions.zoomBy(1.5));
      if (k === '-' || k === '_') return run(() => c.actions.zoomBy(1 / 1.5));
      if (k === '0') return run(() => c.actions.zoomTo(1));
      if (k === 'f' || k === 'F') return run(() => c.actions.fit());
      if (k === 'ArrowLeft') return run(() => pan(32, 0));
      if (k === 'ArrowRight') return run(() => pan(-32, 0));
      if (k === 'ArrowUp') return run(() => pan(0, 32));
      if (k === 'ArrowDown') return run(() => pan(0, -32));
    },
    children,
  };
  return render ? (
    render(props, state)
  ) : (
    <div {...(props as React.HTMLAttributes<HTMLDivElement>)} />
  );
}

// --- Pane, Frame, Layer --------------------------------------------------------------------------

export interface PaneProps {
  className?: ClassName<{ mode: DiffMode }>;
  render?: Render<{ mode: DiffMode }>;
  children?: React.ReactNode;
}
/** One view of the image (side by side has two). The probe and the wheel zoom measure from it. */
function Pane({ className, render, children }: PaneProps) {
  const { mode } = useDiffViewer();
  const props = { className: cls(className, { mode }), 'data-pane': '', children };
  return render ? render(props, { mode }) : <div {...props} />;
}

/** The image box, W × H, moved and scaled by the view (`--dv-tx`, `--dv-ty`, `--dv-zoom`). */
function Frame({
  className,
  render,
  children,
}: {
  className?: ClassName<{ zoom: number }>;
  render?: Render<{ width: number; height: number }>;
  children?: React.ReactNode;
}) {
  const { W, H } = useDiffViewer();
  const props = {
    className: cls(className, { zoom: 1 }),
    'data-frame': '',
    style: {
      inlineSize: W,
      blockSize: H,
      transform: 'translate(var(--dv-tx, 0px), var(--dv-ty, 0px)) scale(var(--dv-zoom, 1))',
    },
    children,
  };
  return render ? render(props, { width: W, height: H }) : <div {...props} />;
}

export interface LayerProps {
  /** Which image: `baseline`, `latest`, or an overlay (`diff`, `highlight`, `heat`) given as `source`. */
  kind: 'baseline' | 'latest' | 'diff' | 'highlight' | 'heat';
  /** The image to paint. Default: the Root's baseline or latest. */
  source?: Source | null;
  /** `split`: show only the part left of the swipe handle. */
  clip?: 'split';
  opacity?: number;
  /** Canvas global alpha while painting, 0–1. */
  alpha?: number;
  blend?: React.CSSProperties['mixBlendMode'];
  /** Scale the source to the frame (overlays at another resolution). */
  stretch?: boolean;
  className?: string;
}
/** One image painted at its pixel size onto a canvas the size of the frame, without smoothing. */
function Layer({ kind, source, clip, opacity, alpha, blend, stretch, className }: LayerProps) {
  const c = useDiffViewer();
  const src =
    source !== undefined
      ? source
      : kind === 'baseline'
        ? c.baseline
        : kind === 'latest'
          ? c.latest
          : null;
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, c.W, c.H);
    ctx.imageSmoothingEnabled = false;
    if (!src) return;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    if (stretch) ctx.drawImage(src, 0, 0, c.W, c.H);
    else ctx.drawImage(src, 0, 0);
    ctx.globalAlpha = 1;
  });
  const style: React.CSSProperties = {
    ...(clip === 'split' ? { clipPath: `inset(0 ${100 - c.split}% 0 0)` } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blend ? { mixBlendMode: blend } : {}),
  };
  return (
    <canvas
      ref={ref}
      width={c.W}
      height={c.H}
      className={className}
      data-kind={kind}
      style={Object.keys(style).length ? style : undefined}
    />
  );
}

// --- Regions -------------------------------------------------------------------------------------

export interface RegionsProps {
  regions: DiffRegion[];
  /** Changed tiles, by row-major index, of `size` px squares. */
  tiles?: { indices: number[]; size: number } | null;
  className?: string;
  /** Renders each region; default `<DiffViewer.Region>`. */
  children?: (region: DiffRegion, index: number) => React.ReactNode;
}
/** Region outlines and tiles over the image, as one SVG in image coordinates. Decorative. */
function Regions({ regions, tiles, className, children }: RegionsProps) {
  const { W, H } = useDiffViewer();
  if (!regions.length && !tiles?.indices.length) return null;
  const cols = tiles ? Math.ceil(W / tiles.size) : 0;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {tiles?.indices.map((i) => (
        <rect
          key={`t${i}`}
          data-tile=""
          x={(i % cols) * tiles.size}
          y={Math.floor(i / cols) * tiles.size}
          width={tiles.size}
          height={tiles.size}
        />
      ))}
      {regions.map((r, i) =>
        children ? (
          <React.Fragment key={i}>{children(r, i)}</React.Fragment>
        ) : (
          <Region key={i} region={r} index={i} />
        )
      )}
    </svg>
  );
}

/** One region's outline; `[data-active]` when it is the active region. */
function Region({ region: r, index }: { region: DiffRegion; index: number }) {
  const { activeRegion } = useDiffViewer();
  return (
    <rect
      x={r.x - 0.5}
      y={r.y - 0.5}
      width={r.w + 1}
      height={r.h + 1}
      {...(index === activeRegion ? { 'data-active': '' } : {})}
    />
  );
}

// --- Marker, SwipeHandle -------------------------------------------------------------------------

/** The probed pixel's box, positioned by `--dv-marker-*`. Hidden while the pointer is off the image. */
function Marker({ className, render }: { className?: string; render?: Render<object> }) {
  const props = {
    className,
    'data-marker': '',
    hidden: true,
    style: {
      insetInlineStart: 'var(--dv-marker-x)',
      insetBlockStart: 'var(--dv-marker-y)',
      inlineSize: 'var(--dv-marker-size)',
      blockSize: 'var(--dv-marker-size)',
    },
  };
  return render ? render(props, {}) : <div {...props} />;
}

export interface SwipeHandleProps {
  label: string;
  className?: ClassName<{ split: number; dragging: boolean }>;
  /** Arrow-key step, in percent. Default 2. */
  step?: number;
}
/** The swipe divider: a slider (0–100) dragged with the pointer or moved with the arrow keys. */
function SwipeHandle({ label, className, step = 2 }: SwipeHandleProps) {
  const c = useDiffViewer();
  const [dragging, setDragging] = React.useState(false);
  const set = (v: number) => c.setSplit(Math.round(Math.max(0, Math.min(100, v))));
  return (
    <div
      className={cls(className, { split: c.split, dragging })}
      data-handle=""
      {...(dragging ? { 'data-dragging': '' } : {})}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={c.split}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${c.split}%`}
      style={{ insetInlineStart: 'var(--dv-split-x)' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        const h = e.currentTarget;
        h.setPointerCapture?.(e.pointerId);
        setDragging(true);
        const pane = h.parentElement!;
        const move = (ev: PointerEvent) => {
          const r = pane.getBoundingClientRect();
          set(((ev.clientX - r.left - c.view.current.tx) / c.view.current.z / c.W) * 100);
        };
        h.addEventListener('pointermove', move);
        h.addEventListener(
          'pointerup',
          () => (h.removeEventListener('pointermove', move), setDragging(false)),
          { once: true }
        );
      }}
      onKeyDown={(e) => {
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'ArrowDown') set(c.split - step);
        else if (k === 'ArrowRight' || k === 'ArrowUp') set(c.split + step);
        else if (k === 'Home') set(0);
        else if (k === 'End') set(100);
        else return;
        e.preventDefault();
      }}
    />
  );
}

// --- Probe ---------------------------------------------------------------------------------------

/** Renders its children with the pixel under the pointer (null when there is none). */
function ProbePart({ children }: { children: (probe: Probe | null) => React.ReactNode }) {
  const probe = useStore((s) => s.probe);
  return <>{children(probe)}</>;
}

// --- ModeGroup -----------------------------------------------------------------------------------

export interface ModeGroupState {
  mode: DiffMode;
  modes: readonly DiffMode[];
  setMode(mode: DiffMode): void;
}
export interface ModeGroupProps {
  label: string;
  /** Each mode's visible label. Default: the mode's name. */
  labels?: Partial<Record<DiffMode, React.ReactNode>>;
  className?: ClassName<ModeGroupState>;
  itemClassName?: ClassName<{ mode: DiffMode; checked: boolean }>;
  render?: Render<ModeGroupState>;
}
/**
 * The view mode as a radio group: one tab stop, arrow keys move and select, Home / End jump.
 * `render` replaces the whole group (for a design system's own segmented control) and receives
 * the state with its setter.
 */
function ModeGroup({ label, labels, className, itemClassName, render }: ModeGroupProps) {
  const c = useDiffViewer();
  const state: ModeGroupState = { mode: c.mode, modes: c.modes, setMode: c.setMode };
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const i = (to + c.modes.length) % c.modes.length;
    c.setMode(c.modes[i]);
    refs.current[i]?.focus();
  };
  const props = { role: 'radiogroup', 'aria-label': label, className: cls(className, state) };
  if (render) return render(props, state);
  const at = c.modes.indexOf(c.mode);
  return (
    <div {...props}>
      {c.modes.map((m, i) => (
        <button
          key={m}
          ref={(el) => void (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={m === c.mode}
          tabIndex={m === c.mode ? 0 : -1}
          data-mode={m}
          {...(m === c.mode ? { 'data-checked': '' } : {})}
          className={cls(itemClassName, { mode: m, checked: m === c.mode })}
          onClick={() => c.setMode(m)}
          onKeyDown={(e) => {
            const k = e.key;
            if (k === 'ArrowRight' || k === 'ArrowDown') move(at + 1);
            else if (k === 'ArrowLeft' || k === 'ArrowUp') move(at - 1);
            else if (k === 'Home') move(0);
            else if (k === 'End') move(c.modes.length - 1);
            else return;
            e.preventDefault();
          }}
        >
          {labels?.[m] ?? m}
        </button>
      ))}
    </div>
  );
}

// --- ZoomControls --------------------------------------------------------------------------------

export interface ZoomState {
  zoom: number;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  actual(): void;
}
export interface ZoomControlsProps {
  /** Accessible names and visible text. */
  labels?: { group?: string; zoomIn?: string; zoomOut?: string; fit?: string; actual?: string };
  /** The zoom step. Default 1.5. */
  step?: number;
  className?: ClassName<ZoomState>;
  render?: Render<ZoomState>;
}
/** Zoom out, the zoom level (announced politely), zoom in, fit, actual size. */
function ZoomControls({ labels = {}, step = 1.5, className, render }: ZoomControlsProps) {
  const c = useDiffViewer();
  const zoom = useStore((s) => s.zoom);
  const state: ZoomState = {
    zoom,
    zoomIn: () => c.actions.zoomBy(step),
    zoomOut: () => c.actions.zoomBy(1 / step),
    fit: () => c.actions.fit(),
    actual: () => c.actions.zoomTo(1),
  };
  const props = {
    role: 'group',
    'aria-label': labels.group ?? 'Zoom',
    className: cls(className, state),
  };
  if (render) return render(props, state);
  return (
    <div {...props}>
      <button type="button" aria-label={labels.zoomOut ?? 'Zoom out'} onClick={state.zoomOut}>
        −
      </button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label={labels.zoomIn ?? 'Zoom in'} onClick={state.zoomIn}>
        +
      </button>
      <button type="button" onClick={state.fit}>
        {labels.fit ?? 'Fit'}
      </button>
      <button type="button" onClick={state.actual}>
        {labels.actual ?? '1:1'}
      </button>
    </div>
  );
}

export {
  Root,
  Viewport,
  Pane,
  Frame,
  Layer,
  Regions,
  Region,
  Marker,
  SwipeHandle,
  ProbePart as Probe,
  ModeGroup,
  ZoomControls,
};
