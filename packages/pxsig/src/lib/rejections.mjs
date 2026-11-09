/**
 * lib/rejections.mjs — open rejections: the reason a reviewer gives on Reject (the note), kept past
 * the entry's next check, so whoever fixes the entry still has it.
 *
 * A re-check clears the decision itself (review.json, a11y-review.json), as it always has: the
 * entry waits for a person again. The open rejection stays in `reports/rejections.json` until it
 * closes: the entry passes a check (`passed`), a person approves it or accepts its violations
 * (`approved`, `accepted`), the rejection is undone (`undone`), a person dismisses the reason
 * (`dismissed`), or the entry leaves the manifest (`removed`). `reports/rejections.ndjson` keeps
 * every event (`rejected`, `note`, `checked`, `closed`), so a reason outlives its rejection.
 *
 * Both files sit in the store's `reports/`, which the store's .gitignore leaves out: the reason is
 * the reviewer's own words and is never committed. While git would pick up reports/
 * (lib/decisions.mjs `reportsIgnored`), the rejection still opens, with no note: a file git could
 * commit never holds one. Each decision carries an opaque reference
 * (`decisionRef`); no line has a user name, host name or path. An assistant's reason (via `mcp`) is
 * kept as its own note, and never leads over a person's.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { decisionRef, stamp } from './approvals.mjs';
import { reasonText, reportsIgnored } from './decisions.mjs';
import { appendLine, readJson, writeJson } from './files.mjs';
/** @import { CheckRow } from '../types.js' */
/** @import { DecisionProject } from './decisions.mjs' */
/**
 * @import { AfterCheck, Rejection, RejectionCheck, RejectionClose, RejectionKind, RejectionNote,
 *   RejectionsFile } from '../types/rejections.js'
 */

/** A reason's limit, in characters: one line. */
export const NOTE_MAX = 280;
/** @type {readonly RejectionKind[]} */
export const REJECTION_KINDS = ['visual', 'a11y'];
/** Notes and checks kept per open rejection. */
const KEEP = 20;

/**
 * A reason as stored: one line of plain text, cut at 280 characters (lib/decisions.mjs
 * `reasonText`). Nothing left (or not a string): no reason, null.
 * @param {unknown} v
 * @returns {string | null}
 */
export const sanitizeNote = (v) => reasonText(v, NOTE_MAX);

/** @param {{ store: { reports: string } }} P */
const files = (P) => ({
  json: join(P.store.reports, 'rejections.json'),
  log: join(P.store.reports, 'rejections.ndjson'),
});

/**
 * The open rejections; a missing or unreadable file reads as none.
 * @param {{ store: { reports: string } }} P
 * @returns {RejectionsFile}
 */
export function readRejections(P) {
  // rejections.json is pxsig's own file; anything else reads as empty.
  const r = /** @type {Partial<RejectionsFile> | null} */ (readJson(files(P).json, null));
  /** @param {unknown} x */
  const map = (x) =>
    /** @type {Record<string, Rejection>} */ (
      x && typeof x === 'object' && !Array.isArray(x) ? x : {}
    );
  return { visual: map(r?.visual), a11y: map(r?.a11y) };
}

/**
 * @param {{ store: { reports: string } }} P
 * @param {RejectionsFile} all
 */
const write = (P, all) => writeJson(files(P).json, all, { pretty: true });

/**
 * One event in rejections.ndjson, stamped as the approval log's lines are (`agent` under an
 * assistant's marker, the pxsig version).
 * @param {{ store: { reports: string } }} P
 * @param {Record<string, unknown> & { via?: string }} line
 */
const log = (P, line) => appendLine(files(P).log, stamp(line));

/**
 * The reason that leads: the newest a person gave, else the newest (an assistant's).
 * @param {RejectionNote[]} notes newest first
 * @returns {RejectionNote}
 */
export const lead = (notes) => notes.find((n) => n.via !== 'mcp') ?? notes[0];

/**
 * Whether a person gave any of the rejection's reasons: then an assistant may not close it.
 * @param {Rejection | undefined} r
 */
