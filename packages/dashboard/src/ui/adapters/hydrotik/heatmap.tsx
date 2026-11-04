/**
 * The reference adapter's Heatmap: tiles on the design system's tokens (heatmap.css.ts), the first
 * chart colour over the surface in five steps. It uses no design-system component, only the theme
 * (for the ink step) and its own tile classes, so it sits beside its styles; index.tsx exports it.
 */
import { useTheme } from '@hydrotik/theme-provider';
import type * as C from '../../contract';
import { heatStep } from '../../contract';
import * as hm from './heatmap.css';

/**
 * From which step the ink is the surface colour, per theme: the text colour holds 4.5:1 on the
 * fills below it, the surface colour on the fills from it (checked on both themes' values).
 */
const INK_FROM = { light: 6, dark: 6 } as const; // no step needs it on the chart1 scale

export function Heatmap({ label, cells, legend, onSelect, className }: C.HeatmapProps) {
  const { theme } = useTheme();
  const from = INK_FROM[theme === 'light' ? 'light' : 'dark'];
  const cls = (n: number) =>
    [hm.tile, hm.step[n as 0], n >= from ? hm.inverse : ''].filter(Boolean).join(' ');
  return (
    <div className={[hm.root, className].filter(Boolean).join(' ')}>
      <ul className={hm.grid} aria-label={label}>
        {cells.map((c) => {
          const n = heatStep(c.value);
          const name = c.accessibleLabel ?? `${c.label}, ${c.text}`;
          const body = (
            <>
              <span className={hm.name}>{c.label}</span> <span className={hm.figure}>{c.text}</span>
            </>
          );
          return (
            <li key={c.id}>
              {onSelect ? (
                <button
                  type="button"
                  className={cls(n)}
                  aria-label={name}
                  title={name}
                  data-step={n}
                  onClick={() => onSelect(c)}
                >
                  {body}
                </button>
              ) : (
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a named tile, not a form group: <fieldset> would announce a form
                <div className={cls(n)} role="group" aria-label={name} title={name} data-step={n}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className={hm.legend}>
        <span className={hm.legendLabel}>{legend.label}</span>
        <span>{legend.low}</span>
        <span className={hm.ramp} aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={[hm.swatch, hm.step[n as 1]].join(' ')} />
          ))}
        </span>
        <span>{legend.high}</span>
      </div>
    </div>
  );
}
