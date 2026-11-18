/**
 * The reference adapter's chart accessibility (contract 1.8.0). The chart is interactive: recharts
 * 3's keyboard layer (`accessibilityLayer`, on by default) makes its SVG the chart's one tab stop,
 * `role="application"` so a screen reader passes the arrow keys through, and the arrow keys move
 * the tooltip from point to point. That SVG takes the name and the description: `aria-label` from
 * `label`, and `aria-describedby` pointing at `summary`, visually hidden text beside the chart
 * (out of flow, so it moves nothing). Without a label the summary names it.
 */
import React from 'react';
import type * as C from '../../contract';
import { srOnly } from './chart-a11y.css';

/** What the chart's SVG takes (recharts passes aria attributes to its root surface). */
export type ChartA11y = { 'aria-label'?: string; 'aria-describedby'?: string };

/** The chart `Drawing` (the design system's), its SVG named and described. */
export function withChartSummary(Drawing: React.ComponentType<C.ChartProps & { a11y: ChartA11y }>) {
  return function Chart(props: C.ChartProps) {
    const id = React.useId();
    const { label, summary } = props;
    const described = Boolean(label && summary);
    const a11y: ChartA11y = {
      'aria-label': label || summary,
      'aria-describedby': described ? id : undefined,
    };
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
