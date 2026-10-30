/** The reconciler (integrity.mjs): every source of truth joined, per entry and component. */
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { hasImage } from '../psig.mjs';
import { workspaceProblems } from '../workspace.mjs';
import { toPosix } from '../paths.mjs';
import { portabilityProblems } from '../portability.mjs';
import { readLines } from '../files.mjs';
import { SCHEMA_VERSION, issue, byGravity, primaryOf, summarise } from './codes.mjs';
import {
  readJson,
  mtime,
  iso,
  isPsig,
  editedFilesSince,
  rustAffected,
  listFiles,
  sigFilesOnDisk,
  sigComponent,
  siblingManifests,
} from './context.mjs';
import { componentOf, loadStoryIndex } from './stories.mjs';
import {
  neverCheckedReason,
  unloggedProblems,
  envProblems,
  warnModeProblems,
  conflictProblems,
  tornProblems,
  setupProblems,
} from './problems.mjs';
/** @import { ApprovalLine, TornLine } from '../../types.js' */
/** @import { EditedFile, IntegrityCode, IntegrityManifest, IntegrityReport, IntegrityRow, Issue, Ledger, LedgerEntry, ReconcileOptions, ReviewFile, RustAffected, Staleness, Tracer } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

/**
 * Reconcile. Options:
 *   index      a loadStoryIndex() result (else fetched / scanned here)
 *   offline    do not fetch the Storybook index (static scan only)
 *   affected   async (file) → ids  (else a short-lived Rust engine, else the folder rule)
 *   now        clock override for tests
 * @param {IntegrityContext} ctx
 * @param {ReconcileOptions} [opts]
 * @returns {Promise<Ledger>}
 */
