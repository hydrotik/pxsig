/**
 * approvals/record-repair.mjs — "Repair baseline records": the one batch write of a baseline that
 * approves no change. A baseline whose record and image come from different renders
 * (`baseline-pair-mismatch`, lib/pairs.mjs) gets its record written again from its own image, and
 * nothing else of it changes (the engine's `rerecord`: the image, masks, header keys and sections
 * stay byte for byte). Only an entry that meets every condition is eligible:
 *
 *   1. its record and image differ (the engine's `pairs`);
 *   2. its latest render is the baseline image, pixel for pixel (the engine's decoded 8-bit RGBA
 *      and size: a render's PNG encoding may differ from the stored image's);
 *   3. that render passes the current record under every rule except the colour rule (the gate as
 *      0.7.6 had it): the engine's `check`, with `color: false` on every gate layer;
 *   4. its approval log holds only `pxsig migrate` lines, no one else's, and its bytes are the ones
 *      the last of them logged.
 *
 * Every other mismatched entry is listed with each condition it fails, and goes through review one
 * entry at a time. A repair never writes an image, never changes masks, thresholds or config, and
 * runs only from `pxsig approve repair-records --yes` (a person at a terminal) or the dashboard's
 * action (the dashboard link): never from the safe repairs (lib/repair.mjs) or any automatic path.
 *
 * The plan pins each entry's file sha256; applying re-plans and writes only the planned entries
 * that are still eligible with the same bytes. Each write is snapshotted to `history/<batch>/` and
 * logged as a person's line of its own kind, `record-repair`, with the file's and the record's
 * sha256 before and after. That line is not a review: integrity/unreviewed.mjs carries the state of
 * the line it follows, and `pxsig approve verify` checks that the record it logged matches its image.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLine, readJson } from '../files.mjs';
import { mismatched, pairsOf } from '../pairs.mjs';
import { spawnSync } from '../spawn.mjs';
import { runManifest } from '../workspace/run-manifest.mjs';
import { decisionRef, newBatch, paths, readLog, sha256, snapshot, stamp } from './core.mjs';
/** @import { ApprovalLine, Manifest, ManifestEntry, Project } from '../../types.js' */

export const REPAIR_KIND = 'record-repair';
/** How long a listed plan may be applied from (as `approve plan`'s). */
export const PLAN_MAX_AGE_H = 24;

/**
 * One mismatched entry of a plan: `file` is the baseline's sha256 when planned, `record` and
 * `image` the record's and the image's signature sha256; `why` (eligible) or `reasons`.
 * @typedef {{ id: string, file: string | null, record: string, image: string, why?: string, reasons?: string[] }} RepairItem
 * @typedef {{ createdAt: string, checked: number, mismatched: number, eligible: RepairItem[], ineligible: RepairItem[] }} RepairPlan
 */

/** @param {Project} P */
export const planFile = (P) => join(P.store.reports, 'record-repair-plan.json');

/**
 * Run `fn` with a temporary folder for the engine's input files, removed after: planning writes
 * nothing to the store.
 * @template T
 * @param {(dir: string) => T} fn
 * @returns {T}
 */
function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-record-repair-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The run manifest the engine reads, for these entries (every entry when `ids` is null), in `dir`.
 * @param {string} dir
 * @param {Project} P
 * @param {Manifest} manifest
 * @param {Set<string> | null} ids
 * @param {boolean} [colourOff] every gate layer with `color: false`
 */
function runFile(dir, P, manifest, ids, colourOff = false) {
  const run = runManifest(P, manifest);
  run.stories = run.stories.filter((e) => !ids || ids.has(e.id));
  // The engine reads any subset of a gate: each layer with the colour rule off.
  const body = colourOff
    ? {
        ...run,
        gate: { ...run.gate, color: false },
        stories: run.stories.map((e) => ({ ...e, gate: { ...e.gate, color: false } })),
      }
    : run;
  const file = join(dir, colourOff ? 'gate.json' : 'run.json');
  writeFileSync(file, JSON.stringify(body));
  return file;
}

/**
 * Condition 3: each entry's latest render against its current record, every rule but colour.
 * @param {Project} P
 * @param {Manifest} manifest
 * @param {string[]} ids
 * @returns {Map<string, { pass?: boolean, reasons?: string[], error?: string }>}
 */
