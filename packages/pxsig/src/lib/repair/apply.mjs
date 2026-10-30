/** Prune, the default hooks and applying a plan (repair.mjs): move, never delete. */
import { spawn } from '../spawn.mjs';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile, readJson, writeJsonAtomic } from '../integrity.mjs';
import { dropTorn } from '../files.mjs';
import { relPath } from '../paths.mjs';
import { guardWrite, logRepair, who } from './core.mjs';
import { logRegister, registerStories } from './register.mjs';
import { convertLegacy, restoreBaselineImages } from './restore.mjs';
/** @import { IntegrityContext } from '../integrity.mjs' */
/** @import { ApplyOptions, DoneStep, IntegrityManifest, IntegrityReport, IntegrityRow, Ledger, PruneResult, RecheckResult, RepairActor, RepairHooks, RepairPlan, ServerStatus } from '../../types/t3.js' */

// --- prune: move, never delete ---------------------------------------------------------------------

/**
 * @param {IntegrityContext} ctx
 * @param {Ledger} ledger
 * @param {string[]} ids
 * @param {RepairActor} actor
 * @returns {PruneResult}
 */
export function pruneOrphans(ctx, ledger, ids, { by, via }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trash = join(ctx.dirs.trash, stamp);
  const byId = new Map(ledger.entries.map((x) => [x.id, x]));
  /** @type {PruneResult['moved']} */
  const moved = [];
  /** @type {Set<string>} */
  const dropEntries = new Set();
  for (const id of ids) {
    const x = byId.get(id);
    if (!x) continue;
    const files = x.orphanFiles ?? [];
    // A manifest entry whose story is gone: drop the entry; move its files with it.
    if (x.files && x.issues.some((i) => i.code === 'orphaned')) {
      dropEntries.add(id);
      files.push(x.files.sig);
    }
    for (const f of files) {
      const src = resolve(ctx.repoRoot, f);
      if (!existsSync(src)) continue;
      const dest = join(trash, relative(ctx.repoRoot, src));
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(src, dest); // a move into the store trash/: restorable by moving it back
      moved.push({ id, from: f, to: relative(ctx.repoRoot, dest) });
    }
  }
  if (dropEntries.size) {
    // The manifest `pxsig manifest` wrote (docs/spec.md section 6).
    const manifest = /** @type {IntegrityManifest} */ (readJson(ctx.manifestPath, null));
    mkdirSync(join(trash, 'manifest'), { recursive: true });
    copyFileSync(ctx.manifestPath, join(trash, 'manifest', 'manifest.json'));
    writeJsonAtomic(
      guardWrite(ctx, ctx.manifestPath),
      { ...manifest, stories: manifest.stories.filter((e) => !dropEntries.has(e.id)) },
      { pretty: true }
    );
  }
  for (const m of moved)
    logRepair(ctx, {
      by,
      via,
      action: 'prune',
      id: m.id,
      why: 'orphaned: no story / no manifest entry',
      result: 'moved',
      from: m.from,
      to: m.to,
    });
  for (const id of dropEntries)
    logRepair(ctx, {
      by,
      via,
      action: 'prune',
      id,
      why: 'story no longer in the index',
      result: 'manifest entry removed',
    });
  return { trash: relative(ctx.repoRoot, trash), moved, droppedEntries: [...dropEntries] };
}

// --- default hooks: the running server when it is up, else check.mjs / Playwright ----------------------

/**
 * @param {string | null | undefined} serverUrl
 * @returns {Promise<ServerStatus>}
 */
export async function serverStatus(serverUrl) {
  try {
    const r = await fetch(`${serverUrl}/__pxsig/status`, { signal: AbortSignal.timeout(1500) });
    // The server's status answer (docs/server.md, GET /__pxsig/status).
    const s = /** @type {{ running?: unknown, queued?: number }} */ (await r.json());
    return { up: true, running: !!s.running, queued: s.queued ?? 0 };
  } catch {
    return { up: false };
  }
}

/**
 * @param {IntegrityContext} ctx
 * @param {{ serverUrl?: string | null, timeoutMs?: number }} [opts]
 * @returns {RepairHooks}
 */
