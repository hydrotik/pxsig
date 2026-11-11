/**
 * tools/rejected.mjs — pxsig_rejected: the reviewer's open rejections, read before a visual fix.
 * Each one with its reasons (an assistant's labelled as one), the checks since, what changed and
 * where (the packet's rejection.json, lib/rejections/packet.mjs), one paragraph for the fix and the
 * re-check command. Read-only: it reads the store's reports/ and needs no server.
 *
 * Crops are file references by default (store-relative paths); `images: "crops"` returns them
 * inline, `full` also baseline.png, current.png and mask.png: at most 18 images of 1.5 MB each
 * per call, the rest as paths. `closed: true` reads the last closed rejections from
 * reports/rejections.ndjson, text only. Reasons are only ever kept while the store's reports/ is
 * git-ignored (lib/rejections.mjs), so there are none to show otherwise. No answer carries an
 * absolute path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relPath } from '../lib/paths.mjs';
import { readLines } from '../lib/files.mjs';
import { lead, REJECTION_KINDS, readRejections } from '../lib/rejections.mjs';
import {
  GOAL,
  NEVER_APPROVE,
  packetFolder,
  recheck,
  rejectionPrompt,
  viaLabel,
} from '../lib/rejections/prompt.mjs';
import { ctxOf, ID_RE, MAX_IMAGE_BYTES, PROJECT, readJson, stateOf, text } from './context.mjs';
import { NO_MASK_FIX } from '../lib/assistants.mjs';

/** @import { McpContent, ReviewFile, CheckReport } from '../types/t6.js' */
/**
 * @import { CheckRejection, ClosedRejection, PacketFacts, RejectedArgs, RejectedEntry,
 *   RejectedNote, Rejection, RejectionKind, RejectionLogLine, RejectionNote, RejectionsFile
 *   } from '../types/rejections.js'
 */
/** @import { ProjectContext } from './context.mjs' */

/** Inline images per call; the rest are paths. */
export const MAX_IMAGES = 18;
const IMAGES = /** @type {const} */ (['none', 'crops', 'full']);
const KINDS = /** @type {const} */ (['all', 'visual', 'a11y']);
/** A crop file as the packet names it (packet-relative): nothing else is read. */
const CROP = /^crops\/\d+\.(baseline|current|diff)\.png$/;

/**
 * @param {RejectionNote} n
 * @returns {RejectedNote}
 */
const withFrom = (n) => ({ ...n, from: viaLabel(n.via) });

/**
 * The packet's facts (rejection.json, pxsig's own file), or null without a packet.
 * @param {ProjectContext} C
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {Rejection | null | undefined} r
 * @returns {PacketFacts | null}
 */
export function packetFacts(C, kind, id, r) {
  if (!r?.packet) return null;
  return /** @type {PacketFacts | null} */ (
    readJson(join(C.P.store.root, packetFolder(kind, id), 'rejection.json'), null)
  );
}

/**
 * One open rejection, for an answer: store-relative paths only.
 * @param {ProjectContext} C
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {Rejection} r
 * @param {{ row: CheckReport['rows'][number] | undefined, review: ReviewFile, a11yReview: ReviewFile }} now
 * @returns {RejectedEntry}
 */
export function rejectedEntry(C, kind, id, r, { row, review, a11yReview }) {
  const facts = packetFacts(C, kind, id, r);
  const packet = facts ? packetFolder(kind, id) : null;
  const first = r.notes.length ? lead(r.notes) : null;
  const note = first?.note ?? r.note;
  const via = first?.via ?? r.via;
  /** @param {string | null | undefined} f */
  const inPacket = (f) => (packet && f ? `${packet}${f}` : null);
  const state =
    kind === 'visual'
      ? row
        ? stateOf(row, review)
        : null
      : (a11yReview[id]?.state ??
        (row?.a11y ? (row.a11y.new ? 'new violations' : 'no new violations') : null));
  return {
    id,
    kind,
    state,
    note,
    via,
    from: viaLabel(via),
    at: r.at,
    notes: r.notes.map(withFrom),
    checks: r.checks,
    goal: GOAL[kind],
    metrics: facts?.metrics ?? null,
    regions: (facts?.regions ?? []).map((c) => ({
      n: c.n,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      px: c.px,
      ...(c.scale ? { scale: c.scale } : {}),
      crops:
        c.files && packet
          ? {
              baseline: `${packet}${c.files.baseline}`,
              current: `${packet}${c.files.current}`,
              diff: `${packet}${c.files.diff}`,
            }
          : null,
    })),
    text: facts?.text ?? [],
    structure: facts?.structure ?? null,
    ...(kind === 'a11y' ? { violations: facts?.violations ?? [] } : {}),
    packet,
    ...(r.packetError ? { packetError: r.packetError } : {}),
    files: {
      rejection: inPacket(facts ? 'rejection.md' : null),
      baseline: inPacket(facts?.images.baseline),
      current: inPacket(facts?.images.current),
      mask: inPacket(facts?.images.mask),
    },
    prompt: rejectionPrompt({
      id,
      project: C.P.name,
      kind,
      note,
      store: relPath(C.root, C.P.store.root),
      packet,
    }),
    next: recheck(id),
  };
}

