/**
 * integrity.mjs — the coverage / integrity reconciler.
 *
 * Joins every source of truth pxsig has, per entry and per component, and says what is wrong
 * without anyone opening an entry to find out:
 *
 *   story index      Storybook's `<baseUrl>/index.json` when it is reachable and healthy, else a
 *                    static scan of the CSF files under `srcRoot` (Storybook's own id rules)
 *   manifest         <store>/manifest.json (entries = story × mode × interaction state)
 *   config           the project's pxsig.config.json (nonVisual, modes, `integrity` options)
 *   baselines        each entry's `.psig` (signature + baseline image; never written here)
 *   renders          <store>/renders/latest/<id>.png
 *   diffs            <store>/diffs/latest/<id>.diff.png and the signature reconstruction
 *                    `<id>.baseline.png` the Rust check writes for failures
 *   report           <store>/reports/check.json rows (pass, error, flaky, checkedAt)
 *   review/approvals <store>/reports/review.json, <store>/approvals.ndjson
 *   a11y baseline    <store>/a11y.json
 *   source freshness file mtimes under the source roots vs each verdict, traced through the
 *                    Rust import graph (`pxsig affected`) when available, else per story folder
 *
 * Output: a versioned ledger (`<store>/reports/integrity.json`, schema in docs/integrity.md) with one
 * status per entry and per component. Reading is side-effect free; `writeLedger` is the only
 * write. Nothing here renders, checks, approves or touches a signature.
 */
import { spawn } from './spawn.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { hasImage } from './psig.mjs';
import { workspaceProblems } from './workspace.mjs';
import { toPosix } from './paths.mjs';
import { portabilityProblems } from './portability.mjs';
import { readLines, writeJson } from './files.mjs';
/** @import { ApprovalLine, Project, StoryIndex, TornLine } from '../types.js' */
import { conflictedStoreFiles } from './approvals.mjs';
import { enforcementProblems, readinessTally, resolveEnforcement } from './enforcement.mjs';

export const SCHEMA_VERSION = 1;

/**
 * Status codes. Stable and machine-readable: never renamed, only added to.
 * `rank` orders codes within a severity when picking an entry's primary status.
 */
export const CODES = {
  unregistered: {
    severity: 'error',
    rank: 1,
    title: 'Story has no coverage',
    help: 'The story is in the story index but not in the manifest: nothing renders or checks it.',
  },
  'render-error': {
    severity: 'error',
    rank: 2,
    title: 'Render failed',
    help: 'The last render of this entry failed (timeout, missing selector, Storybook error page).',
  },
  'never-checked': {
    severity: 'error',
    rank: 3,
    title: 'Never checked',
    help: 'In the manifest, with a signature, but absent from the last report.',
  },
  'missing-baseline-image': {
    severity: 'error',
    rank: 4,
    title: 'Baseline image missing',
    help: 'The signature exists but the baseline display PNG does not: the dashboard and the approval list cannot show the baseline.',
  },
  'legacy-format': {
    severity: 'warn',
    rank: 4.5,
    title: 'Legacy baseline format',
    help: 'A pre-0.2 `.pxsig.json` baseline: it holds the signature but cannot hold the baseline image. `pxsig doctor --repair` converts it to `.psig` when its latest render passes the gate; `pxsig migrate` moves a whole legacy store.',
  },
  unbaselined: {
    severity: 'warn',
    rank: 5,
    title: 'New: no baseline yet',
    help: 'In the manifest without a signature. A person must review and approve its first render.',
  },
  'missing-render': {
    severity: 'warn',
    rank: 6,
    title: 'No latest render',
    help: 'There is no latest render on disk to compare or review.',
  },
  orphaned: {
    severity: 'warn',
    rank: 7,
    title: 'Orphaned',
    help: 'A signature or baseline image whose story no longer exists (renamed or deleted).',
  },
  changed: {
    severity: 'warn',
    rank: 8,
    title: 'Changed',
    help: 'The gate failed: the render differs from the baseline. Needs review.',
  },
  flaky: {
    severity: 'warn',
    rank: 9,
    title: 'Flaky',
    help: 'Failed, then passed on a fresh render.',
  },
  stale: {
    severity: 'warn',
    rank: 10,
    title: 'Stale verdict',
    help: 'A source the entry depends on changed after its verdict (or its render was rewritten after it).',
  },
  'a11y-new': {
    severity: 'warn',
    rank: 11,
    title: 'New a11y violations',
    help: 'axe reports violations not in the a11y baseline.',
  },
  'skipped-unaffected': {
    severity: 'info',
    rank: 11.5,
    title: 'Skipped: unaffected',
    help: 'A partial run (--since / --changed) left it out because no edit can change it (import graph). It has a baseline but no verdict of its own yet: ok, unverified.',
  },
  drift: { severity: 'info', rank: 12, title: 'Drift', help: 'Passes the gate, but SSIM < 1.' },
  excluded: {
    severity: 'info',
    rank: 13,
    title: 'Excluded',
    help: 'Excluded by configuration (nonVisual folder, parameters.pxsig.disable or the no-pxsig tag).',
  },
  ok: {
    severity: 'info',
    rank: 14,
    title: 'OK',
    help: 'Covered, rendered, checked, fresh and passing.',
  },
};
export const SEVERITIES = ['error', 'warn', 'info'];
const sevRank = (s) => SEVERITIES.indexOf(s);

