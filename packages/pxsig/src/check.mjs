#!/usr/bin/env node
/**
 * check.mjs — the full check, Rust-first (`pxsig check`).
 *
 *   pxsig check [--project name] [--suite matrix] [--since main | --changed a.tsx,b.css.ts]
 *               [--modes dark,light] [--only id,id] [--concurrency 8] [--retries 2] [--no-a11y]
 *               [--update] [--link-base http://127.0.0.1:6070/report/] [--sarif a11y.sarif]
 *               [--warn[=gate,…]] [--enforce[=gate,…]]
 *
 * 1. select   manifest v2 entries; `--since <ref>` asks `pxsig affected` (Rust: import
 *             graph from git) and skips the rest, carrying their last result forward;
 * 2. render   the page pool (lib/capture.mjs) across browsers / viewports / themes,
 *             with masks, interaction states and an axe pass per render;
 * 3. check    `pxsig check` (Rust): per-entry gates + grids, the detail channel,
 *             a content cache, run history, and pixel-diff regions for failures;
 * 4. retry    failures re-render up to `--retries` times; a pass on retry is
 *             `flaky` (reported, not failing);
 * 5. a11y     violations compared with the a11y baseline → `new` per entry;
 * 6. report   <store>/reports/check.json, plus `pxsig report` → summary.md (PR comment)
 *             and junit.xml.
 *
 * `--update` renders the selection and writes baselines instead (`pxsig baseline`: each `.psig`
 * carries the render as its image and the environment it was rendered in) and the a11y baseline
 * (not with `--kind environment`). Exit: 0 pass · 1 change found, or a wrong --update phrase
 * · 2 setup error (with `--strict-env`, baselines from a different environment) · 3 --update
 * without a person.
 *
 * Warn mode (lib/enforcement.mjs): a gate set to `warn` in the committed config (or by `--warn`, a
 * person at a terminal) runs the same check and exits `advisoryExit` (0) where it alone would have
 * failed, with ADVISORY lead and last lines, `enforcement` in check.json and a lead in summary.md.
 * The a11y gate (new axe violations) is `warn` by default and says nothing unless one appears.
 *
 * Environment (lib/env.mjs): every row records the environment of its render and compares it with
 * its baseline's; a `mismatch` is a warning (`[check] env:`, `summary.md`, `pxsig doctor`), and
 * with `--strict-env` (config `env.strict`, `PXSIG_STRICT_ENV=1`) a refusal before rendering.
 *
 * One writer per store (lib/lock.mjs): the check takes `<store>/reports/.lock`. When the pxsig server
 * holds it (it serves this project), the selection goes through the server's queue instead
 * (POST /__pxsig/check, then wait) and the result is read back from its report; `--update`,
 * `--suite` and `--no-server` refuse instead. Another running check makes this one refuse.
 *
 * Storybook: when `storybook.url` does not answer and `storybook.staticDir` holds a build, the
 * check serves that build itself on a free port (lib/static.mjs).
 */
