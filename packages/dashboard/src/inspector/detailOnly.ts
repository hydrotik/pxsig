/**
 * A detail-only change (Inspector.tsx): the detail channel failed the entry and no pixel differs by
 * more than the tolerance, so the pixel analysis has nothing to show. The inspector then shows the
 * detail tiles and steps through them as the changes; Pixel Changes says why (ChangesSection).
 */
import React from 'react';
import type { Region, Row } from '../data';
import type { Analysis } from './analyse';

/** The detail tiles' size in px (the engine's 16 px tiles, as the overlay draws them). */
const TILE = 16;

/**
 * The detail channel decided the verdict: a failed entry whose every reason is the detail
 * channel's (the engine words it `detail {n} tiles changed …`; the signature gate's reasons name
 * their metric), with tiles to show.
 */
export const detailDecided = (row: Row) =>
  !row.pass &&
  !!row.reasons?.length &&
  row.reasons.every((r) => r.startsWith('detail ')) &&
  !!row.detail?.tripped?.length;

/** The tiles as regions, in row-major order, clipped at the image's edge. */
export function tileRegions(tripped: number[], W: number, H: number): Region[] {
  const cols = Math.ceil(W / TILE);
  return tripped.map((i) => {
    const x = (i % cols) * TILE;
    const y = Math.floor(i / cols) * TILE;
    return { x, y, w: Math.min(TILE, W - x), h: Math.min(TILE, H - y), px: 0 };
  });
}

/**
 * Whether the entry is a detail-only change at this tolerance, the changes to step through (the
 * tiles, or the analysis' regions), and the Detail tiles switch: on for a detail-only change
 * whatever was saved, and switched for this entry only (`key`), so the saved setting stays.
 */
export function useDetailOnly({
  row,
  analysis,
  key,
  showTiles,
  setShowTiles,
}: {
  row: Row | null;
  analysis: Analysis | null;
  key: string;
  showTiles: boolean;
  setShowTiles: (v: boolean) => void;
}) {
  const [own, setOwn] = React.useState<[string, boolean] | null>(null);
  const on = !!row && !!analysis && analysis.changed === 0 && detailDecided(row);
  const tiles = row?.detail?.tripped;
  const regions = React.useMemo(
    () =>
      on && tiles && analysis
        ? tileRegions(tiles, analysis.W, analysis.H)
        : (analysis?.regions ?? []),
    [on, tiles, analysis]
  );
  if (!on) return { on, regions, showTiles, setShowTiles };
  return {
    on,
    regions,
    showTiles: own?.[0] === key ? own[1] : true,
    setShowTiles: (v: boolean) => setOwn([key, v]),
  };
}