export const DEFAULT_INTEGRITY = {
  requireBaselineImages: true,
  staleAfterSourceChange: true,
  /** Roots whose edits can make a verdict stale (default: srcRoot + affectsAll directories). */
  sourceRoots: null,
  /** Above this many edited files, staleness falls back to the per-folder rule. */
  maxTracedFiles: 400,
  /** Per-code severity overrides, e.g. { "unbaselined": "error" }. */
  severity: {},
  /** Storybook index fetch timeout. */
  indexTimeoutMs: 4000,
  /** A render written this long after its verdict makes the verdict stale. */
  renderSkewMs: 5000,
};

// --- small utilities ------------------------------------------------------------------------------

export const readJson = (p, fallback = null) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
export const sha256File = (p) =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
const isPsig = (p) => p.endsWith('.psig');

/**
 * Atomic JSON write (tmp + rename): a reader never sees half a file.
 * @param {string} path
 * @param {unknown} value
 * @param {{ pretty?: boolean }} [opts]
 */
export const writeJsonAtomic = (path, value, opts) => writeJson(path, value, opts);

// --- context: every path comes from config, nothing hard-coded --------------------------------------

/** What `resolveContext` returns: the paths and settings every integrity step reads. */
/** @typedef {ReturnType<typeof resolveContext>} IntegrityContext */

/**
 * The integrity context for a resolved project (lib/workspace.mjs `loadProject`). Every path
 * comes from the project and its store; nothing is assumed about where pxsig is installed.
 * @param {Project} P
 * @param {{ manifestPath?: string }} [opts]
 */
export function resolveContext(P, { manifestPath } = {}) {
  if (!P?.store) throw new Error('resolveContext: a resolved project is required');
  const ws = (abs) => toPosix(relative(P.workspaceRoot, abs));
  const integrity = {
    ...DEFAULT_INTEGRITY,
    ...(P.config.integrity ?? {}),
    severity: { ...(P.config.integrity?.severity ?? {}) },
  };
  return {
    project: P,
    pxsigDir: P.store.root,
    repoRoot: P.workspaceRoot,
    config: {
      ...P.config,
      baseUrl: P.storybook.url,
      // index.json importPaths are relative to the folder Storybook runs in (its config dir's parent).
      storybookDir: P.storybook.configDir ? ws(dirname(P.storybook.configDir)) : null,
      affectsAll: P.affects,
    },
    configPath: P.configPath,
    integrity,
    manifestPath: manifestPath ?? P.manifestPath(),
    srcRoot: ws(P.srcRoot),
    pixelsRoot: P.store.layout === 'package' ? ws(P.store.baselines) : null,
    pixelsDir: '__pxsig__',
    dirs: {
      latest: P.store.latest,
      diff: P.store.diffLatest,
      reports: P.store.reports,
      baselines: P.store.baselines,
      trash: P.store.trash,
    },
    files: { a11y: P.store.a11y, approvals: P.store.approvals },
    rustBin: P.rustBin,
  };
}

