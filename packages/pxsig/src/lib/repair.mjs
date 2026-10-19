/**
 * repair.mjs — deterministic, provably-safe repairs for what the integrity ledger finds.
 *
 * Guarantees (tested in test/integrity.test.mjs):
 *   - NEVER changes a signature and never approves anything. Every JS write goes through
 *     `guardWrite`, which refuses baseline files (*.psig, *.pxsig.json) and the baselines folder.
 *   - A missing baseline image is restored only when the fresh latest render passes the
 *     signature gate (Rust `pxsig check`, no cache). Rust `pxsig attach` then adds it to the
 *     `.psig`: it refuses a `.psig` that already has an image and verifies the record and
 *     signature bytes are unchanged. Otherwise the entry stays flagged and the signature
 *     reconstruction (`<id>.baseline.png`) is kept for display.
 *   - A legacy `.pxsig.json` baseline is converted to `.psig` (Rust `pxsig pack`: the same record,
 *     byte for byte, read back and compared) with its latest render as the image, only when that
 *     render passes the signature gate. The manifest entry then points at the `.psig`; the old file
 *     moves to the store trash/.
 *   - New stories are added to the manifest with no signature: they surface as NEW and wait for
 *     a person to approve their first render.
 *   - Orphans are only reported. `prune` (a person at a terminal, typed confirmation) moves them
 *     to `<store>/trash/<timestamp>/`; nothing is ever deleted.
 *   - Every action is appended to `<store>/reports/repairs.ndjson`: who, when, what, why, result.
 *
 * No LLM, no heuristics that guess: each step has a precondition it checks right before acting.
 */
import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRunManifest } from './workspace.mjs';
import { reconcile, readJson, repairLogPath, sha256File, writeJsonAtomic, SCHEMA_VERSION } from './integrity.mjs';

export const ACTIONS = ['register', 'recheck', 'restore-baseline-image', 'convert-legacy', 'prune'];
const RECHECK_CODES = ['never-checked', 'missing-render', 'stale', 'render-error'];

// --- the write guard ------------------------------------------------------------------------------------

/** Refuse any write that could touch a signature or the baselines folder. */
export function guardWrite(ctx, path) {
  const abs = resolve(path);
  const baselines = resolve(ctx.dirs.baselines) + sep;
  const pixels = ctx.pixelsRoot ? resolve(ctx.repoRoot, ctx.pixelsRoot) + sep : null;
  if (/\.(pxsig\.json|psig)$/i.test(abs) || abs.startsWith(baselines) || (pixels && abs.startsWith(pixels)))
    throw new Error(`refused: repair never writes signatures or baselines (${relative(ctx.repoRoot, abs)})`);
  return abs;
}

export function who(ctx) {
  const r = spawnSync('git', ['-C', ctx.repoRoot, 'config', 'user.email'], { encoding: 'utf8' });
  return r.stdout?.trim() || process.env.USER || process.env.USERNAME || 'unknown';
}

export function logRepair(ctx, line) {
  const p = guardWrite(ctx, repairLogPath(ctx));
  mkdirSync(dirname(p), { recursive: true });
  const full = { schemaVersion: SCHEMA_VERSION, at: new Date().toISOString(), ...line };
  appendFileSync(p, `${JSON.stringify(full)}\n`);
  return full;
}

// --- plan -------------------------------------------------------------------------------------------------

const idsWith = (ledger, codes) => ledger.entries.filter((x) => x.issues.some((i) => codes.includes(i.code)));

/**
 * The repair plan for a ledger: ordered steps, each with the entries it covers, why, and — when
 * it cannot run here — why it is blocked. `only` limits to some actions; `prune` adds the prune step.
 */