import { spawnSync } from './lib/spawn.mjs';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { browserPool, renderStories, STORYBOOK_ERROR } from './lib/capture.mjs';
import {
  fetchStoryIndex,
  loadStoryIndex,
  oneLine,
  reconcile,
  resolveContext,
  writeLedger,
} from './lib/integrity.mjs';
import {
  appendedSince,
  changedByRoute,
  conflictedStoreFiles,
  newBatch,
  record,
  snapshot,
} from './lib/approvals.mjs';
import { parseArgs, strFlag } from './lib/args.mjs';
import { describeLock, readLock, takeLock } from './lib/lock.mjs';
import { buildRow, storybookBroken, summarize } from './lib/rows.mjs';
import { harvestParameters } from './lib/manifest.mjs';
import { registerNamed } from './lib/repair.mjs';
import { ensureStorybook } from './lib/static.mjs';
import { ask, humanAtTerminal, whyNotPerson } from './lib/term.mjs';
import { flagLayer, openProject, writeRunManifest } from './lib/workspace.mjs';
import { relPath } from './lib/paths.mjs';
import { writeJson } from './lib/files.mjs';
import {
  annotateRow,
  byId,
  envConfig,
  envLine,
  envSummary,
  strictEnvCheck,
  strictFromEnv,
} from './lib/env.mjs';
import { PXSIG_VERSION } from './lib/workspace.mjs';
import {
  appendReadiness,
  checkCounts,
  checkFindings,
  lastLine,
  leadLine,
  outcome,
  readinessTally,
  reportBlock,
  resolveOrExit,
} from './lib/enforcement.mjs';
import { writeSarif } from './lib/sarif.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const str = (k) => strFlag(flags, k);
const die = (m, code = 2) => (console.error(`[check] ${m}`), process.exit(code));
let P;
try {
  P = openProject({
    workspace: str('workspace'),
    project: str('project'),
    flags: flagLayer(flags),
  });
} catch (e) {
  die(e.message);
}
const rustBin = P.rustBin;
const reports = P.store.reports;
const concurrency = Number(flags.concurrency) || 8;
const retries = flags.retries === undefined ? 2 : Number(flags.retries);
const suite = str('suite');
const manifestPath = P.manifestPath(suite);
let run;
try {
  run = writeRunManifest(P, manifestPath);
} catch (e) {
  die(e.message);
}
const runPath = run.path;
const manifest = run.manifest;
const pngDir = P.store.latest;
const diffDir = P.store.diffLatest;
const a11yBaselinePath = P.store.a11y;
const rel = (p) => relPath(P.workspaceRoot, p);
// A suite run keeps its own report, so the main report stays intact.
const outName = str('out') ?? (suite ? `check-${suite}` : 'check');
// --kind / --reason (with --update) are written on every log line: `--kind environment` re-takes
// baselines for a new render environment and leaves the accepted a11y list as it is.
const kind = str('kind');
if (kind != null && !/^[a-z][a-z0-9-]{0,15}$/.test(kind))
  die(
    `--kind takes a short lower-case word (up to 16 characters, e.g. environment); got "${kind}"`
  );
if ((kind != null || str('reason') != null) && !flags.update)
  die('--kind and --reason go with --update');
if (flags.update && !humanAtTerminal())
  die(
    `--update writes baselines without review: run it yourself in a terminal (${whyNotPerson()})`,
    3
  );
// A merge or rebase that left store files conflicted (decision 97): checking against one side of
// a half-merged baseline would mislead, so stop and say how to finish (docs/ci.md, "Rebasing with baselines").
const conflicted = conflictedStoreFiles(P);
if (conflicted.length)
  die(
    `${conflicted.length} store files are conflicted (a merge or rebase is not finished): ${conflicted.slice(0, 5).join(', ')}${conflicted.length > 5 ? ', …' : ''}. Take main's version of each baseline (\`git checkout --ours <file>\` during a rebase, \`--theirs\` during a merge), keep both sides' lines of a log, then \`pxsig check --since main\` and approve what changed again (docs/ci.md, "Rebasing with baselines").`
  );
// Warn mode: which gates this run enforces (only committed config, or a person's --warn, lowers one).
const enf = flags.update ? null : resolveOrExit(P, { flags }, (m) => console.error(`[check] ${m}`));
const lead = enf && leadLine(enf);
if (lead) console.log(`[pxsig] ${lead}`);
if (!existsSync(rustBin))
  die(
    `the pxsig binary is missing (${rustBin}): install the platform package, or build it with \`cargo build --release\``
  );
mkdirSync(reports, { recursive: true });

const rust = (args, { allowFail = true } = {}) => {
  const t = performance.now();
  const r = spawnSync(rustBin, args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    cwd: P.workspaceRoot,
  });
  if (r.status === 2 || (!allowFail && r.status !== 0))
    die(`pxsig ${args[0]} failed: ${r.stderr || r.stdout}`);
  return { out: r.stdout, ms: performance.now() - t, status: r.status };
};
console.log(
  `[check] project ${P.name}${suite ? ` · suite ${suite}` : ''} · ${manifest.stories.length} entries · store ${rel(P.store.root)}`
);

const t0 = performance.now();

