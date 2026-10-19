/**
 * What a clickable card does, as one arrow in its top-right corner: down-left filters the current
 * view; up-right goes somewhere else (another tab, the inspector, a review session). Decorative (the card's label says the action), so
 * hidden from assistive technology. To move into the design system with StatPanel's card types.
 */
import { Icons } from '@hydrotik/design-system';
import * as s from '../dashboard.css';

export type AffordanceKind = 'filter' | 'navigate';

const ICON = { filter: Icons.ArrowDownLeft, navigate: Icons.ArrowUpRight } as const;

export function Affordance({ kind }: { kind: AffordanceKind }) {
  const I = ICON[kind];
  return (
    <span className={s.affordance} data-kind={kind} aria-hidden="true">
      <I />
    </span>
  );
}