export function defaultHooks(ctx, { serverUrl, timeoutMs = 15 * 60_000 } = {}) {
  return {
    async recheck(ids) {
      const srv = await serverStatus(serverUrl);
      if (srv.up) {
        const res = await fetch(`${serverUrl}/__pxsig/check`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: ctx.project.name, ids }),
        });
        if (!res.ok) throw new Error(`server refused the re-check: HTTP ${res.status}`);
        const t0 = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 1200));
          const s = await serverStatus(serverUrl);
          if (s.up && !s.running && !s.queued) break;
          if (Date.now() - t0 > timeoutMs) throw new Error('re-check timed out');
        }
        return { via: 'server' };
      }
      /** @type {{ code: number | null, log: string }} */
      const r = await new Promise((ok) => {
        const checkJs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'check.mjs');
        const p = spawn(
          process.execPath,
          [checkJs, '--project', ctx.project.name, '--only', ids.join(','), '--retries', '1'],
          { cwd: ctx.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let log = '';
        // stdio[1] and stdio[2] are 'pipe': both are streams.
        /** @type {import('node:stream').Readable} */ (p.stdout).on(
          'data',
          (/** @type {Buffer} */ d) => (log += d)
        );
        /** @type {import('node:stream').Readable} */ (p.stderr).on(
          'data',
          (/** @type {Buffer} */ d) => (log += d)
        );
        p.on('exit', (code) => ok({ code, log }));
      });
      if (r.code === 2)
        throw new Error(`check.mjs setup error: ${r.log.split('\n').slice(-5).join(' ')}`);
      return { via: 'check.mjs' };
    },
    harvest: async (/** @type {string[]} */ ids) => {
      const { harvestParameters } = await import('../manifest.mjs');
      return harvestParameters(ctx.project, ctx.config.baseUrl, ids);
    },
  };
}

// --- apply ---------------------------------------------------------------------------------------------

/**
 * Run a plan's steps in order (register → recheck → restore → prune), re-reconciling between
 * steps so each acts on fresh facts. `hooks`: { recheck(ids), harvest(ids), confirmPrune(n) }.
 * Returns { steps: [{ action, result }], ledger } with the ledger after the repairs.
 * @param {IntegrityContext} ctx
 * @param {RepairPlan} plan
 * @param {ApplyOptions} [opts]
 * @returns {Promise<{ steps: DoneStep[], ledger: Ledger }>}
 */