// --- 1. select -----------------------------------------------------------------------
let entries = manifest.stories;
const modes = str('modes')?.split(',');
if (modes) entries = entries.filter((e) => modes.includes(e.mode ?? manifest.defaultMode));
const only = str('only')?.split(',');
if (only) entries = entries.filter((e) => only.includes(e.id) || only.includes(e.story));
let affected = null;
let affectedIds = null;
if (str('since') || str('changed')) {
  const how = str('changed') ? ['--files', str('changed')] : ['--since', str('since')];
  const r = rust(['affected', '--manifest', runPath, '--root', P.workspaceRoot, ...how, '--json']);
  affected = JSON.parse(r.out);
  const ids = new Set(affected.ids);
  affectedIds = ids;
  console.log(
    `[check] affected ${str('changed') ? 'by --changed' : `since ${str('since')}`}: ${affected.changed.length} changed files → ${ids.size} entries (${affected.reason}) in ${r.ms.toFixed(0)} ms`
  );
  // The fail-safe: a path the selection cannot trace selects everything, and says which (docs/ci.md).
  for (const f of (affected.failSafe ?? []).slice(0, 10))
    console.log(`[check]   all: ${f.why} (${f.class})`);
  if ((affected.failSafe?.length ?? 0) > 10)
    console.log(`[check]   … ${affected.failSafe.length - 10} more in check.json`);
  for (const [s, n] of Object.entries(affected.otherSuites ?? {}))
    console.log(`[check]   ${n} changed entries are in suite ${s}: check them with --suite ${s}`);
  const costly = (affected.unresolved ?? []).filter((u) => !u.accepted && u.selects === 'entries');
  if (costly.length)
    console.log(
      `[check]   +${new Set(costly.map((u) => u.file)).size} files with unresolved imports add their entries to every run (pxsig affected lists them)`
    );
  entries = entries.filter((e) => ids.has(e.id));
}
const selected = new Set(entries.map((e) => e.id));
// --only names the manifest does not have (a story just written): registered below, once the
// store lock is held and Storybook answers, so checking a new story is one command.
const unregistered =
  only && !suite
    ? only.filter((n) => !manifest.stories.some((e) => e.id === n || e.story === n))
    : [];
if (!entries.length && !affected && !unregistered.length) die('no entries selected');

// --- one writer per store: take the lock, or hand the run to the server that holds it ----------------
const held = readLock(P);
if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
  if (flags.update || suite || flags['no-server'])
    die(
      `${describeLock(P, held)}: ${flags.update ? '--update' : suite ? '--suite' : 'this check'} cannot run beside it. Approve in the dashboard, or stop the server and run again.`
    );
  await viaServer(held.url ?? P.serverUrl(), [...selected], unregistered);
}
let lock;
try {
  lock = await takeLock(P, { holder: flags.update ? 'check --update' : 'check' });
} catch (e) {
  console.error(`[check] ${e.message}`);
  process.exit(e.exit ?? 2);
}
/** Before each batch of store writes: stop if the lock was taken over meanwhile. */
const fence = () => {
  try {
    lock.check();
  } catch (e) {
    die(e.message);
  }
};

// --- guard: never render against a broken Storybook ------------------------------------------
// A failing index (e.g. "Unable to index files") makes every iframe show Storybook's error page;
// recording those as renders turns a setup problem into hundreds of bogus diffs or baselines.
if (entries.length || unregistered.length) {
  const sb = await ensureStorybook(P, { log: (m) => console.log(`[check] ${m}`) });
  manifest.baseUrl = P.storybook.url;
  if (sb.served) process.once('exit', () => sb.close());
}
const sbIndex =
  entries.length || unregistered.length ? await fetchStoryIndex(manifest.baseUrl) : null;
if (sbIndex && !sbIndex.reachable)
  die(
    `setup error: Storybook is not reachable at ${manifest.baseUrl} (${sbIndex.error}); start it, point storybook.url at a running build, or set storybook.staticDir to a built Storybook. Nothing was rendered.`
  );
if (sbIndex && !sbIndex.healthy)
  die(
    `setup error: Storybook's story index is broken — ${sbIndex.error}. Nothing was rendered or recorded; fix the index (see the Storybook terminal) and re-run.`
  );
