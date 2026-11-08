/**
 * types/text.d.ts — text capture (text-aware diffs): the text record a capture writes beside its
 * PNG (`<id>.boxes.json`, lib/capture/boxes.mjs), what a render reports about it, and the `text`
 * settings (lib/text/config.mjs). docs/configuration.md#text and docs/spec.md section 5.
 */

/** A box in the screenshot's frame, CSS px at DPR 1, rounded to 0.01: `[x, y, width, height]`. */
export type TextBox = [number, number, number, number];

/** The font facts of a run, shared by every run that has them (`TextRecord.styles`). */
export interface TextStyle {
  family: string;
  size: number;
  weight: number | string;
  style: string;
  lineHeight: number | 'normal';
  letterSpacing: number;
  wordSpacing: number;
  transform: string;
  decoration: string;
  color: string;
  features: string;
  variation: string;
  /** `document.fonts.check` for this face: false when a fallback face drew it; null unknown. */
  loaded: boolean | null;
}

/** One Text node the screenshot draws. */
export interface TextRun {
  /** Element child indices from the capture root, then the text node's index (`0/2/1/#0`). */
  path: string;
  /** The nearest `data-testid`, or an id that is not a generated one, when no other run has it. */
  key?: string;
  /** The node's text, as in the DOM (CSS `text-transform` is a style fact, not the string). */
  s: string;
  /** Its index in `styles`. */
  st: number;
  /** One box per line fragment, clipped to the frame and to its overflow ancestors. */
  boxes: TextBox[];
}

/** A painted element box: a visible background, border or shadow, or an svg, img, canvas or video. */
export interface TextElement {
  path: string;
  tag: string;
  box: TextBox;
}

/** `<id>.boxes.json`: the text record of one render, version 1. */
export interface TextRecord {
  v: 1;
  /** The screenshot's box. */
  frame: { w: number; h: number };
  styles: TextStyle[];
  runs: TextRun[];
  elements: TextElement[];
  /** What was not recorded, by why. */
  skipped: {
    iframes: number;
    closedShadow: number;
    hidden: number;
    fields: number;
    ignored: number;
    clipped: number;
    covered: number;
    offFrame: number;
  };
  /** More than the cap (5,000 runs or 5,000 elements): the rest is not recorded. */
  truncated: boolean;
}

/** What a render reports about its text record (`RenderResult.text`), never in check.json. */
export type TextCapture =
  | { runs: number; elements: number; bytes: number; ms: number }
  | { error: string; ms: number };

/** The `text` settings for a run (lib/text/config.mjs). */
export interface TextSettings {
  /** Text capture runs. */
  on: boolean;
  /** Why it is off (`text: false`, `--no-text`, `PXSIG_TEXT=off`, a bad value, the default). */
  off: string | null;
  /** Selectors whose text is never recorded, beside each entry's `ignore` masks. */
  ignore: string[];
  /** Bad values, one line each. */
  problems: string[];
}
