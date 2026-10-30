/** Moving a pre-0.2 store in (setup.mjs): `pxsig migrate`, packed and verified. */
import { spawnSync } from '../spawn.mjs';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { sha256 } from '../approvals.mjs';
import { writeJsonAtomic } from '../integrity.mjs';
import { SetupError, runManifest } from '../workspace.mjs';
import { toPosix } from '../paths.mjs';
import { appendLine } from '../files.mjs';
/** @import { ManifestEntry, Project } from '../../types.js' */
/** @import { EngineVerdict, LegacyManifest, MigrateManifest, MigratePlan, MigrateVerify } from '../../types/t6.js' */
import { ensureGitattributes, readJson, STORE_GITATTRIBUTES, STORE_GITIGNORE } from './shared.mjs';

// --- migration from the pre-0.2 layout -----------------------------------------------------------------

/**
 * The pre-0.2 layout's manifests (main and per suite), under the legacy folder's `js/`.
 * @param {string} from
 * @returns {{ suite: string | null, path: string }[]}
 */
function legacyManifests(from) {
  const dir = join(from, 'js');
  if (!existsSync(join(dir, 'pxsig.manifest.json')))
    throw new SetupError(`no legacy manifest at ${join(dir, 'pxsig.manifest.json')}`);
  return readdirSync(dir)
    .filter((n) => /^pxsig\.manifest(\.[a-z0-9-]+)?\.json$/.test(n))
    .sort()
    .map((n) => ({
      suite: n.match(/^pxsig\.manifest\.([a-z0-9-]+)\.json$/)?.[1] ?? null,
      path: join(dir, n),
    }));
}

/** Per-entry fields a manifest keeps; the settings the old manifest repeated come from config now. */
/** @type {(keyof ManifestEntry)[]} */
const ENTRY_KEYS = [
  'id',
  'story',
  'mode',
  'state',
  'sig',
  'importPath',
  'globals',
  'colorScheme',
  'viewport',
  'browser',
  'grid',
  'gate',
  'detail',
  'ignore',
  'interaction',
  'delay',
  'target',
  'play',
  'a11y',
];
/**
 * @param {ManifestEntry} e
 * @returns {ManifestEntry} a legacy entry's manifest keys (the old pxsig wrote every required one)
 */
const pick = (e) =>
  /** @type {ManifestEntry} */ (
    /** @type {unknown} */ (
      Object.fromEntries(ENTRY_KEYS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]))
    )
  );

/**
 * Plan (and with `apply`, run) the move of a legacy store into the project's store. The legacy
 * folder is only read. `verify` re-checks the legacy renders against old and new baselines with
 * the Rust engine and requires identical results.
 * @param {Project} P
 * @param {{ from?: string, apply?: boolean, verify?: boolean, log?: (message: string) => void }} [opts]
 * @returns {MigratePlan}
 */