export const ledgerPath = (ctx) => join(ctx.dirs.reports, 'integrity.json');
export const repairLogPath = (ctx) => join(ctx.dirs.reports, 'repairs.ndjson');

// --- Storybook ids (the rules of @storybook/csf) -----------------------------------------------------

/** Storybook's `sanitize`: lower-case, punctuation and spaces → '-', runs collapsed, ends trimmed. */
export const sanitize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

/** lodash `startCase`, as Storybook's `storyNameFromExport` uses it: `Virtualised100K` → `Virtualised 100 K`. */
export const storyNameFromExport = (key) =>
  String(key)
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** Storybook's `toId(kind, name)`. */
export const toId = (title, name) => `${sanitize(title)}--${sanitize(name)}`;

// --- the story index ------------------------------------------------------------------------------

/** Normalise an index.json importPath (relative to the Storybook config dir) to repo-relative. */
export function normaliseImportPath(ctx, p) {
  if (!p) return p;
  if (ctx.config.storybookDir)
    return toPosix(relative(ctx.repoRoot, resolve(ctx.repoRoot, ctx.config.storybookDir, p)));
  const stripped = p.replace(/^(\.\.?\/)+/, '');
  return existsSync(resolve(ctx.repoRoot, stripped))
    ? stripped
    : toPosix(relative(ctx.repoRoot, resolve(ctx.repoRoot, p)));
}

const scopeRe = (ctx) =>
  new RegExp(
    ctx.config.importPathPattern ??
      `${ctx.srcRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)/[^/]+\\.stories\\.[jt]sx?$`
  );

/**
 * The storied folder (component) an importPath belongs to, or null when outside scope.
 * @returns {string | null}
 */
export function componentOf(ctx, importPath) {
  if (!importPath) return null;
  const m = importPath.match(scopeRe(ctx));
  if (!m) return null;
  return m[1] ?? toPosix(dirname(relative(ctx.srcRoot, importPath)));
}

/**
 * Fetch `<baseUrl>/index.json`. `reachable` = something answered; `healthy` = it is a v4/v5
 * index with entries. Storybook answers a broken build (e.g. "Unable to index files") with an
 * error, which is not an index: callers must not render against it.
 */
