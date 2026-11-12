/**
 * How the reference adapter shows a tone (R4 in the UI contract): in the colour of a stat's value
 * or a count's digits, never as a wash, a border, a fill or an edge. A badge in `success`,
 * `warning` or `danger` is the design system's own tinted variant (R4 allows either for badges);
 * a `neutral` or `info` badge is its neutral variant with the text in the tone's role (`info` is
 * the primary colour, `neutral` the text colour). The design system's accent fill for counts is
 * replaced by its neutral one.
 */
import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@hydrotik/tokens';

/** A `neutral` or `info` badge's text in its tone's colour, over a neutral wash and border. */
export const badge = style({
  selectors: {
    '&[data-tone="neutral"]': { color: vars.color.text },
    '&[data-tone="info"]': { color: vars.color.primary },
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
