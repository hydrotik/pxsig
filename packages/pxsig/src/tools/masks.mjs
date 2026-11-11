/**
 * tools/masks.mjs — an entry's masks for the tools (lib/capture/masks.mjs records them, the engine
 * compares them: crates/pxsig-cli/src/batch/masks.rs). In brief (`maskBrief`, every list): a mask
 * change and the masks over a quarter of the capture. In full (`maskDetail`, pxsig_entry): the
 * render's masks and the baseline's, and the warnings as sentences. Selectors and shares only.
 */

/** @import { ReportRow } from '../types/t6.js' */

/**
 * A share of the capture as a percentage: `0.0469` → `4.7%`.
 * @param {number} area
 */
const share = (area) => `${Number((area * 100).toFixed(1))}%`;

/**
 * `masksChanged` (added, removed, grew: selectors) and `masksLarge`, when the row has them.
 * @param {ReportRow} row
 */
export const maskBrief = (row) => ({
  ...(row.masksChanged ? { masksChanged: row.masksChanged } : {}),
  ...(row.masksLarge?.length ? { masksLarge: row.masksLarge } : {}),
});

/**
 * The render's masks (selector, source, reason, area), the baseline's beside a change, and one
 * warning per mask over a quarter of the capture. Nothing when the row has no masks.
 * @param {ReportRow} row
 */
export const maskDetail = (row) => ({
  ...(row.masks?.length ? { masks: row.masks } : {}),
  ...(row.masksBaseline ? { masksBaseline: row.masksBaseline } : {}),
  ...(row.masksLarge?.length
    ? {
        maskWarnings: row.masksLarge.map(
          (m) =>
            `${m.selector} (${m.source}) covers ${share(m.area)} of the capture, over 25%: changes under it are not compared`
        ),
      }
    : {}),
});