export async function fetchStoryIndex(
  baseUrl,
  { timeoutMs = 4000, fetchImpl = globalThis.fetch } = {}
) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/index.json`;
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return {
      url,
      reachable: false,
      healthy: false,
      error: `unreachable: ${e.cause?.code ?? e.message}`,
    };
  }
  const body = await res.text().catch(() => '');
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* not JSON: an error page */
  }
  if (!res.ok || !json || typeof json.entries !== 'object') {
    const msg = body
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    return {
      url,
      reachable: true,
      healthy: false,
      status: res.status,
      error: `broken index (HTTP ${res.status}): ${msg || 'not a story index'}`,
    };
  }
  const stories = Object.values(json.entries)
    .filter((e) => e.type === 'story')
    .map((e) => ({
      id: e.id,
      title: e.title,
      name: e.name,
      importPath: e.importPath,
      tags: e.tags ?? [],
    }));
  return { url, reachable: true, healthy: true, version: json.v ?? null, stories };
}

/** Strip comments so a commented-out `export const` is not a story. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/**
 * Static fallback: scan `*.stories.{tsx,ts,jsx,js}` under srcRoot. Title from the default export's
 * meta (`title: '…'`), else inferred from the path; story ids by Storybook's rules
 * (`toId(title, storyNameFromExport(exportName))`).
 */
export function scanStories(ctx) {
  const root = resolve(ctx.repoRoot, ctx.srcRoot);
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (
        d.name.startsWith('.') ||
        ['node_modules', 'dist', 'build', ctx.pixelsDir].includes(d.name)
      )
        continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.stories\.[jt]sx?$/.test(d.name)) {
        const src = stripComments(readFileSync(p, 'utf8'));
        const importPath = toPosix(relative(ctx.repoRoot, p));
        const metaAt = Math.max(0, src.search(/export\s+default\b|const\s+meta\b/));
        const t = src.slice(metaAt).match(/\btitle\s*:\s*(['"`])((?:(?!\1).)+)\1/);
        const title = t
          ? t[2]
          : toPosix(relative(root, p))
              .replace(/\.stories\.[jt]sx?$/, '')
              .replace(/\/index$/, '');
        for (const m of src.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/gm)) {
          if (m[1] === '__namedExportsOrder') continue;
          const name = storyNameFromExport(m[1]);
          out.push({
            id: toId(title, name),
            title,
            name,
            exportName: m[1],
            importPath,
            titleSource: t ? 'meta' : 'inferred',
          });
        }
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The story index to reconcile against: live when healthy, else the static scan.
 * @returns {Promise<StoryIndex>}
 */
export async function loadStoryIndex(ctx, { fetchImpl, offline = false, live } = {}) {
  const baseUrl = ctx.config.baseUrl ?? 'http://localhost:6006';
  const res =
    live ??
    (offline
      ? {
          url: `${baseUrl}/index.json`,
          reachable: false,
          healthy: false,
          error: 'offline (not fetched)',
        }
      : await fetchStoryIndex(baseUrl, { timeoutMs: ctx.integrity.indexTimeoutMs, fetchImpl }));
  if (res.healthy) {
    const stories = res.stories.map((s) => ({
      ...s,
      importPath: normaliseImportPath(ctx, s.importPath),
    }));
    return {
      source: 'storybook',
      storybook: { url: res.url, reachable: true, healthy: true, version: res.version },
      stories,
    };
  }
  return {
    source: 'static',
    storybook: { url: res.url, reachable: res.reachable, healthy: false, error: res.error },
    stories: scanStories(ctx),
  };
}

// --- staleness: which sources changed after each verdict? -----------------------------------------------

function sourceRoots(ctx) {
  const roots = process.env.PXSIG_SOURCES?.split(',') ??
    ctx.integrity.sourceRoots ?? [
      ctx.srcRoot,
      ...(ctx.config.affectsAll ?? []).filter((p) => !/\.[a-z]+$/i.test(p)),
    ];
  return [...new Set(roots)].map((r) => resolve(ctx.repoRoot, r)).filter((r) => existsSync(r));
}

/** Source files modified after `sinceMs` (tests, build output and dot-folders skipped). */
export function editedFilesSince(ctx, sinceMs) {
  const out = [];
  const walk = (dir) => {
    let list;
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (
        d.name.startsWith('.') ||
        ['node_modules', 'dist', 'build', 'coverage', ctx.pixelsDir].includes(d.name)
      )
        continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (
        /\.(tsx?|jsx?|mjs|cjs|css|json|mdx)$/.test(d.name) &&
        !/\.(test|spec)\.[jt]sx?$/.test(d.name)
      ) {
        const t = mtime(p);
        if (t != null && t > sinceMs)
          out.push({ file: toPosix(relative(ctx.repoRoot, p)), mtime: t });
      }
    }
  };
  for (const r of sourceRoots(ctx)) walk(r);
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The Rust import graph over one long-lived `pxsig serve`: `affected(file)` → entry ids.
 * Returns null when the binary is not built (callers fall back to the folder rule).
 */