export const byPerson = (r) => !!r && r.via !== 'mcp';

/**
 * Open a rejection of `id`, or add a reason to the open one (a reject again edits the reason).
 * The note is kept only when reports/ is git-ignored: `ignored` is the caller's
 * `reportsIgnored(P)` (the server asks without blocking), else asked here, and only for a note.
 * @param {DecisionProject} P
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {{ via: string, note: string | null, at?: string, ref?: string, ignored?: boolean }} n
 * @returns {Rejection}
 */
export function openRejection(
  P,
  kind,
  id,
  { via, note, at = new Date().toISOString(), ref, ignored }
) {
  const all = readRejections(P);
  const was = all[kind][id];
  const kept = note && (ignored ?? reportsIgnored(P)) ? note : null;
  /** @type {RejectionNote} */
  const added = { at, via, ref: ref ?? decisionRef(), note: kept };
  const notes = [added, ...(was?.notes ?? [])].slice(0, KEEP);
  const first = lead(notes);
  /** @type {Rejection} */
  const record = {
    at: was?.at ?? added.at,
    ref: was?.ref ?? added.ref,
    via: first.via,
    note: first.note,
    notes,
    checks: was?.checks ?? [],
    packet: was?.packet ?? null,
    ...(was?.packetError ? { packetError: was.packetError } : {}),
  };
  all[kind][id] = record;
  write(P, all);
  log(P, { event: was ? 'note' : 'rejected', kind, id, ...added });
  return record;
}

/**
 * Close the open rejection of `id`, if there is one; the event keeps its reasons in the log.
 * `ref` and `via` are the closing decision's (none for `passed` and `removed`).
 * @param {{ store: { reports: string } }} P
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {RejectionClose} as
 * @param {{ via?: string | null, ref?: string | null }} [by]
 * @returns {Rejection | null} the closed record
 */
export function closeRejection(P, kind, id, as, { via = null, ref = null } = {}) {
  const all = readRejections(P);
  const r = all[kind][id];
  if (!r) return null;
  delete all[kind][id];
  write(P, all);
  removePacket(P, kind, id);
  log(P, closed(kind, id, as, r, { via, ref }));
  return r;
}

/**
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {RejectionClose} as
 * @param {Rejection} r
 * @param {{ via?: string | null, ref?: string | null }} by
 */
const closed = (kind, id, as, r, { via, ref }) => ({
  event: 'closed',
  kind,
  id,
  at: new Date().toISOString(),
  as,
  rejection: r.ref,
  ...(via ? { via } : {}),
  ...(ref ? { ref } : {}),
});

/**
 * What a check says about an open rejection of `kind`; null when it says nothing (not checked,
 * no accessibility results).
 * @param {RejectionKind} kind
 * @param {CheckRow} row
 * @param {string} at
 * @returns {RejectionCheck | null}
 */
function verdict(kind, row, at) {
  if (row.skipped) return null;
  if (kind === 'visual')
    return {
      at,
      pass: !!row.pass && !row.error,
      // check.json's `metrics` (docs/spec.md section 4): the engine's numbers.
      ssim: /** @type {{ ssim?: number } | null | undefined} */ (row.metrics)?.ssim ?? null,
    };
  if (row.error || !row.a11y?.violations) return null;
  const fresh = row.a11y.new ?? 0;
  return { at, pass: fresh === 0, new: fresh };
}

/**
 * After a check (the server's re-check or a full check): each checked entry with an open
 * rejection gains the check; a pass (visual), or no new violations (a11y), closes it as
 * `passed`. With `known` (the manifest's ids), rejections of entries no longer in it close as
 * `removed`.
 * @param {{ store: { reports: string } }} P
 * @param {Iterable<CheckRow>} rows
 * @param {{ known?: ReadonlySet<string> | null, at?: string }} [opts]
 * @returns {AfterCheck}
 */