export function planRepairs(ledger, { only, prune = false, server = null } = {}) {
  const want = (a) => (!only || only.includes(a)) && (a !== 'prune' || prune);
  const sb = ledger.sources.storyIndex;
  const steps = [];
  const unregistered = idsWith(ledger, ['unregistered']);
  if (unregistered.length && want('register'))
    steps.push({
      action: 'register',
      ids: unregistered.map((x) => x.id),
      why: 'stories in the index with no manifest entry: add them (modes and states from parameters.pxsig); they arrive without a signature, as NEW, for a person to approve',
      blocked: sb.source === 'storybook' ? null : `needs a running, healthy Storybook to read parameters.pxsig (${sb.error ?? 'index not loaded'})`,
    });
  const recheck = idsWith(ledger, RECHECK_CODES).filter((x) => x.files);
  if (recheck.length && want('recheck')) {
    const why = {};
    for (const x of recheck) for (const i of x.issues) if (RECHECK_CODES.includes(i.code)) why[i.code] = (why[i.code] ?? 0) + 1;
    steps.push({
      action: 'recheck',
      ids: recheck.map((x) => x.id),
      why: `re-render and re-check (${Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ')}); never writes baselines`,
      blocked: server?.up || sb.source === 'storybook' ? null : `needs the pxsig server or a healthy Storybook (${sb.error ?? 'index not loaded'})`,
    });
  }
  const missing = idsWith(ledger, ['missing-baseline-image']);
  if (missing.length && want('restore-baseline-image'))
    steps.push({
      action: 'restore-baseline-image',
      ids: missing.map((x) => x.id),
      why: 'restore each missing baseline image from its latest render, only where that render passes the signature gate (fresh Rust check, no cache); otherwise leave it flagged and keep the signature reconstruction for display',
      blocked: null,
    });
  const legacy = idsWith(ledger, ['legacy-format']);
  if (legacy.length && want('convert-legacy'))
    steps.push({
      action: 'convert-legacy',
      ids: legacy.map((x) => x.id),
      why: 'convert each legacy .pxsig.json baseline to .psig with its latest render as the image, only where that render passes the signature gate; the record and signature bytes are packed unchanged and the old file moves to the store trash/',
      blocked: null,
    });
  const orphans = idsWith(ledger, ['orphaned']);
  if (orphans.length && want('prune'))
    steps.push({
      action: 'prune',
      ids: orphans.map((x) => x.id),
      why: 'move orphaned signatures / baseline images to the store trash//<timestamp>/ and drop manifest entries whose story is gone (nothing is deleted)',
      blocked: null,
      needsPerson: true,
    });
  const manual = [];
  for (const [code, what] of [
    ['changed', 'review in the dashboard (A approves, R rejects)'],
    ['flaky', 're-check, then review if it keeps failing'],
    ['unbaselined', 'NEW: approve its first render in the dashboard'],
    ['a11y-new', 'fix the violation or accept it into the a11y baseline'],
  ]) {
    const xs = idsWith(ledger, [code]);
    if (xs.length) manual.push({ code, count: xs.length, what, sample: xs.slice(0, 5).map((x) => x.id) });
  }
  if (orphans.length && !prune) manual.push({ code: 'orphaned', count: orphans.length, what: 'report only: `pxsig doctor --repair --prune --apply` (a person at a terminal) moves them to the store\'s trash/', sample: orphans.slice(0, 5).map((x) => x.id) });
  return { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), basedOn: ledger.generatedAt, steps, manual };
}

// --- register: sync the manifest from the story index ------------------------------------------------------


/**
 * Add stories to the manifest. Existing entries are untouched (same objects, same order); new
 * entries go after the last entry of their story file. The previous manifest is kept in
 * `<store>/reports/manifest-history/`. Baselines are never created: new entries are unbaselined.
 */
