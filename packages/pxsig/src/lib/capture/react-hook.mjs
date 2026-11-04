/**
 * Counting React commits and renders in the page, without React DevTools (`react.renders`).
 *
 * `reactHook` is an init script: it defines React's DevTools hook before the story's bundle runs
 * (or wraps one that exists), and on every commit counts the components that rendered. The counts
 * live on the page; render.mjs resets them before a story switch and reads them before the
 * screenshot (and around an interaction). It sends nothing anywhere and never throws into React.
 */
/** @import { Page } from 'playwright' */
/** @import { DevtoolsHook, HookFiber, HookInternals, RenderCounts, RenderRead } from '../../types/react.js' */

/**
 * The init script (`context.addInitScript`). Self-contained: Playwright sends its source.
 */
export function reactHook() {
  if (window.__pxsigRenders) return;
  // Fibers visited per story before the walk stops (rendered: null); commits are still counted.
  const LIMIT = 200000;
  // React's fiber tags for components: function, class, forwardRef, simple memo. A `memo` of
  // another component (14) is not counted itself: the component under it is.
  const COMPONENT = new Set([0, 1, 11, 15]);
  // React's PerformedWork flag: the component rendered in this commit.
  const PERFORMED_WORK = 1;
  /** @type {NonNullable<Window['__pxsigRenders']>} */
  const s = {
    injected: 0,
    build: 'production',
    react: null,
    commits: 0,
    rendered: 0,
    mounted: 0,
    visited: 0,
    over: false,
    broken: false,
    last: -Infinity,
    ms: 0,
    timed: false,
    names: new Map(),
  };
  window.__pxsigRenders = s;
  /** @param {HookFiber} f */
  const nameOf = (f) => {
    const t =
      /** @type {{ displayName?: string, name?: string, render?: Function, type?: Function } | undefined} */ (
        f.elementType ?? f.type
      );
    const inner = /** @type {{ displayName?: string, name?: string } | undefined} */ (
      t?.render ?? t?.type
    );
    return t?.displayName || inner?.displayName || inner?.name || t?.name || 'Anonymous';
  };
  /** @param {HookFiber} top */
  const walk = (top) => {
    /** @type {(HookFiber | null)[]} */
    const stack = [top];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      if (++s.visited > LIMIT) {
        s.over = true;
        return;
      }
      const alt = f.alternate;
      if (COMPONENT.has(f.tag) && (!alt || f.flags & PERFORMED_WORK)) {
        s.rendered++;
        if (!alt) s.mounted++;
        const name = nameOf(f);
        const n = s.names.get(name) ?? { renders: 0, compiled: false };
        n.renders++;
        // React 19 keeps the compiler's memo cache on the fiber's update queue.
        if (f.updateQueue?.memoCache) n.compiled = true;
        s.names.set(name, n);
      }
      stack.push(f.sibling);
      // The same child as the last commit: nothing under it rendered.
      if (f.child && !(alt && alt.child === f.child)) stack.push(f.child);
    }
  };
  /** @type {NonNullable<DevtoolsHook['onCommitFiberRoot']>} */
  const onCommit = (_id, root) => {
    if (s.broken) return;
    try {
      s.commits++;
      s.last = performance.now();
      const d = root.current.actualDuration;
      if (typeof d === 'number') {
        s.timed = true;
        s.ms += d;
      }
      if (!s.over) walk(root.current);
    } catch {
      s.broken = true;
    }
  };
  /** @param {HookInternals} internals */
  const seen = (internals) => {
    if (s.injected++) return;
    s.build = internals?.bundleType === 1 ? 'development' : 'production';
    s.react = internals?.reconcilerVersion ?? internals?.version ?? null;
  };
  const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing) {
    // A hook that is already there (an extension, another tool): chain, never replace.
    const inject = existing.inject;
    const commit = existing.onCommitFiberRoot;
    existing.inject = function (internals) {
      seen(internals);
      return typeof inject === 'function' ? inject.call(this, internals) : 0;
    };
    existing.onCommitFiberRoot = function (id, root, ...rest) {
      onCommit(id, root);
      if (typeof commit === 'function') commit.call(this, id, root, ...rest);
    };
    return;
  }
  let id = 0;
  const noop = () => {};
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(internals) {
      seen(internals);
      this.renderers?.set(++id, internals);
      return id;
    },
    onCommitFiberRoot: onCommit,
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    setStrictMode: noop,
    checkDCE: noop,
  };
}

/** In the page: start a new story's window (before a story switch). */
export const RESET_RENDERS = () => {
  const s = window.__pxsigRenders;
  if (!s) return;
  s.commits = s.rendered = s.mounted = s.visited = s.ms = 0;
  s.over = s.broken = s.timed = false;
  s.last = -Infinity;
  s.names.clear();
};

/**
 * In the page: this window's counts (which then start again), the top components and whether
 * React had settled (no commit within the last 250 ms; when there was one, `STAYED_QUIET` decides
 * after the capture). undefined: no hook on the page; null: no React renderer loaded.
 * @returns {RenderRead | null | undefined}
 */
export const READ_RENDERS = () => {
  const s = window.__pxsigRenders;
  if (!s) return undefined;
  if (!s.injected) return null;
  const walked = !s.over && !s.broken;
  const phase = {
    commits: s.commits,
    rendered: walked ? s.rendered : null,
    mounted: walked ? s.mounted : null,
  };
  s.commits = s.rendered = s.mounted = 0;
  const top = [...s.names]
    .sort(([a, x], [b, y]) => y.renders - x.renders || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 5)
    .map(([name, n]) => ({ name, renders: n.renders, compiled: n.compiled }));
  return {
    build: s.build,
    react: s.react,
    phase,
    top: walked ? top : [],
    ms: s.timed ? Math.round(s.ms * 10) / 10 : null,
    settled: performance.now() - s.last >= 250,
  };
};

/**
 * A check row's `renders` from the reads around a capture: one (`mount`), or two with an
 * interaction between them. undefined when nothing was read; null when no React renderer loaded.
 * @param {RenderRead | null | undefined} first
 * @param {RenderRead | null} [second]
 * @returns {RenderCounts | null | undefined}
 */
export function rowRenders(first, second) {
  if (first === undefined) return undefined;
  if (first === null) return null;
  const last = second ?? first;
  /** @type {RenderCounts} */
  const out = {
    v: 1,
    build: first.build,
    react: first.react,
    mount: first.phase,
    ...(second
      ? { interaction: { commits: second.phase.commits, rendered: second.phase.rendered } }
      : {}),
    top: last.top,
    settled: last.settled,
  };
  if (last.ms != null && first.build === 'development') out.ms = last.ms;
  return out;
}

/**
 * Read the page's counters, never failing a render: undefined when the read itself failed.
 * @param {Page} page
 */
export const readRenders = (page) => page.evaluate(READ_RENDERS).catch(() => undefined);

/**
 * In the page, after the capture of a read that was not settled: whether React then stayed quiet
 * until 250 ms after its last commit before the read. A commit just before the capture (the answer
 * to an interaction) is settled when nothing follows it; a component that keeps re-rendering is not.
 * Waits at most what is left of those 250 ms; the capture's own timing is unchanged.
 * @returns {Promise<boolean>}
 */
export const STAYED_QUIET = () =>
  new Promise((resolve) => {
    const s = window.__pxsigRenders;
    if (!s) return resolve(true);
    // READ_RENDERS started the commit count again: any commit since is one after the capture.
    const wait = Math.max(0, s.last + 250 - performance.now());
    setTimeout(() => resolve(s.commits === 0), wait);
  });
