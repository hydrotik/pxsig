/**
 * lib/gate-report.mjs — a gate report for one entry: what someone posts in a public issue on
 * hydrotik/pxsig when the gate got it wrong (a change flagged when nothing changed, or missed).
 * One module for the server (`GET /__pxsig/gate-report`, the inspector's Report to pxsig), the
 * CLI (`pxsig report <id>`) and MCP (`pxsig_gate_report`), so all three hand out the same thing:
 *
 *   text    the issue form's sections (.github/ISSUE_TEMPLATE/gate.yml): versions, the entry and
 *           its mode, the resolved gate (the color rule included), the metrics, every reason, the
 *           changed regions' boxes, the environment class (OS family, browser major, GPU class)
 *   image   one PNG: baseline | render | diff, cropped to the changed regions with a small margin
 *           (`full`: the whole capture); none with `noImage`, which lists each region's average
 *           colours in the baseline and the render instead
 *   url     the form, opened with those fields filled (lib/gate-report/text.mjs)
 *
 * Minimal by default: the story id becomes `entry-1` (`keepId` keeps it, with its state), and no
 * path, user name or host name is ever in the text, the link or the facts (`scrub` also replaces
 * any that slipped into a value). Nothing here opens a network connection: the person opens the
 * link and posts. `writeGateReport` keeps it in the store's reports/gate-report/<id>/.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { readJson } from './files.mjs';
import { relPath } from './paths.mjs';
import { readImage } from './psig.mjs';
import { readPng } from './rejections/crops.mjs';
import { PXSIG_VERSION, engineVersion } from './workspace.mjs';
import {
  composite,
  cropBox,
  cropScale,
  MARGIN,
  regionColours,
  topRegions,
} from './gate-report/image.mjs';
import { gateText, issueUrl } from './gate-report/text.mjs';
/** @import { CheckRow } from '../types.js' */
/** @import { DiffFn } from '../types/rejections.js' */
/** @import { EnvFields } from '../types/env.js' */

/** The story id's stand-in, unless the person keeps the id. */
export const ENTRY_STAND_IN = 'entry-1';
/** An entry id (docs/spec.md#entry-id): nothing else is joined into a path. */
const SAFE_ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;

/**
 * What the report reads of a project (a lib/workspace.mjs Project has it all).
 * @typedef {{ workspaceRoot: string, rustBin: string, manifestPath: (suite?: string | null) => string,
 *   store: { root: string, reports: string, latest: string } }} ReportProject
 */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/**
 * The report's facts: report.json, and what the text and the link are made of.
 * @typedef {{ v: 1, entry: string, mode: string | null, state: string | null, pxsig: string,
 *   engine: string | null, verdict: 'fails' | 'passes', gate: Record<string, unknown> | null,
 *   metrics: Record<string, unknown> | null, color: Record<string, unknown> | null,
 *   detail: Record<string, unknown> | null, reasons: string[],
 *   pixels: { width: number, height: number, changed: number, maxDelta: number, regions: number },
 *   regions: { x: number, y: number, w: number, h: number, px: number, baseline?: string, render?: string }[],
 *   environment: { render: string | null, baseline: string | null, match: string },
 *   image: { crop: 'regions' | 'full', margin: number, box: Box, scale: number, width: number, height: number } | null
 * }} GateFacts
 */
/** @typedef {{ full?: boolean, keepId?: boolean, noImage?: boolean }} GateReportOptions */
/**
 * @typedef {{ facts: GateFacts, text: string, url: string, trimmed: string[], image: Buffer | null }} GateReport
 */

/** A report that cannot be made, with a message safe to show: no path, no name. */
export class GateReportError extends Error {}

const OS = /** @type {Record<string, string>} */ ({
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
});
/** A word of an environment field, or nothing: anything else could name a machine. */
const word = (/** @type {unknown} */ v) =>
  typeof v === 'string' && /^[\w.+-]{1,40}$/.test(v) ? v : null;

/**
 * An environment as a class: OS family and architecture, browser and its major version, GPU class
 * (lib/env/collect.mjs `gpuClass`), and whether it ran in a container. Null without one.
 * @param {EnvFields | null | undefined} e
 */
