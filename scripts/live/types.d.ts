// Shapes of the live screens (scripts/live/*.mjs), for their JSDoc. Types only.
import type { ScreenTarget } from '../../packages/pxsig/src/types/t4.js';

/** One action of a live step (scripts/live/flows.mjs). */
export interface LiveAction {
  click?: ScreenTarget;
  press?: string;
  /** Typed into the focused field (the reason's row). */
  type?: string;
  /** Open a fresh dashboard link on this hash. */
  link?: string;
  /** The pxsig CLI in the staged folder, against the live server. */
  cli?: string[];
  /** The scripted source change and the "after" Storybook build. */
  change?: true;
  /** A second browser context, without the link's cookie, on this hash. */
  readOnly?: string;
  /** Stop the server. */
  stop?: true;
  /** The scripted React change (Badge reads a ref during render; nothing drawn changes). */
  react?: true;
  /** With `click`: go on at once, without waiting for the server to be idle (a run to cancel). */
  busy?: true;
}

/** One step: its feature, its number within it, its actions and its landmark. */
export interface LiveStep {
  feature: string;
  n: number;
  actions: LiveAction[];
  wait: ScreenTarget;
}

/** One flow: a feature of the live catalogue. */
export interface LiveFeature {
  id: string;
  title: string;
  purpose: string;
  /** The server routes (`/__pxsig/<route>`) the flow exercises. */
  covers: string[];
  anchors?: { name: string; target: ScreenTarget }[];
}

/** One rule of the response scrub (scripts/live/volatile.mjs). */
export interface ScrubRule {
  /** Dotted path; `[]` walks every element of an array, `*` every value of an object. */
  path: string;
  /** time: FIXED_TIME · rank: FIXED_TIME − 60 min + k min, k the value's rank in the run · text: every time in it FIXED_TIME · ms: 1,000 · url: the dead URL (path kept). */
  kind: 'time' | 'rank' | 'text' | 'ms' | 'url' | 'commit';
  /** Absent or null is allowed (otherwise the path must be present). */
  optional?: boolean;
}
