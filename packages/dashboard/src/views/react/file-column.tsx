/**
 * The Compiler table's File column (Compiler.tsx) takes the room the other columns leave, and
 * keeps at least about 14 characters (`fileProbe`, styles/react.css.ts). The table's API sizes a
 * column only with a fixed width, so while the room left is narrower than that the column gets it
 * as a fixed width and the table scrolls; once the table has the room again, the column takes the
 * rest again. It measures, for any adapter, the first file cell and the probe inside it.
 */
import React from 'react';

/** The File column held at `px` since the table was `at` wide, when it was `short` px short. */
interface Held {
  px: number;
  at: number;
  short: number;
}

/** The wrapper to put around the table, and the File column's width (unset: it takes the rest). */
export function useFileColumn(): [React.RefObject<HTMLDivElement | null>, string | undefined] {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [held, setHeld] = React.useState<Held | null>(null);
  // Every render: the rows, and so the first file cell, may have changed.
  React.useLayoutEffect(() => {
    const el = wrap.current;
    const cell = el?.querySelector('[data-file-cell]');
    const probe = el?.querySelector('[data-file-probe]');
    if (!el || !cell || !probe || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const min = Math.ceil(probe.getBoundingClientRect().width);
      const room = el.getBoundingClientRect().width;
      setHeld((h) => {
        if (h) return room >= h.at + h.short ? null : h.px === min ? h : { ...h, px: min };
        const has = cell.getBoundingClientRect().width;
        return has + 1 < min ? { px: min, at: room, short: min - has } : null;
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(probe);
    measure();
    return () => ro.disconnect();
  });
  return [wrap, held ? `${held.px}px` : undefined];
}
