/**
 * The contract runtime: theme mode (rule 7) and the token declarations. The adapter's provider
 * receives the mode; it never owns the setter.
 */
import React from 'react';
import type { ThemeMode } from './contract';
import { type TokenMap, tokenCss } from './tokens';

const STORAGE_KEY = 'pxsig-dashboard-theme';
const DEFAULT_MODE: ThemeMode = 'light';

function readMode(): ThemeMode {
  // A link may name the mode (the Storybook addon passes Storybook's own): it wins, unstored.
  try {
    const q = new URLSearchParams(location.search).get('theme');
    if (q === 'dark' || q === 'light') return q;
  } catch {
    /* no location: not a page */
  }
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

interface ThemeModeValue {
  mode: ThemeMode;
  setMode(mode: ThemeMode): void;
}
const ThemeModeContext = React.createContext<ThemeModeValue>({ mode: DEFAULT_MODE, setMode: () => {} });

/** The current theme mode and its setter (persisted per viewer). */
export function useThemeMode(): ThemeModeValue {
  return React.useContext(ThemeModeContext);
}

export function ThemeModeProvider({ children }: { children: (mode: ThemeMode) => React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>(readMode);
  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* a per-viewer convenience only */
    }
  }, []);
  const value = React.useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeModeContext.Provider value={value}>{children(mode)}</ThemeModeContext.Provider>;
}

/** Declares the adapter's token values as `--pxsig-*` on `:root`, once, before the first render. */
export function installTokens(map: TokenMap) {
  if (typeof document === 'undefined') return;
  const id = 'pxsig-ui-tokens';
  const el = document.getElementById(id) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id }));
  el.textContent = tokenCss(map);
}