export async function registerStories(ctx, stories, { harvest }) {
  const { expandEntries } = await import('./manifest.mjs');
  const { entryConfig } = await import('./workspace.mjs');
  const manifest = readJson(ctx.manifestPath, null);
  const have = new Set(manifest.stories.map((e) => e.story ?? e.id));
  const todo = stories.filter((s) => !have.has(s.id));
  if (!todo.length) return { added: [], skipped: [], adoptedSignatures: [] };
  const params = await harvest(todo.map((s) => s.id));
  const errors = Object.entries(params).filter(([, p]) => p?.error);
  if (errors.length) throw new Error(`could not read parameters for ${errors.map(([id, p]) => `${id} (${p.error})`).join(', ')}`);
  const list = todo.map((s) => ({ id: s.id, importPath: s.importPath, sigFor: (key) => ctx.project.sigFor(key, s.importPath) }));
  const { entries, skipped } = expandEntries(entryConfig(ctx.project), list, params);
  const ids = new Set(manifest.stories.map((e) => e.id));
  const fresh = entries.filter((e) => !ids.has(e.id));
  // An old signature at a new entry's path (a story renamed back) is adopted, not trusted blindly: logged.
  const adoptedSignatures = fresh.filter((e) => existsSync(resolve(ctx.repoRoot, e.sig))).map((e) => e.id);
  const stories2 = [...manifest.stories];
  for (const e of fresh) {
    let at = -1;
    for (let i = 0; i < stories2.length; i++) if (stories2[i].importPath === e.importPath) at = i;
    if (at === -1) stories2.push(e);
    else stories2.splice(at + 1, 0, e);
  }
  const backupDir = guardWrite(ctx, join(ctx.dirs.reports, 'manifest-history'));
  mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, `manifest.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  copyFileSync(ctx.manifestPath, guardWrite(ctx, backup));
  const next = { ...manifest, skipped: [...(manifest.skipped ?? []), ...skipped.filter((s) => !(manifest.skipped ?? []).some((x) => x.id === s.id))], stories: stories2 };
  writeJsonAtomic(guardWrite(ctx, ctx.manifestPath), next, { pretty: true });
  return { added: fresh.map((e) => e.id), skipped, adoptedSignatures, backup: relative(ctx.repoRoot, backup) };
}

// --- restore: the signature gate decides --------------------------------------------------------------

/**
 * Fresh Rust check of the latest renders against their signatures (no cache, no history), with
 * every artifact written to a scratch folder. Returns id → { pass, metrics, reasons, error, reconstructed }.
 */
export function gateLatest(ctx, ids) {
  if (!existsSync(ctx.rustBin)) throw new Error(`Rust CLI not built: ${relative(ctx.repoRoot, ctx.rustBin)}`);
  const scratch = guardWrite(ctx, join(ctx.dirs.reports, '.integrity-gate'));
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const only = join(scratch, 'only.json');
  writeFileSync(only, JSON.stringify(ids));
  const run = writeRunManifest(ctx.project, ctx.manifestPath).path;
  const r = spawnSync(ctx.rustBin, ['check', '--manifest', run, '--png-dir', ctx.dirs.latest, '--root', ctx.repoRoot, '--only', `@${only}`, '--json', '--artifacts', 'all', '--out-dir', join(scratch, 'out')], { cwd: ctx.repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status === 2 || !r.stdout) throw new Error(`pxsig check failed: ${r.stderr || r.stdout}`);
  const out = new Map();
  for (const row of JSON.parse(r.stdout).results) {
    const rec = join(scratch, 'out', `${row.id}.baseline.png`);
    out.set(row.id, { pass: row.pass === true, metrics: row.metrics ?? null, reasons: row.reasons ?? [], error: row.error ?? null, reconstructed: existsSync(rec) ? rec : null });
  }
  return { results: out, scratch };
}

export function restoreBaselineImages(ctx, ledger, ids, { by, via }) {
  const byId = new Map(ledger.entries.map((x) => [x.id, x]));
  const results = [];
  const candidates = [];
  for (const id of ids) {
    const x = byId.get(id);
    const latest = join(ctx.dirs.latest, `${id}.png`);
    if (!x?.files) results.push({ id, result: 'skipped', why: 'not a manifest entry' });
    else if (x.files.baseImage) results.push({ id, result: 'skipped', why: 'baseline image already present' });
    else if (!x.files.sigExists) results.push({ id, result: 'skipped', why: 'no signature to gate against' });
    else if (!x.files.sig.endsWith('.psig')) results.push({ id, result: 'skipped', why: 'a .pxsig.json baseline cannot hold an image: migrate the store to .psig' });
    else if (!existsSync(latest)) results.push({ id, result: 'blocked', why: 'no latest render: run the recheck step first' });
    else if (x.issues.some((i) => i.code === 'stale')) results.push({ id, result: 'blocked', why: 'the latest render is stale: re-check first' });
    else candidates.push(id);
  }
  if (candidates.length) {
    const { results: gate, scratch } = gateLatest(ctx, candidates);
    for (const id of candidates) {
      const g = gate.get(id) ?? { pass: false, error: 'no gate result' };
      const latest = join(ctx.dirs.latest, `${id}.png`);
      const psig = resolve(ctx.repoRoot, byId.get(id).files.sig);
      if (g.pass) {
        // Rust adds the image without touching the record; it refuses a .psig that has one.
        const a = spawnSync(ctx.rustBin, ['attach', psig, latest, '--json'], { encoding: 'utf8' });
        if (a.status === 0) results.push({ id, result: 'restored', why: 'latest render passes the signature gate', gate: { pass: true, ssim: g.metrics?.ssim ?? null, identical: g.metrics?.identical ?? null }, sha256: sha256File(latest) });
        else results.push({ id, result: 'failed', why: (a.stderr || a.stdout).trim().split('\n').pop() });
      } else {
        let fallback = null;
        if (g.reconstructed) {
          mkdirSync(ctx.dirs.diff, { recursive: true });
          fallback = guardWrite(ctx, join(ctx.dirs.diff, `${id}.baseline.png`));
          copyFileSync(g.reconstructed, fallback);
        }
        results.push({ id, result: 'unrecoverable: changed', why: g.error ?? (g.reasons[0] ? `latest render fails the gate: ${g.reasons[0]}` : 'latest render fails the gate'), gate: { pass: false, ssim: g.metrics?.ssim ?? null }, fallback: fallback ? relative(ctx.repoRoot, fallback) : null });
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const r of results) logRepair(ctx, { by, via, action: 'restore-baseline-image', id: r.id, why: r.why, result: r.result, ...(r.gate ? { gate: r.gate } : {}), ...(r.sha256 ? { sha256: r.sha256 } : {}), ...(r.fallback ? { fallback: r.fallback } : {}) });
  return results;
}

// --- convert-legacy: .pxsig.json → .psig, the gate decides -------------------------------------------

export function convertLegacy(ctx, ledger, ids, { by, via }) {
  const byId = new Map(ledger.entries.map((x) => [x.id, x]));
  const results = [];
  const candidates = [];
  for (const id of ids) {
    const x = byId.get(id);
    const latest = join(ctx.dirs.latest, `${id}.png`);
    if (!x?.files) results.push({ id, result: 'skipped', why: 'not a manifest entry' });
    else if (!x.files.sig.endsWith('.pxsig.json')) results.push({ id, result: 'skipped', why: 'not a legacy .pxsig.json baseline' });
    else if (!x.files.sigExists) results.push({ id, result: 'skipped', why: 'no baseline file' });
    else if (!existsSync(latest)) results.push({ id, result: 'blocked', why: 'no latest render: run the recheck step first' });
    else if (x.issues.some((i) => i.code === 'stale')) results.push({ id, result: 'blocked', why: 'the latest render is stale: re-check first' });
    else candidates.push(id);
  }
  const moved = new Map();
  if (candidates.length) {
    const { results: gate, scratch } = gateLatest(ctx, candidates);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const id of candidates) {
      const g = gate.get(id) ?? { pass: false, error: 'no gate result' };
      const x = byId.get(id);
      const from = resolve(ctx.repoRoot, x.files.sig);
      const toRel = x.files.sig.replace(/\.pxsig\.json$/, '.psig');
      const to = resolve(ctx.repoRoot, toRel);
      if (!g.pass) {
        results.push({ id, result: 'unrecoverable: changed', why: g.error ?? `latest render fails the gate${g.reasons[0] ? `: ${g.reasons[0]}` : ''}: review it before converting` });
        continue;
      }
      if (existsSync(to)) {
        results.push({ id, result: 'blocked', why: `${toRel} already exists` });
        continue;
      }
      const latest = join(ctx.dirs.latest, `${id}.png`);
      const entry = JSON.stringify({ id, story: x.story ?? null, mode: x.mode ?? null, state: x.state ?? null });
      // Rust packs the record unchanged and reads it back: the signature bytes cannot move.
      const r = spawnSync(ctx.rustBin, ['pack', from, '--out', to, '--image', latest, '--entry', entry, '--json'], { encoding: 'utf8' });
      if (r.status !== 0) {
        results.push({ id, result: 'failed', why: (r.stderr || r.stdout).trim().split('\n').pop() });
        continue;
      }
      const dest = join(ctx.dirs.trash, stamp, relative(ctx.repoRoot, from));
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(from, dest);
      moved.set(id, toRel);
      results.push({ id, result: 'converted', why: 'latest render passes the signature gate', to: toRel, trash: relative(ctx.repoRoot, dest), sha256: sha256File(to) });
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  if (moved.size) {
    const manifest = readJson(ctx.manifestPath, null);
    const backupDir = guardWrite(ctx, join(ctx.dirs.reports, 'manifest-history'));
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(ctx.manifestPath, guardWrite(ctx, join(backupDir, `manifest.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)));
    writeJsonAtomic(guardWrite(ctx, ctx.manifestPath), { ...manifest, stories: manifest.stories.map((e) => (moved.has(e.id) ? { ...e, sig: moved.get(e.id) } : e)) }, { pretty: true });
  }
  for (const r of results) logRepair(ctx, { by, via, action: 'convert-legacy', id: r.id, why: r.why, result: r.result, ...(r.to ? { to: r.to, trash: r.trash, sha256: r.sha256 } : {}) });
  return results;
}

