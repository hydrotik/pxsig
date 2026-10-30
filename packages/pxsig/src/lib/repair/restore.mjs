/** Restore and convert-legacy (repair.mjs): the signature gate decides, Rust writes the .psig. */
import { spawnSync } from '../spawn.mjs';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { writeRunManifest } from '../workspace.mjs';
import { readJson, sha256File, writeJsonAtomic } from '../integrity.mjs';
import { guardWrite, logRepair } from './core.mjs';
/** @import { IntegrityContext } from '../integrity.mjs' */
/** @import { EntryRepairResult, GateOutcome, GateResult, GateRow, IntegrityManifest, Ledger, ManifestLedgerEntry, RepairActor } from '../../types/t3.js' */

// --- restore: the signature gate decides --------------------------------------------------------------

/**
 * Fresh Rust check of the latest renders against their signatures (no cache, no history), with
 * every artifact written to a scratch folder. Returns id → { pass, metrics, reasons, error, reconstructed }.
 * @param {IntegrityContext} ctx
 * @param {string[]} ids
 */
export function gateLatest(ctx, ids) {
  if (!existsSync(ctx.rustBin))
    throw new Error(`Rust CLI not built: ${relative(ctx.repoRoot, ctx.rustBin)}`);
  const scratch = guardWrite(ctx, join(ctx.dirs.reports, '.integrity-gate'));
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const only = join(scratch, 'only.json');
  writeFileSync(only, JSON.stringify(ids));
  const run = writeRunManifest(ctx.project, ctx.manifestPath).path;
  const r = spawnSync(
    ctx.rustBin,
    [
      'check',
      '--manifest',
      run,
      '--png-dir',
      ctx.dirs.latest,
      '--root',
      ctx.repoRoot,
      '--only',
      `@${only}`,
      '--json',
      '--artifacts',
      'all',
      '--out-dir',
      join(scratch, 'out'),
    ],
    { cwd: ctx.repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.status === 2 || !r.stdout) throw new Error(`pxsig check failed: ${r.stderr || r.stdout}`);
  /** @type {Map<string, GateResult>} */
  const out = new Map();
  // The engine's `check --json` answer (docs/spec.md section 4).
  for (const row of /** @type {{ results: GateRow[] }} */ (JSON.parse(r.stdout)).results) {
    const rec = join(scratch, 'out', `${row.id}.baseline.png`);
    out.set(row.id, {
      pass: row.pass === true,
      metrics: row.metrics ?? null,
      reasons: row.reasons ?? [],
      error: row.error ?? null,
      reconstructed: existsSync(rec) ? rec : null,
    });
  }
  return { results: out, scratch };
}

/**
 * @param {IntegrityContext} ctx
 * @param {Ledger} ledger
 * @param {string[]} ids
 * @param {RepairActor} actor
 */
export function restoreBaselineImages(ctx, ledger, ids, { by, via }) {
  const byId = new Map(ledger.entries.map((x) => [x.id, x]));
  /** @type {EntryRepairResult[]} */
  const results = [];
  /** @type {string[]} */
  const candidates = [];
  for (const id of ids) {
    const x = byId.get(id);
    const latest = join(ctx.dirs.latest, `${id}.png`);
    if (!x?.files) results.push({ id, result: 'skipped', why: 'not a manifest entry' });
    else if (x.files.baseImage)
      results.push({ id, result: 'skipped', why: 'baseline image already present' });
    else if (!x.files.sigExists)
      results.push({ id, result: 'skipped', why: 'no signature to gate against' });
    else if (!x.files.sig.endsWith('.psig'))
      results.push({
        id,
        result: 'skipped',
        why: 'a .pxsig.json baseline cannot hold an image: migrate the store to .psig',
      });
    else if (!existsSync(latest))
      results.push({ id, result: 'blocked', why: 'no latest render: run the recheck step first' });
    else if (x.issues.some((i) => i.code === 'stale'))
      results.push({ id, result: 'blocked', why: 'the latest render is stale: re-check first' });
    else candidates.push(id);
  }
  if (candidates.length) {
    const { results: gate, scratch } = gateLatest(ctx, candidates);
    for (const id of candidates) {
      /** @type {GateOutcome} */
      const g = gate.get(id) ?? { pass: false, error: 'no gate result' };
      const latest = join(ctx.dirs.latest, `${id}.png`);
      // A candidate is a manifest entry (checked above): it has files.
      const psig = resolve(
        ctx.repoRoot,
        /** @type {ManifestLedgerEntry} */ (byId.get(id)).files.sig
      );
      if (g.pass) {
        // Rust adds the image without touching the record; it refuses a .psig that has one.
        const a = spawnSync(ctx.rustBin, ['attach', psig, latest, '--json'], { encoding: 'utf8' });
        if (a.status === 0)
          results.push({
            id,
            result: 'restored',
            why: 'latest render passes the signature gate',
            gate: {
              pass: true,
              ssim: g.metrics?.ssim ?? null,
              identical: g.metrics?.identical ?? null,
            },
            sha256: sha256File(latest),
          });
        else
          results.push({
            id,
            result: 'failed',
            why: (a.stderr || a.stdout).trim().split('\n').pop(),
          });
      } else {
        let fallback = null;
        if (g.reconstructed) {
          mkdirSync(ctx.dirs.diff, { recursive: true });
          fallback = guardWrite(ctx, join(ctx.dirs.diff, `${id}.baseline.png`));
          copyFileSync(g.reconstructed, fallback);
        }
        results.push({
          id,
          result: 'unrecoverable: changed',
          why:
            g.error ??
            // The stand-in carries an error: only a gate result gets here.
            (/** @type {GateResult} */ (g).reasons[0]
              ? `latest render fails the gate: ${/** @type {GateResult} */ (g).reasons[0]}`
              : 'latest render fails the gate'),
          gate: { pass: false, ssim: g.metrics?.ssim ?? null },
          fallback: fallback ? relative(ctx.repoRoot, fallback) : null,
        });
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const r of results)
    logRepair(ctx, {
      by,
      via,
      action: 'restore-baseline-image',
      id: r.id,
      why: r.why,
      result: r.result,
      ...(r.gate ? { gate: r.gate } : {}),
      ...(r.sha256 ? { sha256: r.sha256 } : {}),
      ...(r.fallback ? { fallback: r.fallback } : {}),
    });
  return results;
}

// --- convert-legacy: .pxsig.json → .psig, the gate decides -------------------------------------------

/**
 * @param {IntegrityContext} ctx
 * @param {Ledger} ledger
 * @param {string[]} ids
 * @param {RepairActor} actor
 */
export function convertLegacy(ctx, ledger, ids, { by, via }) {
  const byId = new Map(ledger.entries.map((x) => [x.id, x]));
  /** @type {EntryRepairResult[]} */
  const results = [];
  /** @type {string[]} */
  const candidates = [];
  for (const id of ids) {
    const x = byId.get(id);
    const latest = join(ctx.dirs.latest, `${id}.png`);
    if (!x?.files) results.push({ id, result: 'skipped', why: 'not a manifest entry' });
    else if (!x.files.sig.endsWith('.pxsig.json'))
      results.push({ id, result: 'skipped', why: 'not a legacy .pxsig.json baseline' });
    else if (!x.files.sigExists) results.push({ id, result: 'skipped', why: 'no baseline file' });
    else if (!existsSync(latest))
      results.push({ id, result: 'blocked', why: 'no latest render: run the recheck step first' });
    else if (x.issues.some((i) => i.code === 'stale'))
      results.push({ id, result: 'blocked', why: 'the latest render is stale: re-check first' });
    else candidates.push(id);
  }
  /** @type {Map<string, string>} */
  const moved = new Map();
  if (candidates.length) {
    const { results: gate, scratch } = gateLatest(ctx, candidates);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const id of candidates) {
      /** @type {GateOutcome} */
      const g = gate.get(id) ?? { pass: false, error: 'no gate result' };
      // A candidate is a manifest entry (checked above): it has files.
      const x = /** @type {ManifestLedgerEntry} */ (byId.get(id));
      const from = resolve(ctx.repoRoot, x.files.sig);
      const toRel = x.files.sig.replace(/\.pxsig\.json$/, '.psig');
      const to = resolve(ctx.repoRoot, toRel);
      if (!g.pass) {
        results.push({
          id,
          result: 'unrecoverable: changed',
          why:
            g.error ??
            // The stand-in carries an error: only a gate result gets here.
            `latest render fails the gate${/** @type {GateResult} */ (g).reasons[0] ? `: ${/** @type {GateResult} */ (g).reasons[0]}` : ''}: review it before converting`,
        });
        continue;
      }
      if (existsSync(to)) {
        results.push({ id, result: 'blocked', why: `${toRel} already exists` });
        continue;
      }
      const latest = join(ctx.dirs.latest, `${id}.png`);
      const entry = JSON.stringify({
        id,
        story: x.story ?? null,
        mode: x.mode ?? null,
        state: x.state ?? null,
      });
      // Rust packs the record unchanged and reads it back: the signature bytes cannot move.
      const r = spawnSync(
        ctx.rustBin,
        ['pack', from, '--out', to, '--image', latest, '--entry', entry, '--json'],
        { encoding: 'utf8' }
      );
      if (r.status !== 0) {
        results.push({
          id,
          result: 'failed',
          why: (r.stderr || r.stdout).trim().split('\n').pop(),
        });
        continue;
      }
      const dest = join(ctx.dirs.trash, stamp, relative(ctx.repoRoot, from));
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(from, dest);
      moved.set(id, toRel);
      results.push({
        id,
        result: 'converted',
        why: 'latest render passes the signature gate',
        to: toRel,
        trash: relative(ctx.repoRoot, dest),
        sha256: sha256File(to),
      });
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  if (moved.size) {
    // The manifest `pxsig manifest` wrote (docs/spec.md section 6).
    const manifest = /** @type {IntegrityManifest} */ (readJson(ctx.manifestPath, null));
    const backupDir = guardWrite(ctx, join(ctx.dirs.reports, 'manifest-history'));
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(
      ctx.manifestPath,
      guardWrite(
        ctx,
        join(backupDir, `manifest.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
      )
    );
    writeJsonAtomic(
      guardWrite(ctx, ctx.manifestPath),
      {
        ...manifest,
        stories: manifest.stories.map((e) =>
          moved.has(e.id) ? { ...e, sig: moved.get(e.id) } : e
        ),
      },
      { pretty: true }
    );
  }
  for (const r of results)
    logRepair(ctx, {
      by,
      via,
      action: 'convert-legacy',
      id: r.id,
      why: r.why,
      result: r.result,
      ...(r.to ? { to: r.to, trash: r.trash, sha256: r.sha256 } : {}),
    });
  return results;
}
