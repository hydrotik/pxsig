/**
 * tools/masks.mjs — an entry's masks for the tools (lib/capture/masks.mjs records them, the engine
 * compares them: crates/pxsig-cli/src/batch/masks.rs). In brief (`maskBrief`, every list): masks
 * no approval passes, a mask change, and the masks over a quarter of the capture. In full
 * (`maskDetail`, pxsig_entry): the render's masks and the baseline's, and the findings as
 * sentences. Selectors and shares only.
 */
import { blockedReasons, LARGE_SHARE } from '../lib/mask-words.mjs';

/** @import { ReportRow } from '../types/t6.js' */

/**
 * A share of the capture as a percentage: `0.0469` → `4.7%`.
 * @param {number} area
 */
const share = (area) => `${Number((area * 100).toFixed(1))}%`;

/**
 * `masksBlocked`, `masksChanged` (added, removed, grew, moved, count: selectors), `masksCoverage`
 * over a quarter, and `masksLarge`, when the row has them.
 * @param {ReportRow} row
 */
export const maskBrief = (row) => ({
  ...(row.masksBlocked ? { masksBlocked: row.masksBlocked } : {}),
  ...(row.masksChanged ? { masksChanged: row.masksChanged } : {}),
  ...((row.masksCoverage ?? 0) > LARGE_SHARE ? { masksCoverage: row.masksCoverage } : {}),
  ...(row.masksLarge?.length ? { masksLarge: row.masksLarge } : {}),
});

/**
 * The masks findings as sentences: no approval passes it; all masks over a quarter; each mask
 * over a quarter.
 * @param {ReportRow} row
 */
const warnings = (row) => [
  ...blockedReasons(row).map(
    (r) => `${r}: no approval passes this entry until the masks are smaller; flag it for a person`
  ),
  ...(!row.masksBlocked && (row.masksCoverage ?? 0) > LARGE_SHARE
    ? [
        `the masks cover ${share(row.masksCoverage ?? 0)} of the capture together, over 25%: changes under them are not compared`,
      ]
    : []),
  ...(row.masksLarge ?? []).map(
    (m) =>
      `${m.selector} (${m.source}) covers ${share(m.area)} of the capture, over 25%: changes under it are not compared`
  ),
];

/**
 * The render's masks (selector, source, reason, area, count, boxes), the baseline's beside a
 * change, and the findings as sentences. Nothing when the row has no masks.
 * @param {ReportRow} row
 */
export const maskDetail = (row) => {
  const said = warnings(row);
  return {
    ...(row.masks?.length ? { masks: row.masks } : {}),
    ...(row.masksBaseline ? { masksBaseline: row.masksBaseline } : {}),
    ...(said.length ? { maskWarnings: said } : {}),
  };
};