if (unregistered.length) {
  const ctx = resolveContext(P, { manifestPath });
  const reg = await registerNamed(ctx, unregistered, {
    index: await loadStoryIndex(ctx, { live: sbIndex }),
    harvest: (ids) => harvestParameters(P, manifest.baseUrl, ids),
    via: 'check',
  });
  for (const x of reg.skipped) console.log(`[check] not checked: ${x.name}: ${x.why}`);
  if (reg.added.length) {
    console.log(
      `[check] registered ${reg.stories.join(', ')}: ${reg.added.length} NEW entries (no signature: a person approves their first render)`
    );
    Object.assign(manifest, writeRunManifest(P, manifestPath).manifest);
    for (const e of manifest.stories)
      if (
        reg.added.includes(e.id) &&
        (!modes || modes.includes(e.mode ?? manifest.defaultMode)) &&
        (only.includes(e.id) || only.includes(e.story))
      ) {
        entries.push(e);
        selected.add(e.id);
      }
  }
  if (!entries.length)
    die(`no entries selected (${reg.skipped.map((x) => `${x.name}: ${x.why}`).join('; ')})`);
}

// --- the render environment, and --strict-env ---------------------------------------------------
const envCfg = envConfig(P.config);
const pool = browserPool(P);
const engineVersion = (rust(['--version']).out.match(/(\d+\.\d+\.\d+\S*)/) ?? [])[1] ?? null;
const current = entries.length
  ? await pool.envs(
      entries.map((e) => e.browser ?? 'chromium'),
      { fontProbe: envCfg.fontProbe, pxsig: PXSIG_VERSION, engine: engineVersion }
    )
  : {};
const strictEnv =
  !flags.update && (flags['strict-env'] === true || envCfg.strict || strictFromEnv());
// The env gate under warn: the run renders anyway and reports what --strict-env would have refused.
let envRefused = null;
if (strictEnv) {
  const bad = strictEnvCheck(
    entries,
    (e) => resolve(P.workspaceRoot, e.sig),
    current,
    envCfg.ignore
  );
  if (bad.count && enf?.gates.env === 'warn') {
    envRefused = bad;
    console.log(
      `[check] env (warn mode): ${bad.count} baselines were approved in a different environment (${bad.fields.join(', ')}); --strict-env would have refused this run. Rendering anyway.`
    );
  } else if (bad.count) {
    await pool.close();
    die(
      `setup error: ${bad.count} baselines were approved in a different environment (${bad.fields.join(', ')}). Nothing was rendered. Render where the baselines were made (the pinned container), or re-take them there with \`pxsig check --full --update --kind environment\`; without --strict-env this is a warning (pxsig doctor).`
    );
  }
}

// --- 2. render ---------------------------------------------------------------------------
const renderOpts = { ...manifest, concurrency, project: P, a11y: !flags['no-a11y'] };
const {
  results,
  wallMs,
  reloads = 0,
} = entries.length
  ? await renderStories(pool, entries, pngDir, renderOpts)
  : { results: [], wallMs: 0 };
const renderErrors = results.filter((r) => r.error).length;
console.log(
  `[check] rendered ${results.length} entries in ${(wallMs / 1000).toFixed(1)} s on ${concurrency} pages · ${reloads} page loads${renderErrors ? ` · ${renderErrors} errors` : ''}`
);
// Sentinel: renders that hit Storybook's error page. Most of the run → a setup problem, not results.
const sbErrors = results.filter((r) => r.error?.startsWith(STORYBOOK_ERROR));
if (storybookBroken(sbErrors.length, results.length)) {
  await pool.close();
  die(
    `setup error: ${sbErrors.length} of ${results.length} renders hit Storybook's error page (${sbErrors[0].error.slice(STORYBOOK_ERROR.length).trim()}). Nothing was recorded.`
  );
}
const render = new Map(results.map((r) => [r.id, r]));
const onlyFile = join(reports, '.selected.json');
writeFileSync(onlyFile, JSON.stringify([...selected]));
// Crop renders to their content (Rust, in place, parallel): the grid lands on the component.
const trimArgs = manifest.trim
  ? ['--pad', String(manifest.trim.pad ?? 16), '--tolerance', String(manifest.trim.tolerance ?? 8)]
  : null;