/**
 * Images of open rejections as content items, within one budget: each crop (baseline, current,
 * diff) under a label that names the entry and the region, and with `full` the packet's
 * baseline.png, current.png and mask.png. Past the budget or the size cap, the store-relative path.
 * @param {ProjectContext} C
 * @param {RejectedEntry[]} entries
 * @param {'crops' | 'full'} mode
 * @returns {McpContent[]}
 */
export function rejectionImages(C, entries, mode) {
  /** @type {McpContent[]} */
  const out = [];
  let left = MAX_IMAGES;
  /**
   * @param {string} label
   * @param {string | null} rel store-relative
   */
  const add = (label, rel) => {
    if (!rel) return;
    const file = join(C.P.store.root, rel);
    if (!existsSync(file)) return void out.push(text(`${label}: missing (${rel})`));
    if (left <= 0)
      return void out.push(text(`${label}: not inline, ${MAX_IMAGES} images per call (${rel})`));
    const bytes = readFileSync(file);
    if (bytes.length > MAX_IMAGE_BYTES)
      return void out.push(
        text(`${label}: ${(bytes.length / 1e6).toFixed(1)} MB, too large to inline (${rel})`)
      );
    left--;
    out.push(text(`${label} (${rel}):`));
    out.push({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') });
  };
  for (const e of entries) {
    const of = e.regions.length;
    for (const c of e.regions) {
      const where = `${e.id} region ${c.n} of ${of}, ${c.x},${c.y} ${c.w}×${c.h}`;
      if (!c.crops) {
        out.push(text(`${where}: too large to crop, see ${e.files.current ?? 'current.png'}`));
        continue;
      }
      for (const k of /** @type {const} */ (['baseline', 'current', 'diff']))
        if (CROP.test(c.crops[k].slice(e.packet?.length ?? 0))) add(`${where}: ${k}`, c.crops[k]);
    }
    if (mode === 'full')
      for (const k of /** @type {const} */ (['baseline', 'current', 'mask']))
        add(`${e.id}: ${k}.png`, e.files[k]);
  }
  return out;
}

/**
 * The closed rejections in reports/rejections.ndjson, newest first: reasons and checks, no images.
 * @param {ProjectContext} C
 * @param {{ ids: Set<string> | null, kinds: RejectionKind[], limit: number }} o
 * @returns {{ total: number, entries: ClosedRejection[] }}
 */
function closedRejections(C, { ids, kinds, limit }) {
  /** @type {Map<string, { at: string | null, notes: RejectionNote[], checks: ClosedRejection['checks'] }>} */
  const open = new Map();
  /** @type {ClosedRejection[]} */
  const out = [];
  // rejections.ndjson is pxsig's own log (lib/rejections.mjs): one event per line.
  const { lines } = readLines(join(C.P.store.reports, 'rejections.ndjson'));
  for (const raw of lines) {
    const l = /** @type {Partial<RejectionLogLine> | null} */ (raw);
    if (!l || typeof l.id !== 'string' || typeof l.at !== 'string' || !l.kind) continue;
    if (!REJECTION_KINDS.includes(l.kind)) continue;
    const key = `${l.kind}\0${l.id}`;
    if (l.event === 'rejected') open.set(key, { at: l.at, notes: [], checks: [] });
    const g = open.get(key) ?? { at: null, notes: [], checks: [] };
    open.set(key, g);
    if (l.event === 'rejected' || l.event === 'note')
      g.notes.unshift({ at: l.at, via: l.via ?? '', ref: l.ref ?? '', note: l.note ?? null });
    else if (l.event === 'checked')
      g.checks.push({
        at: l.at,
        pass: !!l.pass,
        ...(l.ssim !== undefined ? { ssim: l.ssim } : {}),
        ...(l.new !== undefined ? { new: l.new } : {}),
      });
    else if (l.event === 'closed') {
      open.delete(key);
      if ((ids && !ids.has(l.id)) || !kinds.includes(l.kind)) continue;
      out.push({
        id: l.id,
        kind: l.kind,
        at: g.at,
        closedAt: l.at,
        as: l.as ?? 'removed',
        note: g.notes.length ? lead(g.notes).note : null,
        notes: g.notes.map(withFrom),
        checks: g.checks,
      });
    }
  }
  out.reverse();
  return { total: out.length, entries: out.slice(0, limit) };
}

/**
 * What `pxsig_check` says of each checked id that had an open rejection before it: closed (it
 * passes, or has no new violations) or still open.
 * @param {{ store: { reports: string } }} P
 * @param {RejectionsFile} before
 * @param {Iterable<string>} ids
 * @returns {CheckRejection[]}
 */
export function checkedRejections(P, before, ids) {
  const now = readRejections(P);
  /** @type {CheckRejection[]} */
  const out = [];
  for (const id of ids)
    for (const kind of REJECTION_KINDS) {
      if (!before[kind][id]) continue;
      const open = !!now[kind][id];
      const rejection =
        kind === 'visual'
          ? open
            ? 'open: still differs'
            : 'closed: passes'
          : open
            ? 'open: new violations remain'
            : 'closed: no new violations';
      out.push({ id, kind, rejection });
    }
  return out;
}

/**
 * The re-check line `pxsig_rejected` repeats: every shown id, and that nothing approves.
 * @param {string[]} ids
 */
export const nextLine = (ids) =>
  `After the fix: ${recheck([...new Set(ids)].join(' '))} (MCP: pxsig_check with ids). ${NEVER_APPROVE}`;

export const rejectedTools = /** @type {const} */ ([
  {
    name: 'pxsig_rejected',
    description:
      "The reviewer's rejections, with the reason and the changed regions at full size: read before a visual fix. Each open rejection: the reasons (newest first; `from` says who gave each, and an assistant's is labelled as one), the checks since, the metrics, the changed regions with their crops, the packet folder, a paragraph for the fix (`prompt`) and the re-check command (`next`). Paths are relative to the store (`store`, relative to the workspace). Crops are file references by default; `images: \"crops\"` returns them inline, `full` also the baseline, current and mask images (at most 18 images per call). `closed: true`: the last closed rejections, text only. Read-only; needs no server. Never approve: approving is the person's. " +
      NO_MASK_FIX,
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        ids: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: [...KINDS], default: 'all' },
        images: {
          type: 'string',
          enum: [...IMAGES],
          default: 'none',
          description:
            'none: file references only (default); crops: the crops inline; full: also baseline, current and mask.',
        },
        closed: {
          type: 'boolean',
          default: false,
          description: 'The last closed rejections, from the log: text only.',
        },
        limit: { type: 'number', default: 5 },
      },
      additionalProperties: false,
    },
    /**
     * Read-only and synchronous: a promise, as every tool's `run` answers.
     * @param {RejectedArgs} [args]
     */
    run(args) {
      return new Promise((ok) => ok(rejected(args)));
    },
  },
]);