export async function applyRepairs(
  ctx,
  plan,
  // Each step calls only its own hooks: without `confirmPrune` / `confirmTorn` nothing is confirmed;
  // a register or re-check step without its hook throws, naming it (defaultHooks gives both).
  { hooks = {}, via = 'cli', by = who(ctx), reconcileOpts = {} } = {}
) {
  /** @type {DoneStep[]} */
  const done = [];
  const fresh = async () => await reconcile(ctx, reconcileOpts);
  // A copy: register appends the entries it adds to the re-check step (or adds one).
  const steps = plan.steps.map((s) => ({ ...s, ids: [...s.ids] }));
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k];
    if (step.blocked) {
      done.push({ action: step.action, result: 'blocked', why: step.blocked });
      logRepair(ctx, {
        by,
        via,
        action: step.action,
        ids: step.ids,
        why: step.why,
        result: 'blocked',
        blocked: step.blocked,
      });
      continue;
    }
    if (step.action === 'register') {
      if (!hooks.harvest)
        throw new Error('applyRepairs: a register step needs hooks.harvest (see defaultHooks)');
      const harvest = hooks.harvest;
      const idx = (await fresh()).entries.filter(
        (x) => step.ids.includes(x.id) && x.status === 'unregistered'
      );
      const r = await registerStories(
        ctx,
        // An unregistered story's entry carries its importPath (reconcile).
        idx.map((x) => ({ id: x.id, importPath: /** @type {string} */ (x.importPath) })),
        { harvest }
      );
      logRegister(ctx, r, step.ids, { by, via });
      const notes = [
        r.failed.length ? `${r.failed.length} failed` : null,
        r.adoptedSignatures.length
          ? `${r.adoptedSignatures.length} existing signatures adopted`
          : null,
      ].filter(Boolean);
      done.push({
        action: 'register',
        result: `${r.added.length} entries added from ${step.ids.length - r.failed.length} stories${notes.length ? ` (${notes.join(', ')})` : ''}`,
        ...r,
      });
      // Render what was just registered in this same run, so a new story takes one click.
      if (step.recheckAfter && r.added.length) {
        const rc = steps.slice(k + 1).find((s) => s.action === 'recheck');
        if (rc) rc.ids = [...new Set([...rc.ids, ...r.added])];
        else
          steps.splice(k + 1, 0, {
            action: 'recheck',
            ids: r.added,
            why: 'render the entries just registered; never writes baselines',
            blocked: null,
          });
      }
    } else if (step.action === 'recheck') {
      if (!step.ids.length) continue;
      if (!hooks.recheck)
        throw new Error('applyRepairs: a recheck step needs hooks.recheck (see defaultHooks)');
      const recheck = hooks.recheck;
      const readRows = () =>
        new Map(
          // check.json, pxsig's own report (lib/rows.mjs).
          (/** @type {IntegrityReport | null} */
          (readJson(join(ctx.dirs.reports, 'check.json'), null))?.rows ?? []).map((x) => [x.id, x])
        );
      const before = readRows();
      /** @type {RecheckResult} */
      let r;
      try {
        r = await recheck(step.ids);
      } catch (e) {
        // A re-check fails with an Error (defaultHooks throws them; fetch rejects with them).
        r = { via: 'server', error: /** @type {Error} */ (e).message };
      }
      // Count what the re-check actually recorded, not what it was asked to do.
      const rows = readRows();
      const recorded = step.ids.filter(
        // The row was found on the left of &&.
        (id) =>
          rows.get(id)?.checkedAt &&
          /** @type {IntegrityRow} */ (rows.get(id)).checkedAt !== before.get(id)?.checkedAt
      );
      const errors = recorded.filter((id) => rows.get(id)?.error).length;
      const result = r.error
        ? `not re-checked: ${r.error}`
        : `${recorded.length} of ${step.ids.length} entries re-checked via ${r.via}${errors ? ` (${errors} with render errors)` : ''}`;
      logRepair(ctx, {
        by,
        via,
        action: 'recheck',
        ids: step.ids,
        why: step.why,
        result: r.error ? 'failed' : `re-checked via ${r.via}`,
        recorded: recorded.length,
        ...(r.error ? { error: r.error } : {}),
      });
      done.push({
        action: 'recheck',
        result,
        recorded: recorded.length,
        ...(r.error ? { error: r.error } : {}),
      });
    } else if (step.action === 'restore-baseline-image') {
      const res = restoreBaselineImages(ctx, await fresh(), step.ids, { by, via });
      /** @param {string} k */
      const n = (k) => res.filter((r) => r.result === k).length;
      done.push({
        action: step.action,
        result: `${n('restored')} restored · ${n('unrecoverable: changed')} unrecoverable (changed) · ${n('blocked')} blocked · ${n('skipped')} skipped`,
        details: res,
      });
    } else if (step.action === 'convert-legacy') {
      const res = convertLegacy(ctx, await fresh(), step.ids, { by, via });
      /** @param {string} k */
      const n = (k) => res.filter((r) => r.result === k).length;
      done.push({
        action: step.action,
        result: `${n('converted')} converted · ${n('unrecoverable: changed')} changed (left as they are) · ${n('blocked')} blocked · ${n('skipped')} skipped`,
        details: res,
      });
    } else if (step.action === 'prune') {
      if (!hooks.confirmPrune || !(await hooks.confirmPrune(step.ids.length))) {
        done.push({ action: 'prune', result: 'not confirmed: nothing moved' });
        continue;
      }
      const r = pruneOrphans(ctx, await fresh(), step.ids, { by, via });
      done.push({ action: 'prune', result: `${r.moved.length} files moved to ${r.trash}`, ...r });
    } else if (step.action === 'log-torn') {
      if (!hooks.confirmTorn || !(await hooks.confirmTorn(step.count))) {
        done.push({ action: 'log-torn', result: 'not confirmed: nothing removed' });
        continue;
      }
      const n = dropTorn(guardWrite(ctx, ctx.files.approvals));
      logRepair(ctx, {
        by,
        via,
        action: 'log-torn',
        why: step.why,
        result: `${n} torn line(s) removed`,
      });
      done.push({
        action: 'log-torn',
        result: `${n} torn line(s) removed from ${relPath(ctx.repoRoot, ctx.files.approvals)}`,
      });
    }
  }
  return { steps: done, ledger: await fresh() };
}