const trimDir = (dir, ids) => {
  if (!trimArgs || !ids.length) return null;
  writeFileSync(onlyFile, JSON.stringify(ids));
  const r = JSON.parse(rust(['trim', dir, '--only', `@${onlyFile}`, '--json', ...trimArgs]).out);
  writeFileSync(onlyFile, JSON.stringify([...selected]));
  return r;
};
const trimmed = trimDir(
  pngDir,
  results.filter((r) => r.png).map((r) => r.id)
);
if (trimmed)
  console.log(
    `[check] trimmed ${trimmed.trimmed}/${trimmed.files} renders to content · ${Math.round((trimmed.pixelsAfter / trimmed.pixelsBefore) * 100)}% of pixels kept · ${trimmed.elapsedMs.toFixed(0)} ms (Rust)`
  );

// --- --update: write baselines instead of checking ------------------------------------------
if (flags.update) {
  const ok = results.filter((r) => r.png).map((r) => r.id);
  // Writing baselines unseen is the riskiest thing pxsig does: a person at a terminal only, a typed
  // phrase, and every old baseline snapshotted + logged (lib/approvals.mjs) so `approve undo` works.
  // For reviewed changes prefer `cli.mjs approve plan` / `apply`, which also checks colour vs shape.
  const phrase = `UPDATE ${ok.length} BASELINES`;
  if (
    (await ask(
      `--update replaces ${ok.length} baselines with renders nobody reviewed. Type "${phrase}" to continue: `
    )) !== phrase
  ) {
    await pool.close();
    die('not confirmed: nothing was written', 1);
  }
  fence();
  const batch = newBatch('check-update');
  const before = new Map(
    ok.map((id) => [
      id,
      snapshot(
        P,
        entries.find((e) => e.id === id),
        batch
      ).before,
    ])
  );
  writeFileSync(onlyFile, JSON.stringify(ok));
  // Each baseline keeps the environment of its own render (its browser's), never of anything else.
  const envFile = join(reports, '.env-plan.json');
  writeFileSync(
    envFile,
    JSON.stringify({
      envs: byId(current),
      byId: Object.fromEntries(
        entries
          .filter((e) => ok.includes(e.id))
          .map((e) => [e.id, current[e.browser ?? 'chromium']?.id])
          .filter(([, v]) => v)
      ),
    })
  );
  const b = rust([
    'baseline',
    '--manifest',
    runPath,
    '--png-dir',
    pngDir,
    '--root',
    P.workspaceRoot,
    '--only',
    `@${onlyFile}`,
    '--env',
    `@${envFile}`,
    '--json',
  ]);
  rmSync(envFile, { force: true });
  const res = JSON.parse(b.out);
  for (const id of ok)
    record(
      P,
      entries.find((e) => e.id === id),
      {
        batch,
        via: 'check-update',
        reason: str('reason') ?? 'pxsig check --update',
        kind,
        before: before.get(id),
      }
    );
  if (kind !== 'environment') {
    const a11yBase = existsSync(a11yBaselinePath)
      ? JSON.parse(readFileSync(a11yBaselinePath, 'utf8'))
      : {};
    for (const r of results)
      if (r.a11y?.violations) a11yBase[r.id] = r.a11y.violations.map((v) => v.id).sort();
    writeJson(a11yBaselinePath, a11yBase, { pretty: true });
  }
  await pool.close();
  console.log(
    `[check] baselines: ${res.summary.stories - res.summary.failed} written in ${res.summary.elapsedMs.toFixed(0)} ms (Rust) · ${res.summary.failed} failed · render errors ${renderErrors}`
  );
  for (const e of res.errors) console.error(`  ${e}`);
  process.exit(res.summary.failed || renderErrors ? 2 : 0);
}

// --- 3. check (Rust) ------------------------------------------------------------------------
const checkArgs = (dir, out, extra = []) => [
  'check',
  '--manifest',
  runPath,
  '--png-dir',
  dir,
  '--root',
  P.workspaceRoot,
  '--out-dir',
  out,
  '--only',
  `@${onlyFile}`,
  '--json',
  ...extra,
];
// Warn mode chosen in config: the history line records the gates and whether the run would fail.
const enfFile = join(reports, '.enforcement.json');
const historyEnf = [];
if (enf?.configured.length) {
  const base = existsSync(a11yBaselinePath)
    ? JSON.parse(readFileSync(a11yBaselinePath, 'utf8'))
    : {};
  const a11yNew = results.filter((r) =>
    r.a11y?.violations?.some((v) => !(base[r.id] ?? []).includes(v.id))
  ).length;
  writeFileSync(enfFile, JSON.stringify({ gates: enf.gates, a11yNew }));
  historyEnf.push('--enforcement', `@${enfFile}`);
}
let rc = entries.length
  ? rust(
      checkArgs(pngDir, diffDir, [
        '--cache',
        join(P.store.cache, 'check'),
        '--history',
        join(reports, 'history.ndjson'),
        ...historyEnf,
      ])
    )
  : { out: '{"summary":{"elapsedMs":0},"results":[]}', ms: 0 };
