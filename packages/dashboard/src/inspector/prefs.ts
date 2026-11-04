/** The inspector's view modes and the view settings it saves (Inspector.tsx). */
import React from 'react';
import type { Mode } from './Stage';

export const MODES: Mode[] = ['side', 'swipe', 'onion', 'diff', 'heat'];

const PREFS_KEY = 'pxsig-inspector';
/** The inspector's view settings, as it saves them (below); any may be missing. */
type Prefs = {
  mode?: Mode;
  split?: number;
  onion?: number;
  heat?: number;
  tol?: number;
  boxes?: boolean;
  highlight?: boolean;
  tiles?: boolean;
};
const loadPrefs = (): Prefs => {
  try {
    // What the inspector itself saved under PREFS_KEY.
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Prefs;
  } catch {
    return {};
  }
};

/** The view settings: from what was saved, and saved again on every change. */
export function useInspectorPrefs() {
  // oxlint-disable-next-line react/use-memo -- loadPrefs reads the saved settings once
  const prefs = React.useMemo(loadPrefs, []);
  const [mode, setModeState] = React.useState<Mode>(prefs.mode ?? 'side');
  const [split, setSplit] = React.useState<number>(prefs.split ?? 50);
  const [onion, setOnion] = React.useState<number>(prefs.onion ?? 50);
  const [heat, setHeat] = React.useState<number>(prefs.heat ?? 60);
  const [tol, setTol] = React.useState<number>(prefs.tol ?? 16);
  const [showBoxes, setShowBoxes] = React.useState<boolean>(prefs.boxes ?? true);
  const [showHighlight, setShowHighlight] = React.useState<boolean>(prefs.highlight ?? true);
  const [showTiles, setShowTiles] = React.useState<boolean>(prefs.tiles ?? true);
  // Originals: the images with no analysis drawn. View state only: never saved (a session that
  // opens with no change marks could approve without seeing them) and never sent with a decision.
  const [originals, setOriginalsState] = React.useState(false);
  // Pixel diff and signature cells are analysis: choosing one turns Originals off, and turning
  // Originals on in one of them goes to Side by side. The overlay switches keep their values.
  const setMode = React.useCallback((m: Mode) => {
    setModeState(m);
    if (m === 'diff' || m === 'heat') setOriginalsState(false);
  }, []);
  const setOriginals = React.useCallback((on: boolean) => {
    setOriginalsState(on);
    if (on) setModeState((m) => (m === 'diff' || m === 'heat' ? 'side' : m));
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          mode,
          split,
          onion,
          heat,
          tol,
          boxes: showBoxes,
          highlight: showHighlight,
          tiles: showTiles,
        })
      );
    } catch {
      /* per-viewer convenience only */
    }
  }, [mode, split, onion, heat, tol, showBoxes, showHighlight, showTiles]);
  return {
    mode,
    setMode,
    split,
    setSplit,
    onion,
    setOnion,
    heat,
    setHeat,
    tol,
    setTol,
    showBoxes,
    setShowBoxes,
    showHighlight,
    setShowHighlight,
    showTiles,
    setShowTiles,
    originals,
    setOriginals,
  };
}
