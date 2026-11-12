/**
 * How the reference adapter shows a tone (R4 in the UI contract): in the colour of a badge's text,
 * a stat's value or a count's digits, never as a wash, a border, a fill or an edge. The design
 * system's tinted badge variants and its accent fill for counts are replaced by its neutral ones,
 * with the text in the tone's role (`info` is the primary colour, `neutral` the text colour).
 */
import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@hydrotik/tokens';

/** A badge's text in its tone's colour, over the design system's neutral wash and border. */
export const badge = style({
  selectors: {
    '&[data-tone="neutral"]': { color: vars.color.text },
    '&[data-tone="info"]': { color: vars.color.primary },
    '&[data-tone="success"]': { color: vars.color.success },
    '&[data-tone="warning"]': { color: vars.color.warning },
    '&[data-tone="danger"]': { color: vars.color.destructive },
  },
});

/** A stat whose tone the design system's StatPanel has no value colour for. */
export const infoValue = style({ color: vars.color.primary });

// A count that asks for action (`attention`): the design system fills it with the primary colour.
// Here it is the neutral count's wash and hairline, with the digits in the primary colour. A global
// rule, because the More menu draws its counts without the link's class.
globalStyle('[data-count-badge][data-placement="inline"][data-tone="attention"]', {
  backgroundColor: `color-mix(in srgb, ${vars.color.text} 8%, transparent)`,
  color: vars.color.primary,
  boxShadow: `inset 0 0 0 1px ${vars.color.border}`,
});