function gateWithoutColour(P, manifest, ids) {
  if (!ids.length) return new Map();
  const c = withTemp((dir) => {
    const file = runFile(dir, P, manifest, new Set(ids), true);
    return spawnSync(
      P.rustBin,
      [
        'check',
        '--manifest',
        file,
        '--png-dir',
        P.store.latest,
        '--root',
        P.workspaceRoot,
        '--json',
        '--artifacts',
        'none',
      ],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
    );
  });
  // Exit 1: an entry fails; 2: the engine could not check.
  if (c.status !== 0 && c.status !== 1)
    throw new Error(`the engine's check failed: ${String(c.stderr || c.stdout).trim()}`);
  // The engine's `check --json` report.
  const out =
    /** @type {{ results: { id: string, pass?: boolean, reasons?: string[], error?: string }[] }} */ (
      JSON.parse(String(c.stdout))
    );
  return new Map(out.results.map((x) => [x.id, x]));
}

/**
 * The plan: every mismatched entry of the manifest, eligible or with each condition it fails.
 * Reads only: the engine's input files go to a temporary folder.
 * @param {Project} P
 * @param {Manifest} manifest
 * @returns {RepairPlan}
 */
export function planRecordRepair(P, manifest) {
  const got = pairsOf(P.rustBin, P.manifestPath(), P.workspaceRoot, { pngDir: P.store.latest });
  if (!got.rows) throw new Error(got.error);
  const byId = new Map(manifest.stories.map((e) => [e.id, e]));
  /** @type {Map<string, ApprovalLine[]>} */
  const lines = new Map();
  for (const l of readLog(P)) lines.set(l.id, [...(lines.get(l.id) ?? []), l]);
  /** @type {(RepairItem & { rendered: boolean, reasons: string[] })[]} */
  const items = [];
  for (const x of mismatched(got.rows)) {
    const e = byId.get(x.id);
    if (!e) continue;
    const p = paths(P, e);
    const file = sha256(p.sig);
    /** @type {string[]} */
    const reasons = [];
    const rendered = existsSync(p.latestPng);
    if (!rendered) reasons.push('no latest render');
    else if (!x.pixels || x.latestPixels !== x.pixels)
      reasons.push('the latest render is not the baseline image pixel for pixel');
    const own = lines.get(x.id) ?? [];
    const vias = [...new Set(own.filter((l) => l.via !== 'migrate').map((l) => l.via))];
    if (!own.length) reasons.push('no approval log line');
    else if (vias.length) reasons.push(`approved by more than pxsig migrate (${vias.join(', ')})`);
    else if (own[own.length - 1].after !== file)
      reasons.push('its bytes are not the ones pxsig migrate logged');
    items.push({
      id: x.id,
      file,
      record: String(x.record),
      image: String(x.image),
      rendered,
      reasons,
    });
  }
  const verdicts = gateWithoutColour(
    P,
    manifest,
    items.filter((x) => x.rendered).map((x) => x.id)
  );
  for (const x of items) {
    if (!x.rendered) continue;
    const v = verdicts.get(x.id);
    if (v?.pass !== true)
      x.reasons.push(
        `the latest render fails the current record without the colour rule${v?.reasons?.length ? `: ${v.reasons.join('; ')}` : v?.error ? `: ${v.error}` : ''}`
      );
  }
  /** @param {typeof items[number]} x @returns {RepairItem} */
  const item = ({ rendered: _r, reasons, ...x }) =>
    reasons.length
      ? { ...x, reasons }
      : {
          ...x,
          why: `record ${x.record.slice(0, 12)} differs from its image ${x.image.slice(0, 12)}; the latest render is the image pixel for pixel and passes the record under every rule but colour; only pxsig migrate approved it`,
        };
  return {
    createdAt: new Date().toISOString(),
    checked: got.rows.length,
    mismatched: items.length,
    eligible: items.filter((x) => !x.reasons.length).map(item),
    ineligible: items.filter((x) => x.reasons.length).map(item),
  };
}

/**
 * The planned entries a repair may write now: eligible in a fresh plan, with the planned bytes.
 * The rest are named with why.
 * @param {RepairPlan} fresh
 * @param {{ id: string, file: string | null }[]} planned
 */
export function stillEligible(fresh, planned) {
  const now = new Map(fresh.eligible.map((x) => [x.id, x]));
  /** @type {RepairItem[]} */
  const go = [];
  /** @type {{ id: string, why: string }[]} */
  const dropped = [];
  for (const x of planned) {
    const n = now.get(x.id);
    if (!n) dropped.push({ id: x.id, why: 'no longer eligible' });
    else if (n.file !== x.file)
      dropped.push({ id: x.id, why: 'its baseline changed since it was listed' });
    else go.push(n);
  }
  return { go, dropped };
}

