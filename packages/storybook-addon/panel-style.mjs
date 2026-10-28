/**
 * The panel's look, from Storybook's own theme (`useTheme()` from storybook/theming), so the
 * toolbar and its buttons follow Storybook's light or dark theme, and the embedded inspector and
 * the dashboard it opens start in the same one. Plain functions: no Storybook import here.
 */
/** @import { PanelTheme } from './types.js' */

/**
 * 'dark' or 'light': the theme's base, else read from its content background.
 * @param {PanelTheme | null | undefined} theme
 * @returns {'dark' | 'light'}
 */
export function themeMode(theme) {
  if (theme?.base === 'dark' || theme?.base === 'light') return theme.base;
  const bg = String(theme?.background?.content ?? theme?.appContentBg ?? '');
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return 'light';
  const n = Number.parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128 ? 'dark' : 'light';
}

/**
 * Text and border colours for the panel, with neutral fallbacks for a theme that lacks them.
 * @param {PanelTheme | null | undefined} theme
 */
export function panelColors(theme) {
  return {
    text: theme?.color?.defaultText ?? theme?.textColor ?? 'inherit',
    muted: theme?.barTextColor ?? theme?.textMutedColor ?? 'inherit',
    border: theme?.appBorderColor ?? 'rgba(128,128,128,.4)',
    background: theme?.background?.content ?? theme?.appContentBg ?? 'transparent',
  };
}

/**
 * A toolbar button styled like Storybook's inputs in the current theme.
 * @param {PanelTheme | null | undefined} theme
 * @param {boolean} [disabled]
 */
export function buttonStyle(theme, disabled = false) {
  const c = panelColors(theme);
  return {
    font: 'inherit',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: theme?.input?.borderRadius ?? theme?.appBorderRadius ?? 4,
    border: `1px solid ${theme?.input?.border ?? c.border}`,
    background: theme?.input?.background ?? 'transparent',
    color: theme?.input?.color ?? c.text,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

/**
 * A dashboard URL on `server` with Storybook's theme mode added (`theme=dark|light`).
 * @param {string} server
 * @param {Record<string, string | number | null | undefined>} params
 * @param {string} mode
 */
export function dashboardUrl(server, params, mode) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && k !== 'hash') q.set(k, String(v));
  q.set('theme', mode);
  return `${server}/report/?${q.toString()}${params.hash ? `#${params.hash}` : ''}`;
}
