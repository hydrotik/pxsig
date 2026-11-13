/**
 * The reference adapter's Badge and StatGroup, which show a tone as R4 in the UI contract allows:
 * a badge as the design system draws it (`success`, `warning` and `danger` in its tinted variants:
 * a wash, a border and a dot in the tone's colour; `neutral` and `info` in its neutral ones, the
 * text in the tone's colour), and a stat card with no accent edge, its value in the tone's colour
 * (tones.css.ts). index.tsx passes the design-system components in, so every part the adapter
 * uses is named in that one file.
 */
import React from 'react';
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';
import * as t from './tones.css';

/** A tone the design system has a tinted variant for; it has one look, whatever the emphasis. */
const BADGE_VARIANT: Partial<Record<C.Tone, 'success' | 'warning' | 'destructive'>> = {
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
};

export const toneBadge = (Base: typeof DS.Badge) =>
  function Badge({
    tone = 'neutral',
    emphasis = 'subtle',
    pulse,
    title,
    className,
    children,
  }: C.BadgeProps) {
    return (
      <Base
        variant={BADGE_VARIANT[tone] ?? (emphasis === 'outline' ? 'outline' : 'secondary')}
        data-tone={tone}
        pulse={pulse}
        title={title}
        className={[t.badge, className].filter(Boolean).join(' ')}
      >
        {children}
      </Base>
    );
  };

/** Tone → the StatPanel's value tone; `info` has none there (`infoValue` colours it). */
const VALUE_TONE: Partial<Record<C.Tone, 'success' | 'warning' | 'destructive'>> = {
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
};

export const toneStatGroup = (Panel: typeof DS.StatPanel) =>
  function StatGroup({ label, items, layout, className }: C.StatGroupProps) {
    return (
      <Panel
        className={className}
        variant={layout === 'strip' ? 'strip' : undefined}
        aria-label={label}
        cards={items.map((it) => ({
          label: it.label,
          value: it.tone === 'info' ? <span className={t.infoValue}>{it.value}</span> : it.value,
          ...(it.unit !== undefined ? { unit: it.unit } : {}),
          ...(it.tone && VALUE_TONE[it.tone] ? { tone: VALUE_TONE[it.tone] } : {}),
          ...(it.onSelect
            ? {
                type: 'filter' as const,
                onSelect: it.onSelect,
                ...(it.active !== undefined ? { active: it.active } : {}),
                icon: it.icon,
              }
            : {}),
        }))}
      />
    );
  };
