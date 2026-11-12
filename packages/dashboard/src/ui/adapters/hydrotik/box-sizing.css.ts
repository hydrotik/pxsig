/**
 * The design system's box-sizing reset, for its own elements only. The design system's global
 * stylesheet makes every element `border-box`, and its components are sized for that: a 20px badge
 * is 20px with its border. The dashboard does not load that stylesheet, so they were `content-box`
 * and grew by their borders and padding (a badge was 22px). Every class the design system's
 * stylesheets define starts `ds-` (vite.mjs, `classPrefixes`), so this rule reaches the elements
 * and pseudo-elements they style and none of the dashboard's own markup. `:where` keeps it at a
 * reset's zero specificity, so a component that sets its own box-sizing still wins.
 *
 * The stylesheet's file name is not spelled out above: in a comment it trips vanilla-extract's
 * transform, and the build fails ("Styles were unable to be assigned to a file").
 */
import { globalStyle } from '@vanilla-extract/css';

/** Every element a class of the design system styles. */
export const dsElements = ':where([class^="ds-"], [class*=" ds-"])';

globalStyle(`${dsElements}, ${dsElements}::before, ${dsElements}::after`, {
  boxSizing: 'border-box',
});
