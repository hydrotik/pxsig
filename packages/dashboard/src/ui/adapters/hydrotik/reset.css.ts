/**
 * The design system's reset and body type, for its own components only. The design system's global
 * stylesheet resets every element and sets the body's type, and its components are drawn for that:
 * a 20px badge is 20px with its border, a button's text sits on an 18px line, a button inside a
 * component takes the page's font. The dashboard does not load that stylesheet, so the components
 * were drawn otherwise (`pxsig dashboard parity` measured it against their stories: a badge 22px,
 * buttons with the browser's 1px padding and `normal` line height, a copy button in the browser's
 * own font).
 *
 * Every class the design system's stylesheets define starts `ds-` (vite.mjs, `classPrefixes`), so
 * these rules reach its elements and none of the dashboard's own markup:
 *   - each of its elements (and pseudo-elements): border-box, no margin, no padding;
 *   - anything inside one: border-box (its unclassed parts are sized like the rest);
 *   - the outermost of its elements: the body's line height and letter spacing, which their parts
 *     inherit (unitless, so a component's own font size keeps its proportion);
 *   - its form controls: the font, line height and colour around them, as the stylesheet sets;
 *     its buttons: no border or background of the browser's own.
 * `:where` keeps every rule at a reset's zero specificity, so a component's own style still wins.
 *
 * The stylesheet's file name is not spelled out above: in a comment it trips vanilla-extract's
 * transform, and the build fails ("Styles were unable to be assigned to a file").
 */
import { globalStyle } from '@vanilla-extract/css';
import { vars } from '@hydrotik/tokens';

/** Every element a class of the design system styles. */
export const dsElements = ':where([class^="ds-"], [class*=" ds-"])';
/** Those not inside another one: where the body's type would reach them from. */
const outermost = `${dsElements}:not(${dsElements} *)`;
const controls = ':where(button, input, optgroup, select, textarea)';

globalStyle(`${dsElements}, ${dsElements}::before, ${dsElements}::after`, {
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
});
globalStyle(
  `:where(${dsElements} *), :where(${dsElements} *)::before, :where(${dsElements} *)::after`,
  {
    boxSizing: 'border-box',
  }
);
globalStyle(`:where(${controls}${dsElements}, ${dsElements} ${controls})`, {
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  color: 'inherit',
});
globalStyle(`:where(button${dsElements}, ${dsElements} button)`, {
  cursor: 'pointer',
  border: 'none',
  background: 'none',
});
// Last: an outermost control takes the body's line height, as it would inherit it from the body.
globalStyle(outermost, {
  lineHeight: vars.font.lineHeight.normal,
  letterSpacing: vars.font.letterSpacing.normal,
});