// --- prune: move, never delete ---------------------------------------------------------------------

export function pruneOrphans(ctx, ledger, ids, { by, via }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trash = join(ctx.dirs.trash, stamp);
  const byId = new Map(ledger.entries.map((x) => [x.id, x]));
  const moved = [];
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
    const manifest = readJson(ctx.manifestPath, null);
    mkdirSync(join(trash, 'manifest'), { recursive: true });
    copyFileSync(ctx.manifestPath, join(trash, 'manifest', 'manifest.json'));
    writeJsonAtomic(guardWrite(ctx, ctx.manifestPath), { ...manifest, stories: manifest.stories.filter((e) => !dropEntries.has(e.id)) }, { pretty: true });
  }
  for (const m of moved) logRepair(ctx, { by, via, action: 'prune', id: m.id, why: 'orphaned: no story / no manifest entry', result: 'moved', from: m.from, to: m.to });
  for (const id of dropEntries) logRepair(ctx, { by, via, action: 'prune', id, why: 'story no longer in the index', result: 'manifest entry removed' });
  return { trash: relative(ctx.repoRoot, trash), moved, droppedEntries: [...dropEntries] };
}

// --- default hooks: the running server when it is up, else check.mjs / Playwright ----------------------

export async function serverStatus(serverUrl) {
  try {
    const r = await fetch(`${serverUrl}/__pxsig/status`, { signal: AbortSignal.timeout(1500) });
    const s = await r.json();
    return { up: true, running: !!s.running, queued: s.queued ?? 0 };
  } catch {
    return { up: false };
  }
}

