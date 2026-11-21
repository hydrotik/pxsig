/**
 * The Compiler table's File column (Compiler.tsx) takes the room the other columns leave, and
 * keeps at least about 14 characters (`fileProbe`, styles/react.css.ts). The table's API sizes a
 * column only with a fixed width, so while the room left is narrower than that the column gets it
 * as a fixed width (the 14 characters plus the cell's own padding) and the table scrolls; once the
 * table fits its container with the column at that width, the column takes the rest again. It
 * measures, for any adapter, the first file cell, the probe inside it, the cell around them and
 * the table.
 */
import React from 'react';

const width = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0;

/** The wrapper to put around the table, and the File column's width (unset: it takes the rest). */
export function useFileColumn(): [React.RefObject<HTMLDivElement | null>, string | undefined] {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [held, setHeld] = React.useState<number | null>(null);
  // Every render: the rows, and so the first file cell, may have changed.
  React.useLayoutEffect(() => {
    const el = wrap.current;
    const span = el?.querySelector('[data-file-cell]');
    const probe = el?.querySelector('[data-file-probe]');
    if (!el || !span || !probe || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const cell = span.closest('td, th, [role="cell"], [role="gridcell"]') ?? span.parentElement;
      const table = span.closest('table');
      const want = Math.ceil(width(probe) + Math.max(0, width(cell) - width(span)));
      setHeld((h) => {
        if (h == null) return width(span) + 0.5 < width(probe) ? want : null;
        // Held: once the table fits its container, the column would have the room again.
        const fits = table
          ? width(table) <= (table.parentElement ?? el).clientWidth + 0.5
          : el.scrollWidth <= el.clientWidth;
        return fits ? null : want;
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(probe);
    measure();
    return () => ro.disconnect();
  });
  return [wrap, held == null ? undefined : `${held}px`];
}
