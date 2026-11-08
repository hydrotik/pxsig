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