rmSync(enfFile, { force: true });
const rustRes = JSON.parse(rc.out);
const rows = new Map(rustRes.results.map((r) => [r.id, r]));
console.log(
  `[check] Rust check: ${rustRes.results.length} entries, ${rustRes.summary.failed ?? 0} failed, ${rustRes.summary.cached ?? 0} cached · ${rustRes.summary.elapsedMs.toFixed(0)} ms engine (${rc.ms.toFixed(0)} ms process)`
);
for (const g of rustRes.summary.identicalRenders ?? [])
  console.error(
    `[check] ${g.count} failing entries rendered the same image (${g.ids.slice(0, 3).join(', ')}…): the environment, not a design change. Marked as errors; nothing to approve.`
  );

// --- 4. retry failures: a pass on a fresh render is flaky, not a regression -------------------
let retryMs = 0;
for (let attempt = 1; attempt <= retries; attempt++) {
  const failing = [...rows.values()]
    .filter((r) => r.pass !== true && !r.flaky && render.get(r.id)?.png)
    .map((r) => r.id);
  if (!failing.length) break;
  const t = performance.now();
  const dir = join(P.store.retry, String(attempt));
  rmSync(dir, { recursive: true, force: true });
  const again = await renderStories(
    pool,
    entries.filter((e) => failing.includes(e.id)),
    dir,
    { ...renderOpts, a11y: false }
  );
  trimDir(
    dir,
    again.results.filter((r) => r.png).map((r) => r.id)
  );
  writeFileSync(onlyFile, JSON.stringify(failing));
  const res = JSON.parse(rust(checkArgs(dir, join(P.store.diffs, 'retry')), {}).out);
  for (const r of res.results)
    if (r.pass === true) {
      const row = rows.get(r.id);
      row.flaky = true;
      row.retry = { attempt, metrics: r.metrics };
    }
  retryMs += performance.now() - t;
  console.log(
    `[check] retry ${attempt}: ${failing.length} re-rendered · ${res.results.filter((r) => r.pass).length} passed (flaky)`
  );
}
await pool.close();
writeFileSync(onlyFile, JSON.stringify([...selected]));

// --- 5. a11y: new violations against the a11y baseline ------------------------------------------
const a11yBase = existsSync(a11yBaselinePath)
  ? JSON.parse(readFileSync(a11yBaselinePath, 'utf8'))
  : null;

// --- 6. report -------------------------------------------------------------------------------------------
const previous = existsSync(join(reports, `${outName}.json`))
  ? JSON.parse(readFileSync(join(reports, `${outName}.json`), 'utf8'))
  : null;
const prevRows = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
// Every environment a row names (this run's, its baselines', carried rows'), by id.
const envs = { ...(previous?.envs ?? {}), ...(rustRes.baselineEnvs ?? {}), ...byId(current) };
const out = manifest.stories
  .filter((e) => (modes ? modes.includes(e.mode ?? manifest.defaultMode) : true))
  .map((e) => {
    if (!selected.has(e.id)) {
      const p = prevRows.get(e.id);
      // Left out because the import graph says no edit since the ref can change it (--since / --changed).
      const unaffected =
        affectedIds != null &&
        !affectedIds.has(e.id) &&
        (!only || only.includes(e.id) || only.includes(e.story));
      // Carry the whole previous row (verdict time included) so its age stays visible.
      if (p)
        return {
          ...p,
          skipped: true,
          inherited: true,
          ...(unaffected ? { unaffected: true } : {}),
        };
      // No previous row: an unaffected entry with a baseline is `skipped-unaffected` (ok, unverified);
      // anything else is `inherited: false`, which the integrity ledger reports as never-checked.
      if (unaffected && existsSync(resolve(P.workspaceRoot, e.sig)))
        return {
          id: e.id,
          story: e.story,
          mode: e.mode,
          state: e.state,
          skipped: true,
          pass: true,
          metrics: null,
          inherited: false,
          unaffected: true,
          note: 'skipped-unaffected',
        };
      return {
        id: e.id,
        story: e.story,
        mode: e.mode,
        state: e.state,
        skipped: true,
        pass: true,
        metrics: null,
        inherited: false,
      };
    }
    return annotateRow(buildRow(e, rows.get(e.id), render.get(e.id), a11yBase, manifest, null), {
      current,
      envs,
      ignore: envCfg.ignore,
    });
  });
