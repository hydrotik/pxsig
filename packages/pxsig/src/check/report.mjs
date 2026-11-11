/**
 * check/report.mjs — stages 5 and 6: new a11y violations, one row per entry (checked, or carried
 * from the last report), the summary, check.json, summary.md, junit.xml, SARIF, the integrity line,
 * the readiness log and the exit code. Always exits.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  loadStoryIndex,
  oneLine,
  reconcile,
  resolveContext,
  writeLedger,
} from '../lib/integrity.mjs';
import { appendedSince, changedByRoute } from '../lib/approvals.mjs';
import { reportsIgnored } from '../lib/decisions.mjs';
import { afterCheck } from '../lib/rejections.mjs';
import { engineDiff, refreshPackets } from '../lib/rejections/packet.mjs';
import { buildRow, stampRenders, summarize } from '../lib/rows.mjs';
import { writeJson } from '../lib/files.mjs';
import { annotateRow, byId, envLine, envSummary } from '../lib/env.mjs';
import { PXSIG_VERSION } from '../lib/workspace.mjs';
import {
  appendReadiness,
  checkCounts,
  checkFindings,
  lastLine,
  outcome,
  readinessTally,
  reportBlock,
} from '../lib/enforcement.mjs';
import { writeSarif } from '../lib/sarif.mjs';
import { gitHead } from './via-server.mjs';
import { reactBlock, reactLines, reactSarif } from './react.mjs';
/** @import { CheckSetup } from './setup.mjs' */
/** @import { Selection } from './select.mjs' */
/** @import { Prepared } from './prepare.mjs' */
/** @import { Rendered } from './render.mjs' */
/** @import { Compared } from './compare.mjs' */
/** @import { CheckRow } from '../types.js' */
/** @import { A11yBaseline, CheckReport } from '../types/t4.js' */
/** @import { ReactRun } from '../types/react.js' */

/**
 * @param {CheckSetup} S
 * @param {Selection} sel
 * @param {Prepared} prep
 * @param {Rendered} run
 * @param {Compared} cmp
 * @param {{ t0: number, retryMs: number, react?: ReactRun | null }} times and the compiler analysis
 * @returns {Promise<never>}
 */
export async function report(S, sel, prep, run, cmp, { t0, retryMs, react = null }) {
  const {
    P,
    reports,
    outName,
    a11yBaselinePath,
    manifest,
    concurrency,
    enf,
    suite,
    str,
    rust,
    rel,
  } = S;
  const { modes, selected, affectedIds, only, affected } = sel;
  const { current, envCfg, envRefused, fence, sbIndex, lock } = prep;
  const { render, wallMs, reloads } = run;
  const { rustRes, rows, rc } = cmp;
  // --- 5. a11y: new violations against the a11y baseline ------------------------------------------
  // a11y.json, as pxsig writes it.
  const a11yBase = existsSync(a11yBaselinePath)
    ? /** @type {A11yBaseline} */ (JSON.parse(readFileSync(a11yBaselinePath, 'utf8')))
    : null;

  // --- 6. report -------------------------------------------------------------------------------------------
  // The last check.json this check (or the server) wrote.
  const checkedAt = new Date().toISOString();
  const previous = existsSync(join(reports, `${outName}.json`))
    ? /** @type {CheckReport} */ (
        JSON.parse(readFileSync(join(reports, `${outName}.json`), 'utf8'))
      )
    : null;
  /** @type {Map<string, CheckRow>} */
  const prevRows = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
  // Every environment a row names (this run's, its baselines', carried rows'), by id.
  const envs = { ...previous?.envs, ...rustRes.baselineEnvs, ...byId(current) };
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
      const row = annotateRow(
        buildRow(e, rows.get(e.id), render.get(e.id), a11yBase, manifest, null),
        { current, envs, ignore: envCfg.ignore }
      );
      // Render counts: when, and the counts of the row this one replaces.
      return stampRenders(row, prevRows.get(e.id), checkedAt);
    });
  const checked = out.filter((r) => !r.skipped);
  // The approval log lines this range added (docs/agents.md): `--since` only, where a merge base is known.
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
    // When baselines changed in the range: how each was approved, and any assistant marker.
    ...(approvalsInRange ? { approvals: approvalsInRange } : {}),
    // Only when the fail-safe fired: summary.md names the first path and its class (docs/ci.md).
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
  // `enf` is null only under --update, which exited above.
  const gated = outcome(/** @type {NonNullable<typeof enf>} */ (enf), found);
  const enforcement = reportBlock(/** @type {NonNullable<typeof enf>} */ (enf), gated);
  // Alerts only: nothing reads it back to decide anything.
  const reactJson = reactBlock(react);
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
    ...(reactJson ? { react: reactJson } : {}),
    envs: Object.fromEntries(Object.entries(envs).filter(([id]) => usedEnvs.has(id))),
    ...(enforcement ? { enforcement, git: { head: gitHead(P) } } : {}),
    rows: out,
  };
  fence();
  writeJson(join(reports, `${outName}.json`), report);
  // Review decisions belong to the run they were made on: a new run starts clean.
  // Open rejections outlive them (lib/rejections.mjs): a pass closes one, else it gains the check.
  if (outName === 'check') {
    for (const f of ['review.json', 'a11y-review.json']) rmSync(join(reports, f), { force: true });
    const after = afterCheck(P, out, { known: new Set(manifest.stories.map((e) => e.id)) });
    // The packets of the rejections still open, refreshed with this run's renders (no path logged).
    if (after.checked.length)
      for (const p of await refreshPackets(P, after, {
        diff: engineDiff(P.rustBin),
        ignored: reportsIgnored(P),
        rows: out,
        entries: manifest.stories,
      }))
        if (p.error)
          console.error(`[check] packet of ${p.id}: ${p.record?.packetError ?? 'not written'}`);
  }
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
  for (const l of reactLines(react, checked, P)) console.log(l);
  const sarif = str('sarif');
  if (sarif) {
    const entries = new Map(manifest.stories.map((e) => [e.id, e]));
    const n = writeSarif(resolve(sarif), out, { entries, version: PXSIG_VERSION, masks: true });
    const big = out.reduce((a, r) => a + (r.masksLarge?.length ?? 0), 0);
    console.log(
      `[check] wrote ${n - big} new a11y violations${big ? ` and ${big} large masks` : ''} to ${sarif} (SARIF)`
    );
  }
  const reactSarifFile = str('react-sarif');
  if (reactSarifFile) console.log(reactSarif(reactSarifFile, react, out, manifest.stories));
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
      // reconcile and its reads throw an Error.
      console.error(`[check] integrity: not computed (${/** @type {Error} */ (e).message})`);
    }
  }
  lock.release();
  // `enf` is null only under --update, which exited above.
  appendReadiness(P, /** @type {NonNullable<typeof enf>} */ (enf), gated, {
    source: 'check',
    suite,
    counts: checkCounts(out),
  });
  const last = lastLine(
    /** @type {NonNullable<typeof enf>} */ (enf),
    gated,
    /** @type {NonNullable<typeof enf>} */ (enf).configured.length ? readinessTally(P) : null
  );
  if (last) console.log(`[pxsig] ${last}`);
  process.exit(gated.exit);
}
