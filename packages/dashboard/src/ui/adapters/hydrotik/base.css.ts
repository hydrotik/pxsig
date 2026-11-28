/**
 * The design system's base stylesheet, for its own components only. Its global stylesheet resets
 * every element and sets the body's type, and its components are drawn for that: a 20px badge is
 * 20px with its border, a button's text sits on an 18px line, a button inside a component takes
 * the page's font. The dashboard does not load that stylesheet; it takes the same rules scoped to
 * the design system's elements (`@hydrotik/design-system/styles/scoped`).
 *
 * Every class the design system's stylesheets define starts `ds-` (vite.mjs, `classPrefixes`), so
 * the rules reach its elements, and the parts its components draw (each carries a class of its
 * own), and none of the dashboard's own markup, inside a component or not. The heading rule stays
 * out (`headings: false`): the dashboard's titles keep the type they have.
 */
import { applyBaseStyles, classPrefixScope } from '@hydrotik/design-system/styles/scoped';

applyBaseStyles(classPrefixScope('ds-'), { headings: false });
