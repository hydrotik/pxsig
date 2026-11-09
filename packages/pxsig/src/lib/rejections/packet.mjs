/**
 * lib/rejections/packet.mjs — the rejection packet: everything a fix needs about one open
 * rejection, in one folder of the store's git-ignored reports/ (`reports/rejected/<id>/`,
 * `<id>.a11y/` for accessibility), never committed.
 *
 *   rejection.md     for a person and an assistant (markdown.mjs)
 *   rejection.json   the same facts, for tools
 *   baseline.png     the baseline image, out of its .psig (visual)
 *   current.png      the latest render
 *   mask.png         the changed pixels, magenta on transparent (the engine's `diff`; visual)
 *   crops/<n>.baseline.png, .current.png, .diff.png   full-size crops of the changed regions
 *
 * Written after a reject and refreshed after every check of the entry (the server's and a full
 * check's), removed when the rejection closes (lib/rejections.mjs). Only while git leaves reports/
 * out (lib/decisions.mjs `reportsIgnored`, asked by the caller): otherwise none is written and the
 * open rejection says why (`packetError`), and `pxsig doctor` reports `reports-not-ignored`.
 * `rejections.packet: false` writes none. No file holds an absolute path, a user or a host name.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { readImage } from '../psig.mjs';
import { readJson } from '../files.mjs';
import { relPath } from '../paths.mjs';
import { execFile } from '../spawn.mjs';
import { textLines } from '../text/say.mjs';
import { lead, packetDir, readRejections, removePacket, setPacket } from '../rejections.mjs';
import { makeCrops, readPng } from './crops.mjs';
import { rejectionMarkdown } from './markdown.mjs';
import { GOAL, packetFolder, recheck, rejectionPrompt } from './prompt.mjs';
/** @import { CheckRow } from '../../types.js' */
/** @import { CheckReport } from '../../types/t4.js' */
/**
 * @import { AfterCheck, DiffFn, PacketFacts, PixelDiff, Rejection, RejectionKind,
 *   RejectionOptions } from '../../types/rejections.js'
 */
/**
 * What the packet reads of a project (a lib/workspace.mjs Project has it all).
 * @typedef {{ name: string, root: string, workspaceRoot: string, rustBin: string,
 *   config: { rejections?: unknown }, manifestPath: (suite?: string | null) => string,
 *   store: { root: string, reports: string, latest: string } }} PacketProject
 */
/** @typedef {{ id: string, story?: string | null, mode?: string | null, state?: string | null, sig?: string }} PacketEntry */

/** Why a packet was not written: no file git could commit holds a reason or an image. */
export const NOT_IGNORED = 'not written: the store’s reports/ is not git-ignored';

/**
 * `rejections` in pxsig.config.json with its defaults (lib/workspace/project.mjs checks it).
 * @param {{ rejections?: unknown } | null | undefined} config
 * @returns {RejectionOptions}
 */
export function rejectionOptions(config) {
  const r = /** @type {NonNullable<import('../../types.js').Config['rejections']>} */ (
    config?.rejections ?? {}
  );
  const c = r.crop ?? {};
  return {
    noteAsk: r.note?.ask !== false,
    packet: r.packet !== false,
    pad: c.pad ?? 24,
    max: c.max ?? 6,
    scale: c.scale ?? 'auto',
    annotate: c.annotate !== false,
    structure: r.structure ?? null,
  };
}

/**
 * The engine's `diff` as a program (a full check; the server calls its own engine): exit 0 is
 * no change, 1 a change, anything else a failure.
 * @param {string} bin
 * @returns {DiffFn}
 */
export const engineDiff = (bin) => (a, b, mask) =>
  new Promise((ok, fail) => {
    execFile(
      bin,
      ['diff', a, b, '--mask', mask, '--json'],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, out) => {
        const code = /** @type {{ code?: unknown } | null} */ (err)?.code;
        if (err && code !== 1)
          return fail(new PacketError('the engine could not compare the images'));
        try {
          ok(/** @type {PixelDiff} */ (JSON.parse(String(out))));
        } catch {
          fail(new PacketError('the engine answered no comparison'));
        }
      }
    );
  });

/** A packet failure whose message is safe to keep and show: no path, no name. */
export class PacketError extends Error {}

/**
 * The first line where the entry's structure differs from its lock (`rejections.structure`):
 * pxsig's own screens write `reports/structure/<section>/<name>.aria.yml` (an id
 * `live--open-1@dark` is `live/open-1.aria.yml`). Null without a lock or a snapshot.
 * @param {PacketProject} P
 * @param {string | null} folder project-relative
 * @param {string} id
 */