export async function reconcile(ctx, opts = {}) {
  const t0 = performance.now();
  // The manifest `pxsig manifest` wrote (docs/spec.md section 6); checked on the next line.
  const manifest = /** @type {IntegrityManifest | null} */ (readJson(ctx.manifestPath, null));
  if (!manifest?.stories)
    throw Object.assign(new Error(`no readable manifest at ${ctx.manifestPath}`), { setup: true });
  const index =
    opts.index ?? (await loadStoryIndex(ctx, { offline: opts.offline, fetchImpl: opts.fetchImpl }));
  const reportPath = join(ctx.dirs.reports, 'check.json');
  // pxsig's own records: check.json (lib/rows.mjs), review.json (the server), a11y.json.
  const report = /** @type {IntegrityReport | null} */ (readJson(reportPath, null));
  const review = /** @type {ReviewFile} */ (
    readJson(join(ctx.dirs.reports, 'review.json'), {}) ?? {}
  );
  const a11yBase = /** @type {Record<string, unknown> | null} */ (readJson(ctx.files.a11y, null));
  // The approval log is pxsig's own (lib/approvals.mjs): every complete line is an ApprovalLine.
  const { lines: approvals, torn } = /** @type {{ lines: ApprovalLine[], torn: TornLine[] }} */ (
    readLines(ctx.files.approvals)
  );
  /** @type {Map<string, ApprovalLine>} */
  const lastApproval = new Map();
  for (const a of approvals) lastApproval.set(a.id, a);
  const rows = new Map((report?.rows ?? []).map((r) => [r.id, r]));
  // When every entry was last checked together; a server re-check moves `generatedAt` only.
  const reportAt = report?.fullCheckAt
    ? Date.parse(report.fullCheckAt)
    : report?.generatedAt
      ? Date.parse(report.generatedAt)
      : null;
  const manifestMtime = mtime(ctx.manifestPath);
  const nonVisual = new Set(ctx.config.nonVisual ?? []);
  /** @param {string | null} component */
  const isNonVisual = (component) => component != null && nonVisual.has(component.split('/')[0]);

  const indexIds = new Map(index.stories.map((s) => [s.id, s]));
  const manifestStories = new Set(manifest.stories.map((e) => e.story ?? e.id));
  const skippedStories = new Map((manifest.skipped ?? []).map((s) => [s.id, s.reason]));
  const files = {
    latest: new Set(listFiles(ctx.dirs.latest, /\.png$/).map((n) => n.slice(0, -4))),
    diff: new Set(listFiles(ctx.dirs.diff, /\.diff\.png$/).map((n) => n.slice(0, -9))),
    reconstructed: new Set(
      listFiles(ctx.dirs.diff, /\.baseline\.png$/).map((n) => n.slice(0, -13))
    ),
  };
  /** @param {string} p */
  const rel = (p) => toPosix(relative(ctx.repoRoot, p));

  // --- verdict times + staleness --------------------------------------------------------------------
  /** @param {IntegrityRow | null} row */
  const verdictAt = (row) => (row?.checkedAt ? Date.parse(row.checkedAt) : reportAt);
  /** @type {Map<string, EditedFile>} */
  const staleBy = new Map(); // id → { file, mtime }
  /** @type {Staleness} */
  let staleness = { method: 'off', filesTraced: 0 };
  if (ctx.integrity.staleAfterSourceChange && rows.size) {
    const oldest = Math.min(...[...rows.values()].map(verdictAt).filter((t) => t != null));
    const edited = Number.isFinite(oldest) ? editedFilesSince(ctx, oldest) : [];
    staleness = { method: 'none-edited', filesTraced: edited.length };
    if (edited.length) {
      /** @type {RustAffected | null} */
      let engine = null;
      /** @type {Tracer | null | undefined} */
      const tracer =
        opts.affected ??
        (edited.length <= ctx.integrity.maxTracedFiles
          ? (engine = rustAffected(ctx))?.affected
          : null);
      if (tracer) {
        staleness.method = 'import-graph';
        try {
          const lists = await Promise.all(edited.map((f) => tracer(f.file).catch(() => null)));
          lists.forEach((ids, i) => {
            if (!ids) return;
            for (const id of ids)
              if (
                !staleBy.has(id) ||
                /** @type {EditedFile} */ (staleBy.get(id)).mtime < edited[i].mtime
              )
                staleBy.set(id, edited[i]);
          });
        } finally {
          engine?.close();
        }
      } else {
        staleness.method = 'folder';
        for (const e of manifest.stories) {
          const folder = e.importPath ? dirname(e.importPath) + '/' : null;
          for (const f of edited)
            if (folder && (f.file === e.importPath || f.file.startsWith(folder)))
              if (
                !staleBy.has(e.id) ||
                /** @type {EditedFile} */ (staleBy.get(e.id)).mtime < f.mtime
              )
                staleBy.set(e.id, f);
        }
      }
    }
  }

  // --- per entry --------------------------------------------------------------------------------------
  /** @type {LedgerEntry[]} */
  const entries = [];
  /** @type {Set<string>} */
  const sigPaths = new Set();
  // Baselines with no approval log line: `approve verify` fails on them (strict by default, 0.4.0).
  /** @type {string[]} */
  const unlogged = [];
  for (const e of manifest.stories) {
    const story = e.story ?? e.id;
    const component = componentOf(ctx, e.importPath) ?? '(unscoped)';
    const sigAbs = resolve(ctx.repoRoot, e.sig);
    sigPaths.add(sigAbs);
    if (!lastApproval.has(e.id) && existsSync(sigAbs)) unlogged.push(e.id);
    const has = {
      sig: existsSync(sigAbs),
      base: isPsig(sigAbs) && hasImage(sigAbs),
      latest: files.latest.has(e.id),
      diff: files.diff.has(e.id),
      reconstructed: files.reconstructed.has(e.id),
    };
    const row = rows.get(e.id) ?? null;
    const latestAt = has.latest ? mtime(join(ctx.dirs.latest, `${e.id}.png`)) : null;
    const vAt = row ? verdictAt(row) : null;
    /** @type {Issue[]} */
    const issues = [];
    if (isNonVisual(component))
      issues.push(
        issue(ctx, 'excluded', `folder "${component.split('/')[0]}" is listed in config.nonVisual`)
      );
    else {
      if (index.stories.length && !indexIds.has(story))
        issues.push(
          issue(
            ctx,
            'orphaned',
            `story "${story}" is not in the ${index.source === 'storybook' ? 'Storybook' : 'static'} story index (renamed or deleted?)`
          )
        );
      if (!has.sig)
        issues.push(
          issue(
            ctx,
            'unbaselined',
            `no signature at ${e.sig}: approve its first render to create one`
          )
        );
      else if (!has.base && !isPsig(sigAbs))
        issues.push(
          issue(
            ctx,
            'legacy-format',
            `${e.sig} is a legacy .pxsig.json baseline, which cannot hold its image`,
            {
              hint: has.latest
                ? 'pxsig doctor --repair converts it to .psig if the latest render passes the gate (or pxsig migrate / pxsig pack)'
                : 'render it (pxsig check), then pxsig doctor --repair converts it to .psig; or pxsig migrate / pxsig pack',
            }
          )
        );
      else if (!has.base && ctx.integrity.requireBaselineImages)
        issues.push(
          issue(ctx, 'missing-baseline-image', `${e.sig} has a signature but no baseline image`, {
            recoverable: has.latest
              ? 'if the latest render passes the gate'
              : 'after a fresh render passes the gate',
            fallback: has.reconstructed ? rel(join(ctx.dirs.diff, `${e.id}.baseline.png`)) : null,
          })
        );
      if (!has.latest)
        issues.push(
          issue(ctx, 'missing-render', `no ${rel(join(ctx.dirs.latest, `${e.id}.png`))}`)
        );
      // Left out of a partial run as unaffected, with nothing earlier to carry: ok, but unverified.
      const unverified = has.sig && row?.skipped && !row.inherited && row.unaffected;
      const neverChecked = has.sig && !unverified && (!row || (row.skipped && !row.inherited));
      if (unverified)
        issues.push(
          issue(
            ctx,
            'skipped-unaffected',
            `not affected by the edits a partial check traced (${report?.affected?.reason ?? 'import graph'}); baseline present, no verdict recorded yet`
          )
        );
      if (neverChecked)
        issues.push(
          issue(
            ctx,
            'never-checked',
            neverCheckedReason({
              report,
              reportAt,
              manifestMtime,
              sigAt: mtime(sigAbs),
              latestAt,
              row,
            })
          )
        );
      if (row && !neverChecked && !unverified) {
        const rv = review[e.id]?.state ?? null;
        const unbaselinedRow = row.new || String(row.error ?? '').startsWith('no baseline sig');
        if (row.error && !unbaselinedRow)
          issues.push(issue(ctx, 'render-error', String(row.error).split('\n')[0].slice(0, 300)));
        else if (row.flaky)
          issues.push(
            issue(ctx, 'flaky', `failed, then passed on retry ${row.retry?.attempt ?? ''}`.trim())
          );
        else if (!row.pass && !unbaselinedRow && rv !== 'approved')
          issues.push(
            issue(
              ctx,
              'changed',
              rv === 'rejected' ? 'rejected in review' : ((row.reasons ?? [])[0] ?? 'gate failed')
            )
          );
        else if (row.pass && row.metrics && row.metrics.ssim < 1)
          issues.push(issue(ctx, 'drift', `ssim ${row.metrics.ssim}`));
        if (row.a11y?.new)
          issues.push(
            issue(ctx, 'a11y-new', `${row.a11y.new} violation(s) not in the a11y baseline`)
          );
        const src = staleBy.get(e.id);
        if (src && vAt != null && src.mtime > vAt)
          issues.push(
            issue(
              ctx,
              'stale',
              `${src.file} edited ${iso(src.mtime)}, after the verdict (${iso(vAt)})`,
              { file: src.file }
            )
          );
        else if (
          latestAt != null &&
          vAt != null &&
          latestAt - vAt > ctx.integrity.renderSkewMs &&
          rv !== 'approved'
        )
          issues.push(
            issue(
              ctx,
              'stale',
              `render rewritten ${iso(latestAt)}, after its verdict (${iso(vAt)})`
            )
          );
      }
    }
    issues.sort(byGravity);
    const primary = primaryOf(issues);
    const last = lastApproval.get(e.id);
    entries.push({
      id: e.id,
      story,
      component,
      mode: e.mode ?? manifest.defaultMode ?? null,
      state: e.state ?? null,
      status: primary.code,
      severity: primary.severity,
      issues,
      files: {
        sig: e.sig,
        sigExists: has.sig,
        baseImage: has.base,
        latestRender: has.latest,
        diff: has.diff,
        reconstructedBaseline: has.reconstructed,
      },
      verdict: row
        ? {
            pass: row.pass ?? null,
            flaky: !!row.flaky,
            error: row.error ?? null,
            skipped: !!row.skipped,
            ssim: row.metrics?.ssim ?? null,
            checkedAt: iso(vAt),
          }
        : null,
      renderedAt: iso(latestAt),
      review: review[e.id]?.state ?? null,
      approval: last ? { at: last.at, by: last.by, via: last.via, batch: last.batch } : null,
      a11y: {
        enabled: e.a11y !== false,
        baselined: a11yBase ? Object.hasOwn(a11yBase, e.id) : false,
        new: row?.a11y?.new ?? 0,
      },
    });
  }

  // --- stories in the index without coverage ------------------------------------------------------------
  for (const s of index.stories) {
    const component = componentOf(ctx, s.importPath);
    if (component == null || manifestStories.has(s.id)) continue;
    /** @type {Issue[]} */
    const issues = [];
    if (isNonVisual(component))
      issues.push(
        issue(ctx, 'excluded', `folder "${component.split('/')[0]}" is listed in config.nonVisual`)
      );
    else if (skippedStories.has(s.id))
      // Checked on the line before.
      issues.push(issue(ctx, 'excluded', /** @type {string} */ (skippedStories.get(s.id))));
    else if ((s.tags ?? []).includes('no-pxsig'))
      issues.push(issue(ctx, 'excluded', "tag 'no-pxsig'"));
    else
      issues.push(
        issue(
          ctx,
          'unregistered',
          `in the ${index.source === 'storybook' ? 'Storybook' : 'static'} story index (${s.importPath}) but not in the manifest`
        )
      );
    const primary = primaryOf(issues);
    entries.push({
      id: s.id,
      story: s.id,
      component,
      mode: null,
      state: null,
      status: primary.code,
      severity: primary.severity,
      issues,
      files: null,
      verdict: null,
      renderedAt: null,
      review: null,
      approval: null,
      a11y: null,
      importPath: s.importPath,
      title: s.title,
      name: s.name,
    });
  }

  // --- orphaned files (no entry in any manifest) --------------------------------------------------------
  // Sibling manifests (a suite: manifest.<suite>.json beside the main one) own their signatures too.
  const known = new Set(manifest.stories.map((e) => e.id));
  const siblings = siblingManifests(ctx);
  for (const p of siblings)
    // A suite manifest `pxsig manifest` wrote, like the main one.
    for (const e of /** @type {IntegrityManifest} */ (readJson(p, { stories: [] })).stories ?? []) {
      known.add(e.id);
      if (e.sig) sigPaths.add(resolve(ctx.repoRoot, e.sig));
    }
  /** @type {Map<string, { id: string, component: string, files: string[] }>} */
  const orphans = new Map();
  /**
   * @param {string} id
   * @param {string} component
   * @param {string} file
   */
  const addOrphan = (id, component, file) => {
    const o = orphans.get(id) ?? { id, component, files: [] };
    o.files.push(file);
    orphans.set(id, o);
  };
  for (const p of sigFilesOnDisk(ctx))
    if (!sigPaths.has(p))
      addOrphan(
        // split always returns at least one part.
        /** @type {string} */ (p.split(sep).pop()).replace(/\.(psig|pxsig\.json)$/, ''),
        sigComponent(ctx, p),
        rel(p)
      );
  for (const o of orphans.values()) {
    const issues = [
      issue(
        ctx,
        'orphaned',
        `${o.files.length === 1 ? 'file has' : 'files have'} no manifest entry: ${o.files.join(', ')}`,
        { orphanFiles: o.files }
      ),
    ];
    entries.push({
      id: o.id,
      story: o.id.replace(/(__[^@]+)?(@.+)?$/, ''),
      component: o.component,
      mode: null,
      state: null,
      status: 'orphaned',
      severity: issues[0].severity,
      issues,
      files: null,
      verdict: null,
      renderedAt: null,
      review: null,
      approval: null,
      a11y: null,
      orphanFiles: o.files,
    });
  }

  entries.sort((a, b) =>
    a.component < b.component
      ? -1
      : a.component > b.component
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0
  );

  // --- roll-ups -------------------------------------------------------------------------------------------
  /**
   * @type {Map<string, {
   *   component: string, entries: number, stories: Set<string>,
   *   counts: Partial<Record<IntegrityCode, number>>, issues: Issue[]
   * }>}
   */
  const byComp = new Map();
  for (const x of entries) {
    const c = byComp.get(x.component) ?? {
      component: x.component,
      entries: 0,
      stories: new Set(),
      counts: {},
      issues: [],
    };
    c.entries++;
    c.stories.add(x.story);
    for (const i of x.issues) c.counts[i.code] = (c.counts[i.code] ?? 0) + 1;
    c.issues.push(...x.issues);
    byComp.set(x.component, c);
  }
  const components = [...byComp.values()].map((c) => {
    const p = primaryOf(c.issues.filter((i) => i.severity !== 'info' || i.code !== 'ok'));
    return {
      component: c.component,
      status: p.code,
      severity: p.severity,
      entries: c.entries,
      stories: c.stories.size,
      counts: c.counts,
    };
  });

  const summary = summarise(entries, components);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: iso(opts.now ?? Date.now()),
    tool: { name: 'pxsig', component: 'integrity' },
    sources: {
      storyIndex: {
        source: index.source,
        stories: index.stories.length,
        inScope: index.stories.filter((s) => componentOf(ctx, s.importPath) != null).length,
        ...index.storybook,
      },
      manifest: {
        path: rel(ctx.manifestPath),
        entries: manifest.stories.length,
        skipped: (manifest.skipped ?? []).length,
        updatedAt: iso(manifestMtime),
        siblings: siblings.map(rel),
      },
      config: {
        path: rel(ctx.configPath),
        srcRoot: ctx.srcRoot,
        pixelsRoot: ctx.pixelsRoot,
        nonVisual: [...nonVisual],
        integrity: {
          requireBaselineImages: ctx.integrity.requireBaselineImages,
          staleAfterSourceChange: ctx.integrity.staleAfterSourceChange,
        },
      },
      report: report
        ? { path: rel(reportPath), generatedAt: report.generatedAt, rows: report.rows.length }
        : { path: rel(reportPath), missing: true },
      renders: {
        base: entries.filter((x) => x.files?.baseImage).length,
        latest: files.latest.size,
        diffs: files.diff.size,
        reconstructed: files.reconstructed.size,
      },
      signatures: [...sigPaths].filter((p) => existsSync(p)).length,
      approvals: {
        path: rel(ctx.files.approvals),
        lines: approvals.length,
        entries: lastApproval.size,
      },
      review: { decisions: Object.keys(review).length },
      a11yBaseline: {
        path: rel(ctx.files.a11y),
        entries: a11yBase ? Object.keys(a11yBase).length : null,
      },
      staleness,
    },
    setup: [
      ...setupProblems(index),
      ...(ctx.project ? workspaceProblems(ctx.project) : []),
      ...portabilityProblems({
        repoRoot: ctx.repoRoot,
        sigPaths,
        records: [ctx.manifestPath, ...siblings, ctx.files.approvals, ctx.files.a11y],
      }),
      ...tornProblems(rel(ctx.files.approvals), torn),
      ...unloggedProblems(unlogged, ctx),
      ...conflictProblems(ctx),
      ...envProblems(report, ctx),
      ...warnModeProblems(ctx),
    ],
    summary,
    components,
    entries,
    elapsedMs: Math.round(performance.now() - t0),
  };
}
