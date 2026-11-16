/**
 * types/top-bar.d.ts — the shapes of the `top-bar` rule of `pxsig dashboard check`
 * (dashboard-check/top-bar.mjs). Types only.
 */

/** One finding: it fails the check. */
export interface TopBarFinding {
  rule: 'top-bar';
  text: string;
}

/** A control's inline extent, and why it cannot be used there (cut off, covered), if it cannot. */
export interface TopBarControl {
  box: [number, number];
  problem: string | null;
}

/** The bar measured at one width (`probeTopBar`). Without `pxsig-ui-TopNav`, only `mark` and `overflow`. */
export interface TopBarProbe {
  mark: boolean;
  overflow: number;
  rows?: number;
  wrapped?: string[];
  links?: string[];
  linkBoxes?: [number, number][];
  trigger?: TopBarControl | null;
  kept?: TopBarControl | null;
  tabbable?: string[];
  end?: string[];
  details?: string[];
}

/** What the More menu held when opened at one width. */
export type TopBarMenu = { items: string[]; loose: boolean; back: boolean } | { error: string };

/** One width of a sweep. */
export interface TopBarSample {
  width: number;
  dir: 'down' | 'up';
  m: TopBarProbe;
  menu: TopBarMenu | null;
}

/** The rule's part of the check's report. */
export interface TopBarReport {
  widths: number[];
  scenarios: string[];
  findings: TopBarFinding[];
}
