/**
 * A check row's text labels as the server sends them (`textDiff`, from the engine; the same shape
 * as packages/pxsig/src/types/text.d.ts, docs/spec.md "Text labels"). Labels only: beside the
 * verdict, never changing it.
 */

/** A box in the screenshot's frame, CSS px: `[x, y, width, height]`. */
export type TextBox = [number, number, number, number];

/** What one text change is. */
export type TextChangeKind = 'copy' | 'moved' | 'rewrapped' | 'restyled' | 'added' | 'removed';

/** An entry's text kind, the first that applies; null when nothing in text differs. */
export type TextKind = 'pixel' | 'restyled' | 'moved' | 'copy-reflow' | 'copy';

/** One change a row lists. */
export interface TextChange {
  kind: TextChangeKind;
  /** A copy change: the baseline's string and the render's. */
  was?: string;
  now?: string;
  /** Any other change: the string. */
  s?: string;
  /** A copy change equal after collapsing whitespace. */
  whitespace?: boolean;
  /** The font facts that differ. */
  facts?: string[];
  /** The move of its first box, px. */
  dx?: number;
  dy?: number;
  /** Moved by a copy change's growth; `pushedBy` is that change's index in `changes`, when listed. */
  pushed?: boolean;
  pushedBy?: number;
  /** More runs moved the same way by the same push, folded into this one. */
  same?: number;
  key?: string;
  path: string;
  /** Its first box: the render's, or the baseline's for a removed run. */
  box: TextBox;
}

export type TextCompared = {
  v: 1;
  state: 'compared';
  kind: TextKind | null;
  kinds: TextChangeKind[];
  counts: Record<'runs' | TextChangeKind, number>;
  outsidePx?: number;
  insidePx?: number;
  elementPx?: number;
  /** The first 20 changes, largest first. */
  changes: TextChange[];
  changeCount: number;
  truncated?: boolean;
};

export type TextDiff =
  | TextCompared
  | { v: 1; state: 'env-differs' | 'no-baseline' }
  | { v: 1; state: 'error'; error: string };
