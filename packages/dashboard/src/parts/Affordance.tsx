/**
 * What a clickable card does, as an icon in its top-right corner: filters the current view, goes to
 * another view, or opens details over the page. Decorative (the card's label says the action), so
 * hidden from assistive technology. To move into the design system with StatPanel's card types.
 */
import { Icons } from '@hydrotik/design-system';
import * as s from '../dashboard.css';

export type AffordanceKind = 'filter' | 'navigate' | 'open';

// One arrow: down-left brings results into the current view, up-right goes out to another one.
const ICON = { filter: Icons.ArrowDownLeft, navigate: Icons.ArrowUpRight, open: Icons.Maximize2 } as const;

export function Affordance({ kind }: { kind: AffordanceKind }) {
  const I = ICON[kind];
  return (
    <span className={s.affordance} data-kind={kind} aria-hidden="true">
      <I />
    </span>
  );
}
