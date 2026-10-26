/**
 * The dashboard's neutral theme tokens. The dashboard's own stylesheets (`*.css.ts`) and inline
 * styles read these, never a design system's variables. Each one is a CSS custom property
 * (`--pxsig-<group>-<name>`); an adapter supplies its value for every name (`TokenMap`), usually a
 * reference to its design system's own variable, and the runtime declares them on `:root`.
 *
 * This module has no imports and no side effects: vanilla-extract evaluates it at build time.
 * Adding a name here is a contract change. Give it a value in TOKEN_DEFAULTS and it is a minor one:
 * an adapter whose map lacks it gets the default. Without a default every adapter must map it, a
 * major change (`pnpm ui:check` holds both to src/ui/contract-lock.json).
 */

export const TOKEN_NAMES = [
  // Colour roles. Each switches with the theme mode.
  'color.background', // the page
  'color.surface', // cards, panels
  'color.surfaceRaised', // a surface above a surface; the light squares of the transparency checker
  'color.border',
  'color.text',
  'color.textMuted',
  'color.accent', // the interactive colour: links, selection, the active region
  'color.focus', // the focus indicator
  'color.hover', // a quiet hover wash behind a list item
  'color.success',
  'color.warning',
  'color.danger',
  // Spacing steps (rem-based in the reference): 0.5 = 0.125rem … 12 = 3rem.
  'space.0_5',
  'space.1',
  'space.1_5',
  'space.2',
  'space.2_5',
  'space.3',
  'space.4',
  'space.5',
  'space.6',
  'space.8',
  'space.12',
  // Corner radii.
  'radius.sm',
  'radius.md',
  'radius.lg',
  // Type.
  'font.sans',
  'font.mono',
  'fontSize.3xs', // micro labels, tracked caps
  'fontSize.2xs',
  'fontSize.xs',
  'fontSize.sm',
  'fontSize.lg',
  'fontWeight.semibold',
  'lineHeight.relaxed',
  'letterSpacing.caps',
  // Lines.
  'line.emphasis', // a status edge on a card; the focus ring of a help row
  // Motion.
  'motion.fast', // hover colour changes
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/**
 * Values for tokens added after 1.0.0, used when an adapter's map has none (a plain CSS value that
 * reads well in both themes, or a reference to another token). Empty: every token is from 1.0.0.
 */
export const TOKEN_DEFAULTS = {} as const satisfies Partial<Record<TokenName, string>>;

/** What an adapter supplies: a CSS value for every token name without a default, in every theme mode. */
export type TokenMap = Record<Exclude<TokenName, keyof typeof TOKEN_DEFAULTS>, string> & Partial<Record<TokenName, string>>;

/** `color.textMuted` → `--pxsig-color-textMuted`. */
export const cssVarName = (name: TokenName) => `--pxsig-${name.replace('.', '-')}`;

const v = (name: TokenName) => `var(${cssVarName(name)})`;

/** The tokens as `var(--pxsig-…)` references, grouped for stylesheets: `tokens.color.text`. */
export const tokens = {
  color: {
    background: v('color.background'),
    surface: v('color.surface'),
    surfaceRaised: v('color.surfaceRaised'),
    border: v('color.border'),
    text: v('color.text'),
    textMuted: v('color.textMuted'),
    accent: v('color.accent'),
    focus: v('color.focus'),
    hover: v('color.hover'),
    success: v('color.success'),
    warning: v('color.warning'),
    danger: v('color.danger'),
  },
  space: {
    '0_5': v('space.0_5'),
    '1': v('space.1'),
    '1_5': v('space.1_5'),
    '2': v('space.2'),
    '2_5': v('space.2_5'),
    '3': v('space.3'),
    '4': v('space.4'),
    '5': v('space.5'),
    '6': v('space.6'),
    '8': v('space.8'),
    '12': v('space.12'),
  },
  radius: { sm: v('radius.sm'), md: v('radius.md'), lg: v('radius.lg') },
  font: { sans: v('font.sans'), mono: v('font.mono') },
  fontSize: { '3xs': v('fontSize.3xs'), '2xs': v('fontSize.2xs'), xs: v('fontSize.xs'), sm: v('fontSize.sm'), lg: v('fontSize.lg') },
  fontWeight: { semibold: v('fontWeight.semibold') },
  lineHeight: { relaxed: v('lineHeight.relaxed') },
  letterSpacing: { caps: v('letterSpacing.caps') },
  line: { emphasis: v('line.emphasis') },
  motion: { fast: v('motion.fast') },
} as const;

/** The `:root { … }` rule that declares every token from an adapter's map. */
export function tokenCss(map: TokenMap): string {
  const defaults: Partial<Record<TokenName, string>> = TOKEN_DEFAULTS;
  const value = (n: TokenName) => (typeof map[n] === 'string' && map[n] ? map[n] : defaults[n]);
  const missing = TOKEN_NAMES.filter((n) => !value(n));
  if (missing.length) throw new Error(`[pxsig ui] the adapter's token map lacks: ${missing.join(', ')}`);
  return `:root{${TOKEN_NAMES.map((n) => `${cssVarName(n)}:${value(n)};`).join('')}}`;
}
