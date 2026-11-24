/**
 * The reference adapter's Badge and StatGroup: each contract tone onto the design system's own
 * variant, as it draws it. A badge: `success`, `warning` and `danger` its tinted variants, `info`
 * its `default` (the primary wash), `neutral` its `secondary` (or `outline` for that emphasis). A
 * stat card: the tone colours its value (StatPanel's `tone`), and for `success`, `warning` and
 * `danger` StatPanel's accent draws a 2px start edge in that tone's colour (R4 allows it for stat
 * cards since 1.8.0); StatPanel draws the corner arrow (`affordance`). index.tsx passes the
 * design-system components in, so every part the adapter uses is named in that one file.
 */
import type * as DS from '@hydrotik/design-system';
import type * as C from '../../contract';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';

/** Tone (and emphasis, for `neutral`) → the design system's badge variant. */
export const badgeVariant = (tone: C.Tone, emphasis: C.BadgeProps['emphasis']): BadgeVariant =>
  tone === 'success'
    ? 'success'
    : tone === 'warning'
      ? 'warning'
      : tone === 'danger'
        ? 'destructive'
        : tone === 'info'
          ? 'default'
          : emphasis === 'outline'
            ? 'outline'
            : 'secondary';

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
        variant={badgeVariant(tone, emphasis)}
        data-tone={tone}
        pulse={pulse}
        title={title}
        className={className}
      >
        {children}
      </Base>
    );
  };

/** Tone → the StatPanel's value tone; `neutral` is none. */
const VALUE_TONE: Partial<Record<C.Tone, 'info' | 'success' | 'warning' | 'destructive'>> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
};

/** Tone → the StatPanel's accent edge; `info` and `neutral` have none, as in 0.7.6. */
const ACCENT: Partial<Record<C.Tone, 'success' | 'warning' | 'error'>> = {
  success: 'success',
  warning: 'warning',
  danger: 'error',
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
          value: it.value,
          ...(it.unit !== undefined ? { unit: it.unit } : {}),
          ...(it.tone && VALUE_TONE[it.tone] ? { tone: VALUE_TONE[it.tone] } : {}),
          ...(it.tone && ACCENT[it.tone] ? { accent: ACCENT[it.tone] } : {}),
          ...(it.onSelect
            ? {
                type: 'filter' as const,
                onSelect: it.onSelect,
                ...(it.active !== undefined ? { active: it.active } : {}),
                // The design system draws the corner arrow itself.
                ...(it.affordance ? { affordance: it.affordance } : { icon: it.icon }),
              }
            : {}),
        }))}
      />
    );
  };