export function rustAffected(ctx) {
  if (!existsSync(ctx.rustBin)) return null;
  const proc = spawn(ctx.rustBin, ['serve'], {
    cwd: ctx.repoRoot,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let seq = 0;
  let dead = null;
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (p) msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
  });
  proc.on('error', (e) => (dead = e));
  proc.on('exit', (code) => {
    dead ??= new Error(`pxsig serve exited (${code})`);
    for (const p of pending.values()) p.reject(dead);
    pending.clear();
  });
  return {
    affected: (file) => {
      if (dead) return Promise.reject(dead);
      const id = ++seq;
      return new Promise((ok, fail) => {
        pending.set(id, { resolve: (r) => ok(r.traced ?? r.ids ?? []), reject: fail });
        proc.stdin.write(
          `${JSON.stringify({ id, method: 'affected', params: { manifest: ctx.manifestPath, root: ctx.repoRoot, files: [file] } })}\n`
        );
      });
    },
    close: () => proc.stdin.end(),
  };
}

// --- the reconciler ---------------------------------------------------------------------------------

function listFiles(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => re.test(n));
}

function sigFilesOnDisk(ctx) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'history' || d.name.startsWith('.')) continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.psig') || d.name.endsWith('.pxsig.json')) out.push(p);
    }
  };
  if (ctx.pixelsRoot) walk(resolve(ctx.repoRoot, ctx.pixelsRoot));
  else {
    const src = resolve(ctx.repoRoot, ctx.srcRoot);
    const find = (dir) => {
      if (!existsSync(dir)) return;
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name === 'node_modules' || d.name.startsWith('.')) continue;
        const p = join(dir, d.name);
        if (d.name === ctx.pixelsDir) walk(p);
        else find(p);
      }
    };
    find(src);
  }
  return out;
}

const sigComponent = (ctx, abs) => {
  if (ctx.pixelsRoot) return toPosix(dirname(relative(resolve(ctx.repoRoot, ctx.pixelsRoot), abs)));
  return toPosix(dirname(dirname(relative(resolve(ctx.repoRoot, ctx.srcRoot), abs))));
};

const issue = (ctx, code, reason, extra = {}) => ({
  code,
  severity: ctx.integrity.severity[code] ?? CODES[code].severity,
  reason,
  ...extra,
});

/** Most severe first, then by code rank: the order issues are listed in. */
const byGravity = (a, b) =>
  sevRank(a.severity) - sevRank(b.severity) || CODES[a.code].rank - CODES[b.code].rank;

/** The primary status of a list of issues: the most severe, then the lowest rank. */
export function primaryOf(issues) {
  if (!issues.length) return { code: 'ok', severity: 'info' };
  const top = [...issues].sort(byGravity)[0];
  return { code: top.code, severity: top.severity };
}

/**
 * Reconcile. Options:
 *   index      a loadStoryIndex() result (else fetched / scanned here)
 *   offline    do not fetch the Storybook index (static scan only)
 *   affected   async (file) → ids  (else a short-lived Rust engine, else the folder rule)
 *   now        clock override for tests
 */
