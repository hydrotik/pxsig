/**
 * The top-bar count that asks for action (`attention`): pxsig's own look, a quiet count in a busy
 * bar. The design system fills it with the primary colour; here it is the neutral count's wash and
 * hairline, with the digits in the primary colour. A global rule, because the More menu draws its
 * counts without the link's class. Listed in EXCEPTIONS (ui-tools/adapter-css.mjs) until the pinned
 * design system has CountBadge's `emphasis="subtle"`, which the adapter will then select by prop.
 */
import { globalStyle } from '@vanilla-extract/css';
import { vars } from '@hydrotik/tokens';

globalStyle('[data-count-badge][data-placement="inline"][data-tone="attention"]', {
  backgroundColor: `color-mix(in srgb, ${vars.color.text} 8%, transparent)`,
  color: vars.color.primary,
  boxShadow: `inset 0 0 0 1px ${vars.color.border}`,
});