export function envClass(e) {
  if (!e) return null;
  const platform = word(e.os?.platform);
  const os = [platform ? (OS[platform] ?? platform) : 'unknown OS', word(e.os?.arch)];
  const major = word(String(e.browser?.version ?? '').split('.')[0]) ?? '?';
  return [
    os.filter(Boolean).join(' '),
    `${word(e.browser?.name) ?? 'browser'} ${major}`,
    `GPU ${word(e.render?.gpu) ?? 'unknown'}`,
    ...(e.container?.image ? ['container'] : []),
  ].join(' · ');
}

/**
 * Every way a folder may be written: as given, resolved through links (macOS's /var is
 * /private/var), and with forward slashes; longest first.
 * @param {string} p
 */
function spellings(p) {
  if (!p) return [];
  const all = new Set([p]);
  try {
    all.add(realpathSync.native(p));
  } catch {
    // gone: as given
  }
  // A copy: the loop adds to the set.
  for (const x of Array.from(all)) {
    if (x.startsWith('/private/')) all.add(x.slice('/private'.length));
    all.add(x.replaceAll('\\', '/'));
  }
  return [...all].sort((a, b) => b.length - a.length);
}

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace what could name a person, a machine or a project: the id and story (unless kept) by
 * `entry-1`, the workspace and home folders, the user name.
 * @param {string} s
 * @param {{ id: string, story?: string | null, keepId?: boolean, roots?: string[], user?: string | null }} o
 */
export function scrub(s, { id, story, keepId = false, roots = [], user = null }) {
  let out = s;
  if (!keepId)
    for (const name of [id, story].filter((x) => typeof x === 'string' && x.length > 2))
      out = out.split(/** @type {string} */ (name)).join(ENTRY_STAND_IN);
  for (const [i, r] of roots.entries())
    for (const root of spellings(r))
      if (root.length > 1) out = out.split(root).join(i ? '~' : '<workspace>');
  if (user && user.length > 1)
    out = out.replace(new RegExp(`(?<![\\w])${escapeRe(user)}(?![\\w])`, 'gi'), '<user>');
  return out;
}

/**
 * Scrub every string in a value (the facts), keeping its shape.
 * @template T
 * @param {T} v
 * @param {Parameters<typeof scrub>[1]} o
 * @returns {T}
 */
function scrubAll(v, o) {
  /** @type {unknown} */
  const out =
    typeof v === 'string'
      ? scrub(v, o)
      : Array.isArray(v)
        ? v.map((/** @type {unknown} */ x) => scrubAll(x, o))
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubAll(x, o)]))
          : v;
  // The same shape as `v`, its strings scrubbed.
  return /** @type {T} */ (out);
}

/** @param {CheckRow['detail']} d */
const detailOf = (d) => {
  if (!d || typeof d !== 'object') return null;
  const { tripped: _tripped, ...rest } = /** @type {Record<string, unknown>} */ (d);
  return rest;
};

/**
 * The gate report of one entry, from its last check: its check row, its baseline image and its
 * latest render, compared with the engine's `diff` (the caller's: the server's engine, or the
 * binary). Throws GateReportError when there is nothing to report.
 * @param {ReportProject} P
 * @param {string} id
 * @param {GateReportOptions & { diff: DiffFn, user?: string | null }} o
 * @returns {Promise<GateReport>}
 */