/**
 * pxsig_rejected's answer.
 * @param {RejectedArgs} [args]
 */
function rejected({ project, ids, kind = 'all', images = 'none', closed = false, limit = 5 } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}: ${kind}`);
  if (!IMAGES.includes(images))
    throw new Error(`images must be one of ${IMAGES.join(', ')}: ${images}`);
  const bad = (ids ?? []).filter((id) => !ID_RE.test(id));
  if (bad.length) throw new Error(`bad ids: ${bad.join(', ')}`);
  const C = ctxOf(project);
  const want = ids?.length ? new Set(ids) : null;
  /** @type {RejectionKind[]} */
  const kinds = kind === 'all' ? [...REJECTION_KINDS] : [kind];
  const n = Math.max(1, Math.floor(Number(limit) || 5));
  if (closed) return { project: C.P.name, ...closedRejections(C, { ids: want, kinds, limit: n }) };
  const all = readRejections(C.P);
  const list = kinds
    .flatMap((k) => Object.entries(all[k]).map(([id, r]) => ({ kind: k, id, r })))
    .filter((x) => !want || want.has(x.id))
    .sort((a, b) => (b.r.notes[0]?.at ?? b.r.at).localeCompare(a.r.notes[0]?.at ?? a.r.at));
  const check = /** @type {CheckReport | null} */ (readJson(C.checkPath, null));
  const now = {
    review: /** @type {ReviewFile} */ (readJson(C.reviewPath, {})),
    a11yReview: /** @type {ReviewFile} */ (
      readJson(join(C.P.store.reports, 'a11y-review.json'), {})
    ),
  };
  const entries = list
    .slice(0, n)
    .map(({ kind: k, id, r }) =>
      rejectedEntry(C, k, id, r, { ...now, row: check?.rows.find((x) => x.id === id) })
    );
  const crops = entries.some((e) => e.regions.some((c) => c.crops));
  const head = {
    project: C.P.name,
    store: relPath(C.root, C.P.store.root),
    open: list.length,
    shown: entries.length,
    entries,
    ...(entries.length
      ? { next: nextLine(entries.map((e) => e.id)) }
      : { note: 'No open rejections.' }),
    ...(crops && images === 'none'
      ? { imagesHint: 'images: "crops" returns the crops inline' }
      : {}),
  };
  return {
    content: [text(head), ...(images === 'none' ? [] : rejectionImages(C, entries, images))],
  };
}
