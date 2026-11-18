/**
 * types/fonts.d.ts — the fonts a render's text was drawn in (lib/capture/fonts.mjs): the record
 * beside the PNG (`<id>.fonts.json`), the `.psig` header's `fonts`, and a row's `envFontsUsed`
 * when they differ from its baseline's (lib/fonts-used.mjs). docs/spec.md sections 5 and 7.
 */

/** One face: named when the page's own CSS names it or it is a web font, else a digest. */
export interface UsedFace {
  /** The family, when the page's `font-family` lists it or `web`. */
  family?: string;
  /** Otherwise: the first 8 hex of a sha-256 of the face's names (an OS fallback). */
  digest?: string;
  /** Glyphs drawn in it, summed over the elements (Chromium's count). */
  glyphs: number;
  /** From `@font-face`. */
  web: boolean;
}

export interface UsedFonts {
  v: 1;
  /** Sorted by family, digests after names. */
  used: UsedFace[];
  /** Elements with text of their own that were asked about. */
  elements: number;
}

/** How the faces differ from the baseline's: each side's faces the other lacks. */
export interface FontsUsedDiff {
  added: UsedFace[];
  removed: UsedFace[];
  /** Only system fallbacks added, for text the row's copy change brought: information, no mismatch. */
  newText?: true;
}
