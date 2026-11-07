/**
 * The reference adapter's side panel at a narrow container: pushed in beside the records while
 * both fit (the records keep 40rem, the panel its 20rem), overlaid on the records from the right
 * below that, the records keeping their full width underneath (the design system's overlay look:
 * on top, with its shadow, no scrim: the page stays usable). Overlaid, the panel is as tall as the
 * records and its body scrolls, so it never makes the page or its card scroll. A container query
 * on the layout, not the viewport, so the panel follows the room the page gives it.
 */
import { style } from '@vanilla-extract/css';
import { vars } from '@hydrotik/tokens';

/** Below this the records and the panel no longer fit side by side. */
const NARROW = '(inline-size < 60rem)';

export const layout = style({ containerType: 'inline-size' });

// Above the design system's `[data-mode="push"]` rule, which sets the panel in the row.
export const panel = style({
  '@container': {
    [NARROW]: {
      selectors: {
        '&&[data-mode]': {
          position: 'absolute',
          insetBlock: 0,
          insetInlineEnd: 0,
          zIndex: 4,
          boxShadow: vars.shadow.xl,
        },
      },
    },
  },
});