export function structureLine(P, folder, id) {
  if (!folder) return null;
  const [section, name] = id.replace(/@[a-z0-9-]+$/, '').split('--');
  if (!section || !name) return null;
  const file = join(section, `${name}.aria.yml`);
  const lock = resolve(P.root, folder, file);
  const now = join(P.store.reports, 'structure', file);
  if (!existsSync(lock) || !existsSync(now)) return null;
  const a = readFileSync(lock, 'utf8').trimEnd().split('\n');
  const b = readFileSync(now, 'utf8').trimEnd().split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i])
      return `line ${i + 1}: - ${a[i] ?? '(nothing)'} / + ${b[i] ?? '(nothing)'}`.slice(0, 300);
  return 'Same as the lock';
}

/**
 * The violations of a row not on the entry's accepted list.
 * @param {CheckRow | null} row
 */
const newViolations = (row) => {
  const known = row?.a11y?.baseline ?? [];
  return (row?.a11y?.violations ?? []).filter((v) => !known.includes(v.id));
};

/**
 * Write (or rewrite) the packet of one open rejection into its folder; a half-written packet
 * never replaces a whole one (it is written beside it and renamed).
 * @param {PacketProject} P
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {{ record: Rejection, row: CheckRow | null, entry: PacketEntry | null, diff: DiffFn, opts: RejectionOptions }} o
 * @returns {Promise<PacketFacts>}
 */
