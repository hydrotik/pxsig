/**
 * The reference adapter's Badge and StatGroup, which show a tone one way (R4 in the UI contract):
 * a badge in the design system's neutral variants with its text in the tone's colour, and a stat
 * card with no accent edge, its value in the tone's colour (tones.css.ts). index.tsx passes the
 * design-system components in, so every part the adapter uses is named in that one file.
 */
import React from 'react';
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';
import * as t from './tones.css';

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
        variant={emphasis === 'outline' ? 'outline' : 'secondary'}
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
