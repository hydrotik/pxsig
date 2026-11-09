// Open rejections (lib/rejections.mjs): a rejection's reason, kept past the entry's next check
// until it closes. In the store's git-ignored reports/ only.

/** The two kinds of decision a rejection is about. */
export type RejectionKind = 'visual' | 'a11y';

/** One reason given: a reject, or a reject again on an entry already rejected (a new reason). */
export interface RejectionNote {
  at: string;
  /** How it reached the server: `dashboard`, `cli`, or `mcp` (an assistant at the person's request). */
  via: string;
  /** The decision's opaque reference. */
  ref: string;
  /** One line, at most 280 characters; null: no reason given. */
  note: string | null;
}

/** A check of the entry since it was rejected. */
export interface RejectionCheck {
  at: string;
  pass: boolean;
  /** Visual: the check's SSIM. */
  ssim?: number | null;
  /** Accessibility: the violations not on the accepted list. */
  new?: number;
}

/** An open rejection (reports/rejections.json). */
export interface Rejection {
  /** When it opened, and that decision's reference. */
  at: string;
  ref: string;
  /** The leading reason: the newest a person gave, else the newest. */
  via: string;
  note: string | null;
  /** Every reason, newest first (at most 20). */
  notes: RejectionNote[];
  /** The checks since, oldest first (the last 20). */
  checks: RejectionCheck[];
  /** The rejection packet's folder, store-relative; null until one is written. */
  packet: string | null;
  /** Why no packet was written (lib/rejections/packet.mjs); absent once one is. */
  packetError?: string;
}

/** reports/rejections.json: the open rejections by kind, then entry id. */
export interface RejectionsFile {
  visual: Record<string, Rejection>;
  a11y: Record<string, Rejection>;
}

/** How an open rejection closed (the `closed` line of reports/rejections.ndjson). */
export type RejectionClose =
  | 'passed'
  | 'approved'
  | 'accepted'
  | 'undone'
  | 'dismissed'
  | 'removed';

/** What `afterCheck` changed. */
export interface AfterCheck {
  closed: { kind: RejectionKind; id: string; as: RejectionClose }[];
  checked: { kind: RejectionKind; id: string; record: Rejection }[];
}

// --- the packet (lib/rejections/packet.mjs) -----------------------------------------------------

/** `rejections` in pxsig.config.json, resolved (lib/rejections/packet.mjs `rejectionOptions`). */
export interface RejectionOptions {
  /** Reject opens the dashboard's note row; false: one-key reject. */
  noteAsk: boolean;
  /** Write packets; false: reasons only. */
  packet: boolean;
  /** Padding around each changed region, in px. */
  pad: number;
  /** Crops per packet. */
  max: number;
  /** Nearest-neighbour upscale: `auto` (short side at least 160px, at most 4×), 1, 2 or 4. */
  scale: 'auto' | 1 | 2 | 4;
  /** A 1px outline of each changed region on every crop. */
  annotate: boolean;
  /** Committed structure locks, project-relative, compared with `reports/structure/`; null: none. */
  structure: string | null;
}

/** The engine's `diff` (crates/pxsig-cli/src/cmd_check.rs `diff_json`): full-size pixels. */
export interface PixelDiff {
  width: number;
  height: number;
  changed: number;
  changedPct?: number;
  maxDelta: number;
  regions: { x: number; y: number; w: number; h: number; px: number }[];
}

/** Baseline against current, with the mask written to `mask`. */
export type DiffFn = (a: string, b: string, mask: string) => Promise<PixelDiff>;

/** One crop: a padded box around one or more changed regions (merged where they overlap). */
export interface PacketCrop {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Changed pixels inside it. */
  px: number;
  /** The changed regions inside it, unpadded. */
  areas: { x: number; y: number; w: number; h: number }[];
  /** The upscale; absent when the crop was left out (`tooLarge`). */
  scale?: number;
  /** Packet-relative: `crops/<n>.baseline.png`, `.current.png`, `.diff.png`. */
  files?: { baseline: string; current: string; diff: string };
  tooLarge?: true;
}

