/**
 * renders-harness.mjs — counts React renders in a real page, per step, for test/renders.test.mjs.
 *
 * `HOOK` is an init script: a minimal React DevTools global hook that React (production builds
 * included) calls on every commit. On each commit it walks the fibers that took part, as DevTools
 * does (a subtree whose child pointer did not change was not visited), and counts each component
 * that rendered (PerformedWork set) and each one mounted. `measure()` runs a step, waits until the
 * page stops committing, and returns that step's counts.
 */

/** Runs in the page before React loads. */
export function HOOK() {
  const PERFORMED_WORK = 1;
  // Function, class, forwardRef and simple memo components: the ones that run user code.
  const COMPOSITE = new Set([0, 1, 11, 15]);
  const nameOf = (f) => {
    const t = f.type;
    if (!t) return '?';
    if (typeof t === 'function') return t.displayName || t.name || '(anonymous)';
    if (t.render) return t.displayName || t.render.displayName || t.render.name || '(anonymous)';
    if (t.type) return t.displayName || t.type.name || '(anonymous)';
    return '(anonymous)';
  };
  const stats = { commits: 0, rendered: 0, mounted: 0, last: 0, by: {} };
  const count = (f, mounted) => {
    stats.rendered++;
    if (mounted) stats.mounted++;
    const n = nameOf(f);
    stats.by[n] = (stats.by[n] ?? 0) + 1;
  };
  const mount = (f) => {
    for (let c = f; c; c = c.sibling) {
      if (COMPOSITE.has(c.tag)) count(c, true);
      if (c.child) mount(c.child);
    }
  };
  const update = (next, prev) => {
    if (COMPOSITE.has(next.tag) && (next.flags & PERFORMED_WORK) === PERFORMED_WORK)
      count(next, false);
    if (next.child === prev.child) return;
    for (let c = next.child; c; c = c.sibling) {
      if (c.alternate) update(c, c.alternate);
      else {
        if (COMPOSITE.has(c.tag)) count(c, true);
        if (c.child) mount(c.child);
      }
    }
  };
  let id = 0;
  window.__pxsigRenders = stats;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      this.renderers.set(++id, renderer);
      return id;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      stats.commits++;
      stats.last = performance.now();
      const cur = root.current;
      if (cur.alternate) update(cur, cur.alternate);
      else if (cur.child) mount(cur.child);
    },
  };
}

/** Resets the counters. */
const reset = (page) =>
  page.evaluate(() => {
    const s = window.__pxsigRenders;
    Object.assign(s, { commits: 0, rendered: 0, mounted: 0, by: {}, last: performance.now() });
  });

/** Waits until the page has not committed for `quiet` ms (at most `max` ms). */
async function settle(page, quiet = 400, max = 8000) {
  const start = Date.now();
  for (;;) {
    await page.waitForTimeout(100);
    const idle = await page.evaluate(() => performance.now() - window.__pxsigRenders.last);
    if (idle >= quiet || Date.now() - start > max) return;
  }
}

/**
 * Runs `step` and returns its commits, components rendered and mounted, and the top renderers.
 * @param {import('playwright').Page} page
 * @param {() => Promise<unknown>} step
 */
export async function measure(page, step) {
  await settle(page);
  await reset(page);
  await step();
  await settle(page);
  const s = await page.evaluate(() => structuredClone(window.__pxsigRenders));
  const top = Object.entries(s.by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.PXSIG_RENDERS_TOP ?? 8));
  return { commits: s.commits, rendered: s.rendered, mounted: s.mounted, top };
}

/** Counts from the first commit to idle (the page's mount). */
export async function measureMount(page) {
  await settle(page);
  const s = await page.evaluate(() => structuredClone(window.__pxsigRenders));
  const top = Object.entries(s.by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.PXSIG_RENDERS_TOP ?? 8));
  return { commits: s.commits, rendered: s.rendered, mounted: s.mounted, top };
}
