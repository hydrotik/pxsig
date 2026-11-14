/**
 * types/parity.d.ts — shapes for the rendered-alignment rules (dashboard-check/alignment.mjs) and the
 * source-parity check (dashboard-check/parity.mjs). Types only.
 */
import type { LayoutFinding } from './t4.js';

/** A dot or icon and the capitals of its label, in one row (CSS px, viewport coordinates). */
export interface AlignmentPair {
  /** The row, as findings name an element: `<span "Live">`. */
  name: string;
  /** An svg; a round element (a status dot); any other small drawn box (a check mark's box). */
  graphic: 'dot' | 'icon' | 'mark';
  /** The label as drawn (after text-transform). */
  text: string;
  /** The row's box `[x, y, width, height]`, its block axis inside its border and padding. */
  row: [number, number, number, number];
  /** The graphic's box. */
  box: [number, number, number, number];
  /** Column ranges `[left, right]` of the label's capitals and digits. */
  caps: [number, number][];
  /** The centre of the graphic's box, and of the row's (line) box: block axis. */
  boxCentre: number;
  lineCentre: number;
  lineHeight: string;
  /** The label's largest font size (CSS px). */
  fontSize: number;
  /** Why the row sits on a half pixel, when it does. */
  half: string | null;
}

/** What `alignmentTargets` returns from the page. */
export interface AlignmentTargets {
  dpr: number;
  pairs: AlignmentPair[];
  /** The whole-pixel findings, measured from the boxes. */
  edges: LayoutFinding[];
}

/** An ink band's edges, in device px rows of the screenshot (sub-pixel). */
export interface InkBand {
  top: number;
  bottom: number;
}

/** A pair measured on the screenshot. `offset`: the capitals' centre minus the graphic's (CSS px). */
export interface InkOffset {
  pair: AlignmentPair;
  caps: InkBand;
  graphic: InkBand;
  offset: number;
  capsCentre: number;
  graphicCentre: number;
}

/** A difference the adapter makes on purpose (conformance.json `parity[].expect`). */
export interface ParityExpect {
  /** `root/0 <span>` as findings name it; unset: any element. */
  element?: string;
  property: string;
  reason: string;
}

/** A pair, as conformance.json declares it under a component. */
export interface ParityDeclaration {
  /** The Storybook story id. */
  story: string;
  /** Story args set in the URL (Storybook's `args=`), so it draws the dashboard's text. */
  args?: Record<string, string | number | boolean>;
  /** The contract component's props (JSON only). */
  props?: Record<string, unknown>;
  children?: string;
  /** This story's root, when it differs from `parity.storyRoot`. */
  storyRoot?: string;
  expect?: ParityExpect[];
}

export interface ParityPair extends ParityDeclaration {
  component: string;
}

/** The parts of an adapter's conformance.json the parity check reads. */
export interface ParityConformance {
  components?: Record<string, { status?: string; note?: string; parity?: ParityDeclaration[] }>;
  parity?: {
    /** Where a story's component root is, under the design system's decorators. */
    storyRoot?: string;
    /** Storybook `globals=` per theme (`theme:dark`). */
    globals?: Partial<Record<'dark' | 'light', string>>;
  };
}

/** A component's elements, as `parityTree` reads them. */
export interface ParityTree {
  text: string;
  /** The root's position in the page. */
  at: [number, number];
  nodes: {
    path: string;
    tag: string;
    text: string;
    /** `[x, y, width, height]` relative to the root. */
    box: [number, number, number, number];
    css: Record<string, string>;
    loaded: boolean;
  }[];
}

/** One side of a pair, measured. */
export interface ParitySide {
  tree: ParityTree;
  /** Each dot or icon's offset from its label's capitals (CSS px; positive: capitals lower). */
  offsets: { name: string; graphic: string; offset: number }[];
}

export interface ParityDifference {
  element: string;
  property: string;
  story: string;
  adapter: string;
  /** The reason, when the adapter makes it on purpose. */
  expected?: string;
}

export interface ParityResult {
  component: string;
  story: string;
  theme: 'dark' | 'light';
  rendered: boolean;
  reason: string | null;
  differences: ParityDifference[];
  /** Both sides as measured, when the pair rendered. */
  measured: { story: ParitySide; adapter: ParitySide } | null;
}