const checked = out.filter((r) => !r.skipped);
// The approval log lines this range added (decision 80): `--since` only, where a merge base is known.
const approvalsInRange = (() => {
  if (!affected?.mergeBase) return null;
  const a = appendedSince(P, affected.mergeBase);
  if (a.rewritten) return { rewritten: true };
  const c = changedByRoute(a.lines);
  return c.total ? c : null;
})();
const summary = summarize(out, {
  concurrency,
  renderWallMs: wallMs,
  pageLoads: reloads,
  rustEngineMs: rustRes.summary.elapsedMs,
  rustProcessMs: rc.ms,
  retryMs,
  affected: affected
    ? `${affected.ids.length} affected of ${manifest.stories.length} (${affected.reason})`
    : null,
  // When baselines changed in the range: how each was approved, and any assistant marker (decision 80).
  ...(approvalsInRange ? { approvals: approvalsInRange } : {}),
  // Only when the fail-safe fired: summary.md names the first path and its class (decision 6.1g).
  ...(affected?.failSafe?.length
    ? {
        selectAll: {
          entries: affected.ids.length,
          path: affected.failSafe[0].path,
          class: affected.failSafe[0].class,
          why: affected.failSafe[0].why,
          more: affected.failSafe.length - 1,
        },
      }
    : {}),
  ...envSummary(out, envs),
  totalMs: performance.now() - t0,
});
const now = new Date().toISOString();
// When every entry was last checked together (integrity's "last full check"); a partial run keeps the last one.
const fullCheckAt =
  checked.length === out.length ? now : (previous?.fullCheckAt ?? previous?.generatedAt ?? null);
const usedEnvs = new Set(out.flatMap((r) => [r.env, r.baselineEnv]).filter(Boolean));
// Warn mode: what each gate would fail on, and the exit this run takes.
const found = checkFindings(out);
if (envRefused)
  found.push({
    gate: 'env',
    exit: 2,
    count: envRefused.count,
    what: 'baselines from a different environment (--strict-env)',
  });
const gated = outcome(enf, found);
const enforcement = reportBlock(enf, gated);
const report = {
  generatedAt: now,
  fullCheckAt,
  project: P.name,
  suite,
  manifest: {
    grid: manifest.grid,
    gate: manifest.gate,
    modes: manifest.modes,
    defaultMode: manifest.defaultMode,
  },
  summary,
  affected,
  envs: Object.fromEntries(Object.entries(envs).filter(([id]) => usedEnvs.has(id))),
  ...(enforcement ? { enforcement, git: { head: gitHead() } } : {}),
  rows: out,
};
fence();
writeJson(join(reports, `${outName}.json`), report);
// Review decisions belong to the run they were made on: a new run starts clean.
if (outName === 'check')
  for (const f of ['review.json', 'a11y-review.json']) rmSync(join(reports, f), { force: true });
const link = str('link-base');
const sfx = outName === 'check' ? '' : `-${outName.replace(/^check-/, '')}`;
rust(
  [
    'report',
    '--input',
    join(reports, `${outName}.json`),
    '--format',
    'markdown',
    '--out',
    join(reports, `summary${sfx}.md`),
    ...(link ? ['--link-base', link] : []),
  ],
  { allowFail: false }
);
rust(
  [
    'report',
    '--input',
    join(reports, `${outName}.json`),
    '--format',
    'junit',
    '--out',
    join(reports, `junit${sfx}.xml`),
  ],
  { allowFail: false }
);

