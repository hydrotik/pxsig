/**
 * What a clickable card does, as one arrow in its top-right corner: down-left filters the current
 * view; up-right goes somewhere else (another tab, the inspector, a review session). Decorative (the card's label says the action), so
 * hidden from assistive technology.
 */
import { Icon } from '@ui';
import * as s from '../dashboard.css';

export type AffordanceKind = 'filter' | 'navigate';

const ICON = { filter: 'arrow-down-left', navigate: 'arrow-up-right' } as const;

export function Affordance({ kind }: { kind: AffordanceKind }) {
  return (
    <span className={s.affordance} data-kind={kind} aria-hidden="true">
      <Icon name={ICON[kind]} />
    </span>
  );
}
