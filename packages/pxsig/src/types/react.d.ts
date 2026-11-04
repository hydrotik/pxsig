/**
 * types/react.d.ts — the React settings (lib/react/config.mjs) and render counting
 * (lib/capture/react-hook.mjs): what a check row records in `renders` (docs/spec.md).
 */

/** `react` in pxsig.config.json, as lib/react/config.mjs reads it. */
export interface ReactSettings {
  /** Why everything React is off (`react: false`, `--no-react`, `PXSIG_REACT=off`), else null. */
  off: string | null;
  /** Count React commits and renders in every render (`react.renders`). */
  renders: boolean;
}

/** One window's counts: commits, and the components that rendered (null: not walked). */
export interface RenderPhase {
  commits: number;
  rendered: number | null;
  mounted?: number | null;
}

/** A component in `top`: how often it rendered, and whether the React Compiler compiled it. */
export interface RenderTop {
  name: string;
  renders: number;
  compiled: boolean;
}

/** A check row's `renders` (docs/spec.md); null when no React renderer loaded. */
export interface RenderCounts {
  v: 1;
  build: 'development' | 'production';
  react: string | null;
  mount: RenderPhase;
  interaction?: RenderPhase;
  top: RenderTop[];
  /** React's own render time, development builds only. */
  ms?: number;
  /** React had stopped committing: no commit within 250 ms after its last one before the capture. */
  settled: boolean;
}

/** One read of the page's counters (`readRenders`): a window, plus the totals so far. */
export interface RenderRead {
  build: RenderCounts['build'];
  react: string | null;
  phase: RenderPhase;
  top: RenderTop[];
  ms: number | null;
  settled: boolean;
}

/** A fiber, as far as the hook reads one. */
export interface HookFiber {
  tag: number;
  flags: number;
  type?: unknown;
  elementType?: unknown;
  alternate: HookFiber | null;
  child: HookFiber | null;
  sibling: HookFiber | null;
  updateQueue?: { memoCache?: unknown } | null;
  actualDuration?: number;
}

/** What React's renderer hands the hook (`inject`). */
export interface HookInternals {
  bundleType?: number;
  version?: string;
  reconcilerVersion?: string;
}

/** The DevTools hook React looks for: the part pxsig defines or wraps. */
export interface DevtoolsHook {
  supportsFiber?: boolean;
  isDisabled?: boolean;
  renderers?: Map<number, HookInternals>;
  inject?: (internals: HookInternals) => number;
  onCommitFiberRoot?: (id: number, root: { current: HookFiber }, ...rest: unknown[]) => void;
  [method: string]: unknown;
}

/** The counters the hook keeps on the page. */
export interface RenderState {
  injected: number;
  build: RenderCounts['build'];
  react: string | null;
  commits: number;
  rendered: number;
  mounted: number;
  visited: number;
  over: boolean;
  broken: boolean;
  last: number;
  ms: number;
  timed: boolean;
  names: Map<string, { renders: number; compiled: boolean }>;
}

declare global {
  interface Window {
    /** React's DevTools hook: pxsig's own when `react.renders` is on (lib/capture/react-hook.mjs). */
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook;
    /** The render counters of the story on this page. */
    __pxsigRenders?: RenderState;
  }
}