export function afterCheck(P, rows, { known = null, at = new Date().toISOString() } = {}) {
  /** @type {AfterCheck} */
  const out = { closed: [], checked: [] };
  const all = readRejections(P);
  if (!Object.keys(all.visual).length && !Object.keys(all.a11y).length) return out;
  /** @type {Record<string, unknown>[]} */
  const lines = [];
  for (const row of rows)
    for (const kind of REJECTION_KINDS) {
      const r = all[kind][row.id];
      const v = r && verdict(kind, row, at);
      if (!r || !v) continue;
      if (v.pass) {
        delete all[kind][row.id];
        removePacket(P, kind, row.id);
        lines.push(closed(kind, row.id, 'passed', r, {}));
        out.closed.push({ kind, id: row.id, as: 'passed' });
        continue;
      }
      r.checks = [...r.checks, v].slice(-KEEP);
      lines.push({ event: 'checked', kind, id: row.id, ...v });
      out.checked.push({ kind, id: row.id, record: r });
    }
  if (known)
    for (const kind of REJECTION_KINDS)
      for (const [id, r] of Object.entries(all[kind]))
        if (!known.has(id)) {
          delete all[kind][id];
          removePacket(P, kind, id);
          lines.push(closed(kind, id, 'removed', r, {}));
          out.closed.push({ kind, id, as: 'removed' });
        }
  if (!lines.length) return out;
  write(P, all);
  for (const l of lines) log(P, l);
  return out;
}

/**
 * A review file (review.json, a11y-review.json) without its reasons: for answers other origins
 * read (`/__pxsig/status`) and for a static report, which is made to be shared.
 * @template {{ note?: unknown }} D
 * @param {Record<string, D> | null | undefined} file
 * @returns {Record<string, Omit<D, 'note'>>}
 */
export const withoutNotes = (file) =>
  Object.fromEntries(Object.entries(file ?? {}).map(([id, { note: _note, ...d }]) => [id, d]));

// --- the packet's folder (lib/rejections/packet.mjs writes it) -----------------------------------

/** An entry id as a folder name may hold it (docs/spec.md#entry-id): nothing else is ever joined. */
const SAFE_ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;

/**
 * The packet folder of an open rejection: `reports/rejected/<id>/`, `<id>.a11y/` for
 * accessibility. Null for an id that is not an entry id.
 * @param {{ store: { reports: string } }} P
 * @param {RejectionKind} kind
 * @param {string} id
 */
export const packetDir = (P, kind, id) =>
  SAFE_ID.test(id)
    ? join(P.store.reports, 'rejected', `${id}${kind === 'a11y' ? '.a11y' : ''}`)
    : null;

/**
 * Remove a packet: its rejection closed. The reasons stay in rejections.ndjson.
 * @param {{ store: { reports: string } }} P
 * @param {RejectionKind} kind
 * @param {string} id
 */
export function removePacket(P, kind, id) {
  const dir = packetDir(P, kind, id);
  if (dir) rmSync(dir, { recursive: true, force: true });
}

/**
 * Record where an open rejection's packet is (store-relative), or why there is none. Null when
 * the rejection closed meanwhile: the caller removes what it wrote.
 * @param {{ store: { reports: string } }} P
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {{ packet: string | null, packetError?: string | null }} at
 * @returns {Rejection | null}
 */
export function setPacket(P, kind, id, { packet, packetError = null }) {
  const all = readRejections(P);
  const r = all[kind][id];
  if (!r) return null;
  r.packet = packet;
  if (packetError) r.packetError = packetError;
  else delete r.packetError;
  write(P, all);
  return r;
}

/**
 * Remove every packet whose rejection is no longer open (and any half-written one): the server
 * does this at start. Returns how many went.
 * @param {{ store: { reports: string } }} P
 */
export function sweepPackets(P) {
  const root = join(P.store.reports, 'rejected');
  if (!existsSync(root)) return 0;
  const all = readRejections(P);
  let n = 0;
  for (const name of readdirSync(root)) {
    const a11y = name.endsWith('.a11y');
    const id = a11y ? name.slice(0, -'.a11y'.length) : name;
    if (SAFE_ID.test(id) && all[a11y ? 'a11y' : 'visual'][id]) continue;
    rmSync(join(root, name), { recursive: true, force: true });
    n++;
  }
  return n;
}