export function migrateLegacy(P, { from, apply = false, verify = true, log = () => {} } = {}) {
  // The CLI always passes `from`; without it, resolve throws as before.
  from = resolve(/** @type {string} */ (from));
  const manifests = legacyManifests(from);
  // `summary` is set below, before either return.
  const plan = /** @type {MigratePlan} */ (
    /** @type {Partial<MigratePlan>} */ ({
      from,
      to: P.store.root,
      manifests: [],
      pack: [],
      copies: [],
      problems: [],
    })
  );
  /** @type {Map<string, string>} */
  const outOf = new Map();
  for (const m of manifests) {
    // a manifest the pre-0.2 pxsig wrote (checked on the next line)
    const old = /** @type {LegacyManifest | null} */ (readJson(m.path));
    if (!old?.stories) {
      plan.problems.push(`${m.path} is not a manifest`);
      continue;
    }
    const target = P.manifestPath(m.suite);
    /** @type {ManifestEntry[]} */
    const stories = [];
    for (const e of old.stories) {
      const sigOld = resolve(P.workspaceRoot, e.sig);
      const sigNew = P.sigFor(e.id, e.importPath);
      const out = resolve(P.workspaceRoot, sigNew);
      if (outOf.has(out) && outOf.get(out) !== sigOld)
        plan.problems.push(`${e.id}: two baselines map to ${sigNew}`);
      outOf.set(out, sigOld);
      stories.push({ ...pick(e), sig: sigNew });
      if (!existsSync(sigOld)) continue; // unbaselined: nothing to pack
      const img = join(from, '.renders', 'base', `${e.id}.png`);
      plan.pack.push({
        sig: sigOld,
        out,
        image: m.suite ? null : existsSync(img) ? img : null,
        entry: { id: e.id, story: e.story ?? null, mode: e.mode ?? null, state: e.state ?? null },
      });
    }
    plan.manifests.push({
      suite: m.suite,
      from: m.path,
      to: target,
      entries: stories.length,
      manifest: {
        version: 2,
        project: P.name,
        ...(m.suite ? { suite: m.suite } : {}),
        stories,
        skipped: old.skipped ?? [],
      },
    });
  }
  // Matrix entries share no images with the main manifest: a suite entry gets its image only if
  // the legacy store had one under its own id.
  for (const item of plan.pack)
    if (!item.image) {
      const img = join(from, '.renders', 'base', `${item.entry.id}.png`);
      if (existsSync(img)) item.image = img;
    }
  /** @type {[string, string][]} */
  const files = [
    ['.baselines/a11y.json', P.store.a11y],
    ['.reports/review.json', join(P.store.reports, 'review.json')],
    ['.reports/history.ndjson', join(P.store.reports, 'history.ndjson')],
    ['.reports/check.json', join(P.store.reports, 'check.json')],
  ];
  for (const m of manifests)
    if (m.suite)
      files.push([
        `.reports/check-${m.suite}.json`,
        join(P.store.reports, `check-${m.suite}.json`),
      ]);
  for (const [src, dest] of files)
    if (existsSync(join(from, src))) plan.copies.push({ from: join(from, src), to: dest });
  const approvalsFrom = join(from, '.baselines', 'approvals.ndjson');
  plan.summary = {
    manifests: plan.manifests.map((m) => `${basename(m.to)}: ${m.entries} entries`),
    baselines: plan.pack.length,
    withImage: plan.pack.filter((x) => x.image).length,
    copies: plan.copies.length,
    approvals: existsSync(approvalsFrom),
    problems: plan.problems.length,
  };
  if (!apply || plan.problems.length) return plan;

  const existing = plan.pack.filter((x) => existsSync(x.out));
  if (existing.length)
    throw new SetupError(
      `${existing.length} baselines already exist in ${P.store.root} (first: ${existing[0].out}); migrate into an empty store`
    );
  mkdirSync(P.store.reports, { recursive: true });
  const planFile = join(P.store.reports, 'migrate-plan.json');
  writeFileSync(planFile, JSON.stringify(plan.pack));
  log(`packing ${plan.pack.length} baselines`);
  const r = spawnSync(P.rustBin, ['pack', '--plan', planFile, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new SetupError(`pxsig pack failed: ${r.stderr || r.stdout}`);
  // the engine's `pack --json` report
  plan.packed = /** @type {{ summary?: unknown }} */ (JSON.parse(r.stdout)).summary;
  for (const m of plan.manifests) writeJsonAtomic(m.to, m.manifest, { pretty: true });
  for (const c of plan.copies) {
    mkdirSync(dirname(c.to), { recursive: true });
    copyFileSync(c.from, c.to);
  }
  // The approvals trail carries over, and one `migrated` line per baseline records the new file's
  // hash, so `pxsig approve verify` starts clean on the new store.
  if (existsSync(approvalsFrom)) copyFileSync(approvalsFrom, P.store.approvals);
  const at = new Date().toISOString();
  const lines = plan.pack.map((x) =>
    JSON.stringify({
      at,
      id: x.entry.id,
      by: 'pxsig migrate',
      via: 'migrate',
      batch: `migrate-${at.replace(/[:.]/g, '-')}`,
      reason: `moved from ${toPosix(relative(P.workspaceRoot, x.sig))}`,
      kind: null,
      gitHead: null,
      before: sha256(x.sig),
      after: sha256(x.out),
    })
  );
  for (const l of lines) appendLine(P.store.approvals, l);
  for (const [file, text] of [
    ['.gitignore', STORE_GITIGNORE],
    ['.gitattributes', STORE_GITATTRIBUTES],
  ])
    if (!existsSync(join(P.store.root, file))) writeFileSync(join(P.store.root, file), text);
  if (P.store.layout === 'colocated') plan.gitattributes = ensureGitattributes(P.workspaceRoot);
  if (verify) plan.verify = verifyMigration(P, plan, from, log);
  return plan;
}

/**
 * Check the legacy latest renders against the old baselines and the new ones, with the same
 * engine, gate and settings. Every entry must get the same verdict, metrics and detail result.
 * @param {Project} P
 * @param {{ manifests: MigrateManifest[] }} plan
 * @param {string} from
 * @param {(message: string) => void} [log]
 * @returns {MigrateVerify[]}
 */
export function verifyMigration(P, plan, from, log = () => {}) {
  const renders = join(from, '.renders', 'latest');
  /** @type {MigrateVerify[]} */
  const out = [];
  for (const m of plan.manifests) {
    const scratch = join(P.store.reports, '.migrate-verify', m.suite ?? 'main');
    mkdirSync(scratch, { recursive: true });
    const oldRun = join(scratch, 'old.json');
    const newRun = join(scratch, 'new.json');
    // the legacy manifest `migrateLegacy` read (it has `stories`)
    const oldManifest = {
      ...m.manifest,
      stories: /** @type {Required<LegacyManifest>} */ (readJson(m.from)).stories,
    };
    writeFileSync(oldRun, JSON.stringify(runManifest(P, oldManifest)));
    writeFileSync(newRun, JSON.stringify(runManifest(P, m.manifest)));
    /**
     * @param {string} manifest
     * @param {string} _dir
     * @returns {Map<string, EngineVerdict>}
     */
    const check = (manifest, _dir) => {
      const r = spawnSync(
        P.rustBin,
        [
          'check',
          '--manifest',
          manifest,
          '--png-dir',
          renders,
          '--root',
          P.workspaceRoot,
          '--json',
          '--artifacts',
          'none',
        ],
        { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
      );
      if (r.status === 2)
        throw new SetupError(`verification check failed: ${r.stderr || r.stdout}`);
      // the engine's `check --json` report
      return new Map(
        /** @type {{ results: EngineVerdict[] }} */ (JSON.parse(r.stdout)).results.map((x) => [
          x.id,
          x,
        ])
      );
    };
    log(
      `verifying ${m.entries} entries${m.suite ? ` (suite ${m.suite})` : ''} against ${toPosix(relative(P.workspaceRoot, renders))}`
    );
    const a = check(oldRun, join(scratch, 'old'));
    const b = check(newRun, join(scratch, 'new'));
    /** @param {EngineVerdict | undefined} x */
    const key = (x) => JSON.stringify([x?.pass, x?.metrics, x?.detail, x?.error ? 'error' : null]);
    const differ = [...a.keys()].filter((id) => key(a.get(id)) !== key(b.get(id)));
    out.push({
      suite: m.suite,
      entries: a.size,
      passOld: [...a.values()].filter((x) => x.pass === true).length,
      passNew: [...b.values()].filter((x) => x.pass === true).length,
      differ: differ.length,
      sample: differ.slice(0, 10),
    });
  }
  return out;
}
