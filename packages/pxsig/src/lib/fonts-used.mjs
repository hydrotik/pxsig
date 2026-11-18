/**
 * fonts-used.mjs — comparing the fonts a render's text was drawn in (lib/capture/fonts.mjs) with
 * those its baseline's render used (the `.psig` header's `fonts`). Other faces mean the render was
 * made in another environment, as a different browser or font probe does: the row's `envMatch`
 * becomes `mismatch` with `fonts.used` in `envDiff`, `envFontsUsed` says which faces came and
 * went, and its text is not compared (`textDiff.state` `env-differs`: a font swap is never a copy
 * change). Glyph counts are not compared; copy changes move them. A baseline without `fonts`
 * (written before pxsig recorded fonts), and a render without them (Firefox, WebKit), compare as unknown: nothing is said.
 */
import { resolve } from 'node:path';
import { faceKey } from './capture/fonts.mjs';
import { readHeader } from './psig.mjs';
/** @import { CheckRow, RenderResult } from '../types.js' */
/** @import { FontsUsedDiff, UsedFace, UsedFonts } from '../types/fonts.js' */

/** The `envDiff` field a font difference adds. */
export const FONTS_USED = 'fonts.used';

/**
 * The faces each side drew that the other did not; null when either is unknown or both are the same.
 * @param {UsedFonts | null | undefined} base
 * @param {UsedFonts | null | undefined} cur
 * @returns {FontsUsedDiff | null}
 */
export function compareFonts(base, cur) {
  if (base?.v !== 1 || cur?.v !== 1 || !Array.isArray(base.used) || !Array.isArray(cur.used))
    return null;
  const keys = (/** @type {UsedFace[]} */ l) => new Set(l.map(faceKey));
  const [b, c] = [keys(base.used), keys(cur.used)];
  const strip = (/** @type {UsedFace} */ f) =>
    /** @type {UsedFace} */ (Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'glyphs')));
  const added = cur.used.filter((f) => !b.has(faceKey(f))).map(strip);
  const removed = base.used.filter((f) => !c.has(faceKey(f))).map(strip);
  return added.length || removed.length ? { added, removed } : null;
}

/**
 * Mark a checked row whose render drew its text in other faces than its baseline's.
 * @param {CheckRow} row
 * @param {{ render?: UsedFonts | null, baseline?: UsedFonts | null }} fonts
 * @returns {CheckRow}
 */
export function annotateFonts(row, { render, baseline }) {
  if (!row || row.skipped) return row;
  const diff = compareFonts(baseline, render);
  if (!diff) return row;
  // New text in a character the page's fonts lack draws in a system fallback: when the text record
  // shows a copy change (or added text) and the only difference is fallbacks added, the copy change
  // wins and the fallback is information. A face removed, or a named face added, is a swap.
  if (newTextFallback(row, diff)) return { ...row, envFontsUsed: { ...diff, newText: true } };
  return {
    ...row,
    envMatch: 'mismatch',
    envDiff: [...(row.envDiff ?? []).filter((f) => f !== FONTS_USED), FONTS_USED],
    envFontsUsed: diff,
    ...(row.textDiff && row.textDiff.state !== 'env-differs'
      ? { textDiff: { v: 1, state: 'env-differs' } }
      : {}),
  };
}

/**
 * Is this difference only system fallbacks added, on a row whose text gained copy?
 * @param {CheckRow} row
 * @param {FontsUsedDiff} diff
 */
function newTextFallback(row, diff) {
  const t = row.textDiff;
  const copy = t?.state === 'compared' && ((t.counts?.copy ?? 0) > 0 || (t.counts?.added ?? 0) > 0);
  return copy && !diff.removed.length && diff.added.every((f) => f.family == null);
}

/** The note on such a row (the env line, `pxsig entry`, MCP): information, not a mismatch. */
export const NEW_TEXT_FALLBACK = '+ a system fallback font for new text';

/**
 * A face as a person reads it: its family, or "a system fallback font" (no name is kept).
 * @param {Pick<UsedFace, 'family' | 'digest' | 'web'>} f
 */
export const sayFace = (f) => f.family ?? 'a system fallback font';

/**
 * "fonts.used: +Arial, −a system fallback font".
 * @param {FontsUsedDiff | null | undefined} d
 */
export const sayFontsUsed = (d) =>
  `${FONTS_USED}: ${[...(d?.added ?? []).map((f) => `+${sayFace(f)}`), ...(d?.removed ?? []).map((f) => `−${sayFace(f)}`)].join(', ') || 'changed'}`;

/**
 * The faces an entry's render drew, and its baseline's (the `.psig` header), for `annotateRow`.
 * The header is read only when the render recorded fonts.
 * @param {{ workspaceRoot: string }} P
 * @param {{ sig?: string }} e
 * @param {RenderResult | undefined} render
 */
export function fontsOf(P, e, render) {
  const cur = render?.fonts ?? null;
  return {
    render: cur,
    baseline: cur && e.sig ? (readHeader(resolve(P.workspaceRoot, e.sig))?.fonts ?? null) : null,
  };
}

/**
 * A mismatched row's environment difference in one line: "rendered in another environment than
 * its baseline: browser.version, fonts.used: +Arial, −a system fallback font".
 * @param {Pick<CheckRow, 'envDiff' | 'envFontsUsed'>} row
 */
export const envSentence = (row) =>
  `rendered in another environment than its baseline: ${(row.envDiff ?? [])
    .map((f) => (f === FONTS_USED ? sayFontsUsed(row.envFontsUsed) : f))
    .join(', ')}`;