export async function gateReport(
  P,
  id,
  { full = false, keepId = false, noImage = false, diff, user }
) {
  if (!SAFE_ID.test(id)) throw new GateReportError(`not an entry id: ${id}`);
  const check = /** @type {{ rows?: CheckRow[], envs?: Record<string, EnvFields> } | null} */ (
    readJson(join(P.store.reports, 'check.json'), null)
  );
  const row = check?.rows?.find((r) => r.id === id);
  if (!row || row.skipped) throw new GateReportError(`no check result for ${id}: check it first`);
  if (row.error) throw new GateReportError(`${id} did not render: there is nothing to compare`);
  const entry = /** @type {{ stories?: { id: string, sig?: string }[] } | null} */ (
    readJson(P.manifestPath(), null)
  )?.stories?.find((e) => e.id === id);
  const base = entry?.sig ? readImage(resolve(P.workspaceRoot, entry.sig)) : null;
  if (row.new || !base) throw new GateReportError(`${id} has no baseline image to compare with`);
  const latest = join(P.store.latest, `${id}.png`);
  if (!existsSync(latest)) throw new GateReportError(`${id} has no render yet: check it first`);

  const tmp = mkdtempSync(join(tmpdir(), 'pxsig-report-'));
  try {
    writeFileSync(join(tmp, 'baseline.png'), base);
    const d = await diff(join(tmp, 'baseline.png'), latest, join(tmp, 'mask.png'));
    const images = {
      baseline: readPng(base),
      current: readPng(readFileSync(latest)),
      mask: existsSync(join(tmp, 'mask.png')) ? readPng(readFileSync(join(tmp, 'mask.png'))) : null,
    };
    const listed = topRegions(d.regions ?? []);
    const colours = noImage ? regionColours(images, listed) : null;
    const W = d.width || Math.max(images.baseline.width, images.current.width);
    const H = d.height || Math.max(images.baseline.height, images.current.height);
    const crop = full ? null : cropBox(d.regions ?? [], W, H);
    const box = crop ?? { x: 0, y: 0, w: W, h: H };
    const made = noImage ? null : composite(images, box, crop ? cropScale(box) : 1);
    const envs = check?.envs ?? {};
    /** @type {GateFacts} */
    const raw = {
      v: 1,
      entry: keepId ? id : ENTRY_STAND_IN,
      mode: row.mode ?? null,
      state: keepId ? (row.state ?? null) : null,
      pxsig: PXSIG_VERSION,
      engine: engineVersion(P.rustBin),
      verdict: row.pass ? 'passes' : 'fails',
      gate: /** @type {Record<string, unknown> | null} */ (row.gate ?? null),
      metrics: /** @type {Record<string, unknown> | null} */ (row.metrics ?? null),
      color: /** @type {Record<string, unknown> | null} */ (row.color ?? null),
      detail: detailOf(row.detail),
      reasons: row.reasons ?? [],
      pixels: {
        width: W,
        height: H,
        changed: d.changed,
        maxDelta: d.maxDelta,
        regions: d.regions?.length ?? 0,
      },
      regions: listed.map((r, i) => ({
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        px: r.px,
        ...(colours ? colours[i] : {}),
      })),
      environment: {
        render: envClass(row.env ? envs[row.env] : null),
        baseline: envClass(row.baselineEnv ? envs[row.baselineEnv] : null),
        match: row.envMatch ?? 'unknown',
      },
      image: made
        ? {
            crop: crop ? 'regions' : 'full',
            margin: crop ? MARGIN : 0,
            box,
            scale: crop ? cropScale(box) : 1,
            width: made.width,
            height: made.height,
          }
        : null,
    };
    const facts = scrubAll(raw, {
      id,
      story: row.story ?? null,
      keepId,
      roots: [P.workspaceRoot, homedir()],
      user: user === undefined ? safeUser() : user,
    });
    const { url, trimmed } = issueUrl(facts);
    return { facts, text: gateText(facts), url, trimmed, image: made?.png ?? null };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** This machine's user name, for `scrub`; null when the OS will not say. */
function safeUser() {
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}

/** The report's folder, store-relative: `reports/gate-report/<id>/`. */
export const reportFolder = (/** @type {string} */ id) => `reports/gate-report/${id}/`;

/**
 * Keep a report in the store's reports/gate-report/<id>/: report.md (the text, then the link),
 * report.json (the facts, the link and what was cut from it) and image.png (none for an
 * image-free report; an earlier one is removed). Answers the store-relative folder and files.
 * @param {ReportProject} P
 * @param {string} id
 * @param {GateReport} r
 */
export function writeGateReport(P, id, r) {
  if (!SAFE_ID.test(id)) throw new GateReportError(`not an entry id: ${id}`);
  const dir = join(P.store.reports, 'gate-report', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), `${r.text}\n### Issue link\n\n${r.url}\n`);
  writeFileSync(
    join(dir, 'report.json'),
    `${JSON.stringify({ ...r.facts, url: r.url, trimmed: r.trimmed }, null, 2)}\n`
  );
  if (r.image) writeFileSync(join(dir, 'image.png'), r.image);
  else rmSync(join(dir, 'image.png'), { force: true });
  const folder = `${relPath(P.store.root, dir)}/`;
  return {
    folder,
    files: ['report.md', 'report.json', ...(r.image ? ['image.png'] : [])].map((f) => folder + f),
  };
}