/** @param {string} root */
const gitHead = (root) =>
  String(
    spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout ??
      ''
  ).trim();

/**
 * Write the records of `items` again from their own images (the engine's `rerecord`), each
 * snapshotted first and logged after: a `record-repair` line, a person's (`via` is the dashboard
 * or the CLI), with the file's and the record's sha256 before and after. The caller holds the
 * store lock and has re-planned (`stillEligible`).
 * @param {Project} P
 * @param {Manifest} manifest
 * @param {RepairItem[]} items
 * @param {{ via: 'cli' | 'dashboard', check?: () => void }} opts `check`: the lock's fence
 * @returns {{ batch: string | null, repaired: ApprovalLine[], failed: { id: string, error: string }[] }}
 */
export function applyRecordRepair(P, manifest, items, { via, check = () => {} }) {
  if (!items.length) return { batch: null, repaired: [], failed: [] };
  const byId = new Map(manifest.stories.map((e) => [e.id, e]));
  const batch = newBatch(via);
  check();
  for (const x of items) snapshot(P, /** @type {ManifestEntry} */ (byId.get(x.id)), batch);
  const r = withTemp((dir) => {
    const plan = join(dir, 'items.json');
    const run = runFile(dir, P, manifest, new Set(items.map((x) => x.id)));
    writeFileSync(plan, JSON.stringify(items.map((x) => ({ id: x.id, expect: x.file }))));
    check();
    return spawnSync(
      P.rustBin,
      ['rerecord', '--manifest', run, '--root', P.workspaceRoot, '--plan', plan],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  });
  // The engine's `rerecord` answer, one result per planned entry (exit 2 when any failed).
  const out =
    /** @type {{ results?: { id: string, error?: string, before?: string, after?: string, recordBefore?: string, recordAfter?: string }[] } | null} */ (
      r.stdout ? JSON.parse(String(r.stdout)) : null
    );
  if (!out?.results) throw new Error(`the engine's rerecord failed: ${String(r.stderr).trim()}`);
  const at = new Date().toISOString();
  const head = gitHead(P.workspaceRoot);
  /** @type {ApprovalLine[]} */
  const repaired = [];
  for (const x of out.results.filter((x) => !x.error)) {
    const line = stamp(
      {
        at,
        id: x.id,
        via,
        batch,
        ref: decisionRef(),
        kind: REPAIR_KIND,
        gitHead: head,
        before: x.before,
        after: x.after,
        recordBefore: x.recordBefore,
        recordAfter: x.recordAfter,
      },
      process.env,
      { person: true }
    );
    appendLine(P.store.approvals, line);
    repaired.push(line);
  }
  return {
    batch,
    repaired,
    failed: out.results.filter((x) => x.error).map((x) => ({ id: x.id, error: String(x.error) })),
  };
}

/**
 * Entries whose last log line is a record repair, and whose record no longer matches its image:
 * `pxsig approve verify` fails on them.
 * @param {Project} P
 * @param {string} manifestPath
 * @returns {{ id: string, record: string, image: string }[]}
 */
export function brokenRepairs(P, manifestPath) {
  /** @type {Map<string, ApprovalLine>} */
  const last = new Map();
  for (const l of readLog(P)) last.set(l.id, l);
  const ids = [...last.values()].filter((l) => l.kind === REPAIR_KIND).map((l) => l.id);
  if (!ids.length) return [];
  const got = pairsOf(P.rustBin, manifestPath, P.workspaceRoot, { only: ids });
  if (!got.rows) return ids.map((id) => ({ id, record: 'not checked', image: got.error }));
  return got.rows
    .filter((x) => x.match !== true)
    .map((x) => ({
      id: x.id,
      record: String(x.record ?? '').slice(0, 12),
      image: String(x.image ?? x.error ?? '').slice(0, 12),
    }));
}

/**
 * The plan a person listed (`approve repair-records`), or null when there is none, or it is not
 * one, or it is older than PLAN_MAX_AGE_H.
 * @param {Project} P
 * @returns {RepairPlan | null}
 */
export function listedPlan(P) {
  const plan = /** @type {RepairPlan | null} */ (readJson(planFile(P), null));
  if (!plan?.createdAt || !Array.isArray(plan.eligible)) return null;
  return (Date.now() - Date.parse(plan.createdAt)) / 3.6e6 > PLAN_MAX_AGE_H ? null : plan;
}