export async function writePacket(P, kind, id, { record, row, entry, diff, opts }) {
  const dir = packetDir(P, kind, id);
  if (!dir) throw new PacketError('not written: not an entry id');
  const latest = join(P.store.latest, `${id}.png`);
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const hasRender = existsSync(latest);
    if (hasRender) copyFileSync(latest, join(tmp, 'current.png'));
    else if (kind === 'visual') throw new PacketError('not written: the entry has no render yet');
    const sig = entry?.sig ? resolve(P.workspaceRoot, entry.sig) : null;
    const base = kind === 'visual' && sig ? readImage(sig) : null;
    /** @type {Pick<PacketFacts, 'metrics' | 'regions'>} */
    let changed = { metrics: null, regions: [] };
    if (base) {
      writeFileSync(join(tmp, 'baseline.png'), base);
      const d = await diff(
        join(tmp, 'baseline.png'),
        join(tmp, 'current.png'),
        join(tmp, 'mask.png')
      );
      const mask = existsSync(join(tmp, 'mask.png'))
        ? readPng(readFileSync(join(tmp, 'mask.png')))
        : null;
      const images = {
        baseline: readPng(base),
        current: readPng(readFileSync(join(tmp, 'current.png'))),
        mask,
        diff: d,
      };
      const { crops, files } = makeCrops(images, opts);
      if (files.size) mkdirSync(join(tmp, 'crops'));
      for (const [name, buf] of files) writeFileSync(join(tmp, name), buf);
      const m = /** @type {{ ssim?: number, changedCellsPct?: number } | undefined} */ (
        row?.metrics
      );
      changed = {
        metrics: {
          ssim: m?.ssim ?? null,
          changedCellsPct: m?.changedCellsPct ?? null,
          changedPx: d.changed,
          maxDelta: d.maxDelta,
          regions: d.regions?.length ?? 0,
          gate: row?.reasons ?? [],
        },
        regions: crops,
      };
    }
    const facts = factsOf(P, kind, id, {
      record,
      row,
      entry,
      opts,
      changed,
      hasRender,
      base: !!base,
    });
    writeFileSync(join(tmp, 'rejection.json'), `${JSON.stringify(facts, null, 2)}\n`);
    writeFileSync(join(tmp, 'rejection.md'), rejectionMarkdown(facts));
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
    return facts;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * @param {PacketProject} P
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {{ record: Rejection, row: CheckRow | null, entry: PacketEntry | null, opts: RejectionOptions,
 *   changed: Pick<PacketFacts, 'metrics' | 'regions'>, hasRender: boolean, base: boolean }} o
 * @returns {PacketFacts}
 */
function factsOf(P, kind, id, { record, row, entry, opts, changed, hasRender, base }) {
  const store = relPath(P.workspaceRoot, P.store.root);
  const packet = packetFolder(kind, id);
  const first = lead(record.notes);
  const note = first?.note ?? record.note;
  return {
    v: 1,
    kind,
    id,
    project: P.name,
    story: entry?.story ?? row?.story ?? null,
    mode: entry?.mode ?? row?.mode ?? null,
    state: entry?.state ?? row?.state ?? null,
    at: record.at,
    via: first?.via ?? record.via,
    ref: record.ref,
    note,
    notes: record.notes,
    checks: record.checks,
    goal: GOAL[kind],
    next: recheck(id),
    prompt: rejectionPrompt({ id, project: P.name, kind, note, store, packet }),
    store,
    packet,
    baseline: base && entry?.sig ? entry.sig : null,
    images: {
      baseline: base ? 'baseline.png' : null,
      current: hasRender ? 'current.png' : null,
      mask: base ? 'mask.png' : null,
    },
    ...changed,
    text: kind === 'visual' ? textLines(row?.textDiff) : [],
    structure: structureLine(P, opts.structure, id),
    ...(kind === 'a11y' ? { violations: newViolations(row) } : {}),
    writtenAt: new Date().toISOString(),
  };
}

/**
 * The packet of one open rejection, written or refreshed, and the record that says where it is
 * (or why it is not). Never throws: a rejection stands without its packet. `ignored` is the
 * caller's `reportsIgnored(P)`.
 * @param {PacketProject} P
 * @param {RejectionKind} kind
 * @param {string} id
 * @param {{ diff: DiffFn, ignored: boolean, row?: CheckRow | null, entry?: PacketEntry | null }} o
 * @returns {Promise<{ record: Rejection | null, error: unknown }>}
 */
export async function packetFor(P, kind, id, { diff, ignored, row, entry }) {
  const record = readRejections(P)[kind][id];
  if (!record) return { record: null, error: null };
  const opts = rejectionOptions(P.config);
  if (!opts.packet || !ignored) {
    removePacket(P, kind, id);
    const r = setPacket(P, kind, id, {
      packet: null,
      packetError: opts.packet ? NOT_IGNORED : null,
    });
    return { record: r, error: null };
  }
  try {
    await writePacket(P, kind, id, {
      record,
      row: row === undefined ? rowOf(P, id) : row,
      entry: entry === undefined ? entryOf(P, id) : entry,
      diff,
      opts,
    });
    const r = setPacket(P, kind, id, { packet: packetFolder(kind, id) });
    // Closed while the packet was written: it goes with its rejection.
    if (!r) removePacket(P, kind, id);
    return { record: r, error: null };
  } catch (e) {
    const why =
      e instanceof PacketError
        ? e.message
        : 'not written: an unexpected error (the server log names it)';
    return { record: setPacket(P, kind, id, { packet: null, packetError: why }), error: e };
  }
}

/**
 * The latest check row of `id` (reports/check.json, pxsig's own file).
 * @param {PacketProject} P
 * @param {string} id
 */
const rowOf = (P, id) =>
  /** @type {CheckReport | null} */ (readJson(join(P.store.reports, 'check.json')))?.rows?.find(
    (r) => r.id === id
  ) ?? null;

/**
 * The manifest entry of `id` (the run manifest pxsig wrote).
 * @param {PacketProject} P
 * @param {string} id
 * @returns {PacketEntry | null}
 */
const entryOf = (P, id) =>
  /** @type {{ stories?: PacketEntry[] } | null} */ (readJson(P.manifestPath()))?.stories?.find(
    (e) => e.id === id
  ) ?? null;

/**
 * After a check (lib/rejections.mjs `afterCheck`): the packets of the rejections that stay open
 * are refreshed with the new render, one at a time. Closed ones were removed with their records.
 * @param {PacketProject} P
 * @param {AfterCheck} after
 * @param {{ diff: DiffFn, ignored: boolean, rows: Iterable<CheckRow>, entries?: PacketEntry[] }} o
 * @returns {Promise<{ kind: RejectionKind, id: string, record: Rejection | null, error: unknown }[]>}
 */
export async function refreshPackets(P, after, { diff, ignored, rows, entries }) {
  const byId = new Map([...rows].map((r) => [r.id, r]));
  const out = [];
  for (const { kind, id } of after.checked) {
    const entry = entries ? (entries.find((e) => e.id === id) ?? null) : undefined;
    const row = byId.get(id) ?? null;
    out.push({ kind, id, ...(await packetFor(P, kind, id, { diff, ignored, row, entry })) });
  }
  return out;
}