export function defaultHooks(ctx, { serverUrl, timeoutMs = 15 * 60_000 } = {}) {
  return {
    async recheck(ids) {
      const srv = await serverStatus(serverUrl);
      if (srv.up) {
        const res = await fetch(`${serverUrl}/__pxsig/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: ctx.project.name, ids }) });
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
      const r = await new Promise((ok) => {
        const checkJs = join(dirname(fileURLToPath(import.meta.url)), '..', 'check.mjs');
        const p = spawn(process.execPath, [checkJs, '--project', ctx.project.name, '--only', ids.join(','), '--retries', '1'], { cwd: ctx.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        p.stdout.on('data', (d) => (log += d));
        p.stderr.on('data', (d) => (log += d));
        p.on('exit', (code) => ok({ code, log }));
      });
      if (r.code === 2) throw new Error(`check.mjs setup error: ${r.log.split('\n').slice(-5).join(' ')}`);
      return { via: 'check.mjs' };
    },
    async harvest(ids) {
      const { harvestParameters } = await import('./manifest.mjs');
      return harvestParameters(ctx.project, ctx.config.baseUrl, ids);
    },
  };
}

// --- apply ---------------------------------------------------------------------------------------------

/**
 * Run a plan's steps in order (register → recheck → restore → prune), re-reconciling between
 * steps so each acts on fresh facts. `hooks`: { recheck(ids), harvest(ids), confirmPrune(n) }.
 * Returns { steps: [{ action, result }], ledger } with the ledger after the repairs.
 */
export async function applyRepairs(ctx, plan, { hooks, via = 'cli', by = who(ctx), reconcileOpts = {} } = {}) {
  const done = [];
  let ledger = null;
  const fresh = async () => (ledger = await reconcile(ctx, reconcileOpts));
  for (const step of plan.steps) {
    if (step.blocked) {
      done.push({ action: step.action, result: 'blocked', why: step.blocked });
      logRepair(ctx, { by, via, action: step.action, ids: step.ids, why: step.why, result: 'blocked', blocked: step.blocked });
      continue;
    }
    if (step.action === 'register') {
      const idx = (await fresh()).entries.filter((x) => step.ids.includes(x.id) && x.status === 'unregistered');
      const r = await registerStories(ctx, idx.map((x) => ({ id: x.id, importPath: x.importPath })), { harvest: hooks.harvest });
      for (const id of step.ids) logRepair(ctx, { by, via, action: 'register', id, why: 'unregistered: in the story index, not in the manifest', result: 'added to the manifest without a signature (NEW, needs approval)', entries: r.added.filter((e) => e === id || e.startsWith(`${id}__`) || e.startsWith(`${id}@`)) });
      done.push({ action: 'register', result: `${r.added.length} entries added from ${step.ids.length} stories`, ...r });
    } else if (step.action === 'recheck') {
      const r = await hooks.recheck(step.ids);
      logRepair(ctx, { by, via, action: 'recheck', ids: step.ids, why: step.why, result: `re-checked via ${r.via}` });
      done.push({ action: 'recheck', result: `${step.ids.length} entries re-checked via ${r.via}` });
    } else if (step.action === 'restore-baseline-image') {
      const res = restoreBaselineImages(ctx, await fresh(), step.ids, { by, via });
      const n = (k) => res.filter((r) => r.result === k).length;
      done.push({ action: step.action, result: `${n('restored')} restored · ${n('unrecoverable: changed')} unrecoverable (changed) · ${n('blocked')} blocked · ${n('skipped')} skipped`, details: res });
    } else if (step.action === 'convert-legacy') {
      const res = convertLegacy(ctx, await fresh(), step.ids, { by, via });
      const n = (k) => res.filter((r) => r.result === k).length;
      done.push({ action: step.action, result: `${n('converted')} converted · ${n('unrecoverable: changed')} changed (left as they are) · ${n('blocked')} blocked · ${n('skipped')} skipped`, details: res });
    } else if (step.action === 'prune') {
      if (!hooks.confirmPrune || !(await hooks.confirmPrune(step.ids.length))) {
        done.push({ action: 'prune', result: 'not confirmed: nothing moved' });
        continue;
      }
      const r = pruneOrphans(ctx, await fresh(), step.ids, { by, via });
      done.push({ action: 'prune', result: `${r.moved.length} files moved to ${r.trash}`, ...r });
    }
  }
  return { steps: done, ledger: await fresh() };
}