export async function reconcile(ctx, opts = {}) {
  const t0 = performance.now();
  const manifest = readJson(ctx.manifestPath, null);
  if (!manifest?.stories)
    throw Object.assign(new Error(`no readable manifest at ${ctx.manifestPath}`), { setup: true });
  const index =
    opts.index ?? (await loadStoryIndex(ctx, { offline: opts.offline, fetchImpl: opts.fetchImpl }));
  const reportPath = join(ctx.dirs.reports, 'check.json');
  const report = readJson(reportPath, null);
  const review = readJson(join(ctx.dirs.reports, 'review.json'), {}) ?? {};
  const a11yBase = readJson(ctx.files.a11y, null);
  // The approval log is pxsig's own (lib/approvals.mjs): every complete line is an ApprovalLine.
  const { lines: approvals, torn } = /** @type {{ lines: ApprovalLine[], torn: TornLine[] }} */ (
    readLines(ctx.files.approvals)
  );
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
  const rel = (p) => toPosix(relative(ctx.repoRoot, p));

  // --- verdict times + staleness --------------------------------------------------------------------
  const verdictAt = (row) => (row?.checkedAt ? Date.parse(row.checkedAt) : reportAt);
  const staleBy = new Map(); // id → { file, mtime }
  let staleness = { method: 'off', filesTraced: 0 };
  if (ctx.integrity.staleAfterSourceChange && rows.size) {
    const oldest = Math.min(...[...rows.values()].map(verdictAt).filter((t) => t != null));
    const edited = Number.isFinite(oldest) ? editedFilesSince(ctx, oldest) : [];
    staleness = { method: 'none-edited', filesTraced: edited.length };
    if (edited.length) {
      let engine = null;
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
              if (!staleBy.has(id) || staleBy.get(id).mtime < edited[i].mtime)
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
              if (!staleBy.has(e.id) || staleBy.get(e.id).mtime < f.mtime) staleBy.set(e.id, f);
        }
      }
    }
  }

  // --- per entry --------------------------------------------------------------------------------------
  const entries = [];
  const sigPaths = new Set();
  // Baselines with no approval log line: `approve verify` fails on them (strict by default, 0.4.0).
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
        const unbaselinedRow = row.new || /^no baseline sig/.test(String(row.error ?? ''));
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
    const issues = [];
    if (isNonVisual(component))
      issues.push(
        issue(ctx, 'excluded', `folder "${component.split('/')[0]}" is listed in config.nonVisual`)
      );
    else if (skippedStories.has(s.id))
      issues.push(issue(ctx, 'excluded', skippedStories.get(s.id)));
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
    for (const e of readJson(p, { stories: [] }).stories ?? []) {
      known.add(e.id);
      if (e.sig) sigPaths.add(resolve(ctx.repoRoot, e.sig));
    }
  const orphans = new Map();
  const addOrphan = (id, component, file) => {
    const o = orphans.get(id) ?? { id, component, files: [] };
    o.files.push(file);
    orphans.set(id, o);
  };
  for (const p of sigFilesOnDisk(ctx))
    if (!sigPaths.has(p))
      addOrphan(
        p
          .split(sep)
          .pop()
          .replace(/\.(psig|pxsig\.json)$/, ''),
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

/** Other manifests whose baselines are not orphans: config.integrity.manifests, else `manifest.<suite>.json` beside the main one. */
export function siblingManifests(ctx) {
  if (Array.isArray(ctx.integrity.manifests))
    return ctx.integrity.manifests
      .map((p) => resolve(ctx.pxsigDir, p))
      .filter((p) => existsSync(p));
  const dir = dirname(ctx.manifestPath);
  const main = ctx.manifestPath.split(sep).pop();
  return listFiles(dir, /^manifest\..+\.json$/)
    .filter((n) => n !== main)
    .sort()
    .map((n) => join(dir, n));
}

function neverCheckedReason({ report, reportAt, manifestMtime, sigAt, latestAt, row }) {
  if (!report) return 'no report yet (reports/check.json is missing): run a full check';
  if (row?.skipped) return 'carried forward by a partial check with no earlier result to carry';
  const parts = [];
  // The signature's write time is the best evidence of when the entry appeared (the manifest's own
  // mtime moves with every later edit).
  const added = sigAt ?? manifestMtime;
  if (reportAt != null && added != null && added > reportAt)
    parts.push(
      `added after the last full check (${iso(reportAt)}): its ${sigAt != null ? 'signature' : 'manifest entry'} dates from ${iso(added)}`
    );
  else
    parts.push(
      `absent from the last full check (${iso(reportAt)}), which ran on a different manifest or a --modes / --manifest subset`
    );
  if (latestAt != null && reportAt != null && latestAt > reportAt)
    parts.push(
      `rendered ${iso(latestAt)} by a partial re-check that did not record it (re-checks only updated rows already in the report)`
    );
  return parts.join('; ');
}

/** Baselines no approval line covers: a warning before strict `approve verify` fails a pull request on them. */
function unloggedProblems(ids, ctx) {
  if (!ids.length) return [];
  return [
    {
      code: 'verify-unlogged',
      severity: 'warn',
      count: ids.length,
      reason: `${ids.length} baselines have no approval log line (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}): \`pxsig approve verify\` fails on them (strict by default since 0.4.0). For baselines from before pxsig kept a log, a person runs \`pxsig approve verify --adopt\` once; \`--no-strict\` only reports them`,
    },
  ];
}

/**
 * Renders made in a different environment than their baseline (lib/env.mjs): one setup-level
 * warning, never a per-entry code, so story cards and `doctor`'s exit stay as they are (decision 1.1).
 * `integrity.severity['env-mismatch']` overrides the severity.
 */
function envProblems(report, ctx) {
  const n = report?.summary?.envMismatch ?? 0;
  if (!n) return [];
  const fields = report.summary.envFields?.length
    ? ` (${report.summary.envFields.join(', ')})`
    : '';
  const severity = ctx.integrity?.severity?.['env-mismatch'] ?? 'warn';
  return [
    {
      code: 'env-mismatch',
      severity,
      count: n,
      reason: `${n} entries were rendered in a different environment than their baseline${fields}: a change there can be the machine, not the code. Render where the baselines were made (the pinned container), or re-take them there (\`pxsig check --full --update --kind environment\`); \`--strict-env\` refuses such a run instead`,
    },
  ];
}

/**
 * Warn mode (lib/enforcement.mjs): `enforcement-warn`, `enforcement-ending`, `enforcement-expired`
 * when the committed config chose warn for a gate. The quiet built-in a11y default adds nothing
 * (decision 88). A config this process cannot resolve (PXSIG_ENFORCEMENT=warn) adds nothing here:
 * the gated commands refuse it themselves.
 */
function warnModeProblems(ctx) {
  if (!ctx.project) return [];
  let enf;
  try {
    enf = resolveEnforcement(ctx.project, { flags: {} });
  } catch {
    return [];
  }
  return enforcementProblems(enf, enf.configured.length ? readinessTally(ctx.project) : null).map(
    (x) => ({ ...x, severity: ctx.integrity?.severity?.[x.code] ?? x.severity })
  );
}

/** Store files a merge or rebase left conflicted (decision 97). */
function conflictProblems(ctx) {
  if (!ctx.project) return [];
  const files = conflictedStoreFiles(ctx.project);
  if (!files.length) return [];
  return [
    {
      code: 'store-conflict',
      severity: 'error',
      count: files.length,
      reason: `${files.length} store files are conflicted (a merge or rebase is not finished): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}. Take main's version of each baseline, keep both sides' lines of a log, then \`pxsig check --since main\` and approve again (docs/ci.md, "Rebasing with baselines")`,
    },
  ];
}

/** A log line a crash cut short: left out of every reading, removed only by a person. */
function tornProblems(file, torn) {
  if (!torn.length) return [];
  return [
    {
      code: 'log-torn',
      severity: 'warn',
      count: torn.length,
      reason: `${torn.length} line(s) of ${file} were cut short by a crash (line ${torn.map((t) => t.line).join(', ')}) and are left out: \`pxsig doctor --repair --only log-torn --apply\` (a person at a terminal) removes them`,
    },
  ];
}

function setupProblems(index) {
  const out = [];
  if (index.storybook?.reachable && !index.storybook.healthy)
    out.push({ code: 'storybook-index-broken', severity: 'error', reason: index.storybook.error });
  else if (!index.storybook?.reachable && index.source === 'static')
    out.push({
      code: 'storybook-unreachable',
      severity: 'info',
      reason: `${index.storybook?.error ?? 'not reachable'}: reconciled against a static scan of the story files`,
    });
  return out;
}

const PLURAL = {
  unregistered: ['unregistered story', 'unregistered stories'],
  'render-error': ['render error', 'render errors'],
  'never-checked': ['never-checked entry', 'never-checked entries'],
  'missing-baseline-image': ['missing baseline image', 'missing baseline images'],
  'legacy-format': ['legacy .pxsig.json baseline', 'legacy .pxsig.json baselines'],
  'skipped-unaffected': [
    'unaffected entry not yet verified',
    'unaffected entries not yet verified',
  ],
  unbaselined: ['new entry without a baseline', 'new entries without a baseline'],
  'missing-render': ['missing render', 'missing renders'],
  orphaned: ['orphan', 'orphans'],
  changed: ['changed entry', 'changed entries'],
  flaky: ['flaky entry', 'flaky entries'],
  stale: ['stale verdict', 'stale verdicts'],
  'a11y-new': ['entry with new a11y violations', 'entries with new a11y violations'],
};
export const phrase = (code, n) => `${n} ${(PLURAL[code] ?? [code, code])[n === 1 ? 0 : 1]}`;

/** Info-severity statuses that are not findings: `doctor --fail-on info` never fails on these. */
export const BENIGN_INFO = new Set(['ok', 'excluded', 'drift']);

export function summarise(entries, components) {
  const byCode = {};
  const byStatus = {};
  const bySeverity = { error: 0, warn: 0, info: 0 };
  for (const x of entries) {
    byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    bySeverity[x.severity]++;
    for (const i of x.issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  }
  const errComps = components.filter((c) => c.severity === 'error');
  const warnComps = components.filter((c) => c.severity === 'warn');
  const errCodes = Object.keys(CODES).filter(
    (c) =>
      byCode[c] && entries.some((x) => x.issues.some((i) => i.code === c && i.severity === 'error'))
  );
  const headline = errComps.length
    ? `${errComps.length} component${errComps.length === 1 ? '' : 's'} with errors: ${errCodes.map((c) => phrase(c, entries.filter((x) => x.issues.some((i) => i.code === c && i.severity === 'error')).length)).join(', ')}`
    : warnComps.length
      ? `No errors; ${warnComps.length} component${warnComps.length === 1 ? '' : 's'} with warnings`
      : 'No issues';
  return {
    status: errComps.length ? 'attention' : warnComps.length ? 'warnings' : 'clean',
    headline,
    entries: entries.length,
    components: components.length,
    componentsBySeverity: {
      error: errComps.length,
      warn: warnComps.length,
      info: components.length - errComps.length - warnComps.length,
    },
    bySeverity,
    /** Info-severity entries whose status is a finding (not ok / excluded / drift). */
    infoFindings: entries.filter((x) => x.severity === 'info' && !BENIGN_INFO.has(x.status)).length,
    byStatus,
    byCode,
  };
}

/** Write the ledger atomically; returns its path. */
export function writeLedger(ctx, ledger) {
  const p = ledgerPath(ctx);
  writeJsonAtomic(p, ledger);
  return p;
}

/** Filter a ledger for a view (doctor --component / --status, the addon, MCP). */
export function filterLedger(ledger, { component, status, severity } = {}) {
  const c = component?.toLowerCase();
  const matchC = (name) => !c || name.toLowerCase().includes(c);
  const codes = status ? new Set(String(status).split(',')) : null;
  const sev = severity ? sevRank(severity) : null;
  const entries = ledger.entries.filter(
    (x) =>
      matchC(x.component) &&
      (!codes || x.issues.some((i) => codes.has(i.code)) || codes.has(x.status)) &&
      (sev == null || sevRank(x.severity) <= sev)
  );
  const names = new Set(entries.map((x) => x.component));
  return { components: ledger.components.filter((x) => names.has(x.component)), entries };
}

/** One line, for check.mjs and the CLI: "integrity: No issues" / "integrity: 3 components with errors: …". */
export const oneLine = (ledger) =>
  `integrity: ${ledger.summary.headline}${ledger.setup.length ? ` · setup: ${ledger.setup.map((s) => s.code).join(', ')}` : ''}`;
