/**
 * The reference adapter's chart accessibility (contract 1.8.0): the chart is one image named by
 * `label` (`role="img"`, so recharts' drawing inside is not read piece by piece) and described by
 * `summary`, visually hidden text beside it. The text is out of flow, so it moves nothing. Without
 * a label the summary names the image; with neither, the chart is left as it was. index.tsx also
 * turns off recharts' keyboard layer (`accessibilityLayer`), which made the SVG a tab stop with
 * `role="application"`: the chart is not interactive, and the summary carries the numbers.
 */
import React from 'react';
import type * as C from '../../contract';
import { srOnly } from './chart-a11y.css';

/** What the drawing's root takes: its role, name and description. */
export type ChartA11y = {
  role?: 'img';
  'aria-label'?: string;
  'aria-describedby'?: string;
};

/** The chart `Drawing` (the design system's), named and described. */
export function withChartSummary(Drawing: React.ComponentType<C.ChartProps & { a11y: ChartA11y }>) {
  return function Chart(props: C.ChartProps) {
    const id = React.useId();
    const { label, summary } = props;
    const name = label || summary;
    const described = Boolean(label && summary);
    const a11y: ChartA11y = name
      ? { role: 'img', 'aria-label': name, 'aria-describedby': described ? id : undefined }
      : {};
    return (
      <>
        <Drawing {...props} a11y={a11y} />
        {described ? (
          <span id={id} className={srOnly}>
            {summary}
          </span>
        ) : null}
      </>
    );
  };
}