const envMsg = envLine(summary, summary.checked);
if (envMsg) console.log(`[check] ${envMsg}`);
console.log(
  `[check] ${summary.checked} checked · ${summary.passed} pass · ${summary.failed} changed · ${summary.flaky} flaky · ${summary.skipped} skipped · ` +
    `a11y ${summary.a11yViolations} violations (${summary.a11yNew} new) · ${(summary.totalMs / 1000).toFixed(1)} s total`
);
for (const r of checked.filter((x) => !x.pass).slice(0, 20))
  console.log(`  CHANGED ${r.id.padEnd(60)} ${r.error ?? (r.reasons ?? []).join('; ')}`);
const sarif = str('sarif');
if (sarif)
  console.log(
    `[check] wrote ${writeSarif(resolve(sarif), out, { entries: new Map(manifest.stories.map((e) => [e.id, e])), version: PXSIG_VERSION })} new a11y violations to ${sarif} (SARIF)`
  );
console.log(`[check] wrote ${rel(reports)}/${outName}.json, summary${sfx}.md, junit${sfx}.xml`);
// Integrity: what the run did not cover (unregistered stories, missing images, never-checked…).
if (outName === 'check' && !suite) {
  try {
    const ctx = resolveContext(P);
    const ledger = await reconcile(
      ctx,
      sbIndex ? { index: await loadStoryIndex(ctx, { live: sbIndex }) } : {}
    );
    writeLedger(ctx, ledger);
    console.log(
      `[check] ${oneLine(ledger)}${ledger.summary.status === 'attention' ? ` → pxsig doctor --project ${P.name}` : ''}`
    );
  } catch (e) {
    console.error(`[check] integrity: not computed (${e.message})`);
  }
}
lock.release();
appendReadiness(P, enf, gated, { source: 'check', suite, counts: checkCounts(out) });
const last = lastLine(enf, gated, enf.configured.length ? readinessTally(P) : null);
if (last) console.log(`[pxsig] ${last}`);
process.exit(gated.exit);

/** The commit this run checked (for `ci status --from-report`), or null outside git. */
function gitHead() {
  const r = spawnSync('git', ['-C', P.workspaceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The server holds this store: queue the selection there, wait for its queue to drain, and report
 * the rows it wrote. Exits with the check's code.
 */
async function viaServer(url, ids, stories = []) {
  console.log(
    `[check] the pxsig server at ${url} holds this store: queueing ${ids.length} entries there${stories.length ? ` (and registering ${stories.length} new)` : ''}`
  );
  const post = await fetch(`${url}/__pxsig/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: P.name, ids, stories, via: 'check' }),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!post.ok)
    die(
      `the server holding the store did not take the check (${post.status ?? ''} ${post.statusText ?? ''}); stop it or try again`
    );
  const answer = await post.json().catch(() => ({}));
  for (const x of answer.skipped ?? []) console.log(`[check] not checked: ${x.name}: ${x.why}`);
  if (answer.registered?.length)
    console.log(
      `[check] the server registered ${answer.registered.length} NEW entries (no signature: a person approves their first render)`
    );
  if (Array.isArray(answer.queued)) ids = answer.queued;
  if (!ids.length) die('no entries selected');
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await fetch(`${url}/__pxsig/status`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .catch(() => null);
    if (!s) die('the server went away during the check');
    if (!s.running && !s.queued) break;
    if (Date.now() - t0 > (Number(flags['timeout-s']) || 1800) * 1000)
      die('timed out waiting for the server queue');
  }
  const report = JSON.parse(readFileSync(join(reports, 'check.json'), 'utf8'));
  const want = new Set(ids);
  const rows = report.rows.filter((r) => want.has(r.id));
  const failed = rows.filter((r) => !r.pass);
  console.log(
    `[check] ${rows.length} checked via the server · ${rows.length - failed.length} pass · ${failed.length} changed · ${((Date.now() - t0) / 1000).toFixed(1)} s`
  );
  for (const r of failed.slice(0, 20))
    console.log(`  CHANGED ${r.id.padEnd(60)} ${r.error ?? (r.reasons ?? []).join('; ')}`);
  const gated = outcome(enf, checkFindings(rows));
  appendReadiness(P, enf, gated, { source: 'check', counts: checkCounts(rows) });
  const last = lastLine(enf, gated, enf.configured.length ? readinessTally(P) : null);
  if (last) console.log(`[pxsig] ${last}`);
  process.exit(gated.exit);
}