/** rejection.json: what rejection.md says, for tools. Paths are packet-, store- or workspace-relative. */
export interface PacketFacts {
  v: 1;
  kind: RejectionKind;
  id: string;
  project: string;
  story: string | null;
  mode: string | null;
  state: string | null;
  at: string;
  via: string;
  ref: string;
  note: string | null;
  notes: RejectionNote[];
  checks: RejectionCheck[];
  goal: string;
  /** The re-check command. */
  next: string;
  /** One paragraph for an assistant (lib/rejections/prompt.mjs). */
  prompt: string;
  /** The store, workspace-relative. */
  store: string;
  /** This folder, store-relative. */
  packet: string;
  /** The baseline file, workspace-relative; null for a new entry. */
  baseline: string | null;
  images: { baseline: string | null; current: string | null; mask: string | null };
  metrics: {
    ssim: number | null;
    changedCellsPct: number | null;
    changedPx: number;
    maxDelta: number;
    regions: number;
    gate: string[];
  } | null;
  regions: PacketCrop[];
  /** The text labels as sentences (lib/text/say.mjs `textLines`). */
  text: string[];
  /** Against the structure lock: "Same as the lock", or the first differing line; null: no lock. */
  structure: string | null;
  /** Accessibility: the violations not on the accepted list. */
  violations?: import('./run.js').A11yViolation[];
  writtenAt: string;
}

// --- reading them (tools/rejected.mjs: pxsig_rejected, pxsig rejected) ---------------------------

/** `pxsig_rejected`. */
export interface RejectedArgs {
  project?: string;
  ids?: string[];
  kind?: RejectionKind | 'all';
  /** `none` (default): file references only; `crops`: the crops inline; `full`: also the images. */
  images?: 'none' | 'crops' | 'full';
  closed?: boolean;
  limit?: number;
}

/** One reason, as `pxsig_rejected` gives it: `from` says who gave it, in words. */
export interface RejectedNote extends RejectionNote {
  from: string;
}

/** A changed region of an open rejection; `crops` are store-relative (null: too large to crop). */
export interface RejectedRegion {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  scale?: number;
  crops: { baseline: string; current: string; diff: string } | null;
}

/** One open rejection, as `pxsig_rejected` and `pxsig rejected` give it. Paths are store-relative. */
export interface RejectedEntry {
  id: string;
  kind: RejectionKind;
  /** The entry's state now (pxsig_list's), or for accessibility its decision or violations. */
  state: string | null;
  note: string | null;
  via: string;
  from: string;
  at: string;
  notes: RejectedNote[];
  checks: RejectionCheck[];
  goal: string;
  metrics: PacketFacts['metrics'];
  regions: RejectedRegion[];
  text: string[];
  structure: string | null;
  violations?: PacketFacts['violations'];
  packet: string | null;
  packetError?: string;
  files: {
    rejection: string | null;
    baseline: string | null;
    current: string | null;
    mask: string | null;
  };
  prompt: string;
  next: string;
}

/** A closed rejection, from reports/rejections.ndjson: text only. */
export interface ClosedRejection {
  id: string;
  kind: RejectionKind;
  at: string | null;
  closedAt: string;
  as: RejectionClose;
  note: string | null;
  notes: RejectedNote[];
  checks: RejectionCheck[];
}

/** What `pxsig_check` says of each checked entry that had an open rejection. */
export interface CheckRejection {
  id: string;
  kind: RejectionKind;
  rejection: string;
}

/** One line of reports/rejections.ndjson (lib/rejections.mjs): an event of one rejection. */
export interface RejectionLogLine {
  event: 'rejected' | 'note' | 'checked' | 'closed';
  kind: RejectionKind;
  id: string;
  at: string;
  via?: string;
  ref?: string;
  note?: string | null;
  pass?: boolean;
  ssim?: number | null;
  new?: number;
  as?: RejectionClose;
}
