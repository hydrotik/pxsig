/** Where integrity reads and writes (integrity.mjs): settings, paths, files on disk, staleness. */
import { spawn } from '../spawn.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { toPosix } from '../paths.mjs';
import { readJson, writeJson } from '../files.mjs';
import { manifestSource } from '../source.mjs';
/** @import { Project } from '../../types.js' */
/** @import { EditedFile, IntegritySettings, Ledger, RustAffected, ServeAnswer } from '../../types/t3.js' */

/** @type {IntegritySettings} */
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

/** The shared JSON reader (lib/files.mjs), here for integrity's own modules. */
export { readJson };
/** @param {string} p */
export const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
/** @param {number | null | undefined} ms */
export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
/** @param {string} p */
export const sha256File = (p) =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
/** @param {string} p */
export const isPsig = (p) => p.endsWith('.psig');

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
  /** @param {string} abs */
  const ws = (abs) => toPosix(relative(P.workspaceRoot, abs));
  /** @type {IntegritySettings} */
  const integrity = {
    ...DEFAULT_INTEGRITY,
    ...P.config.integrity,
    severity: { ...P.config.integrity?.severity },
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
    /** Where the entries come from (source.mjs): stories, or pxsig's own dashboard screens. */
    source: manifestSource(manifestPath ?? P.manifestPath()),
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

/** @param {IntegrityContext} ctx */
export const ledgerPath = (ctx) => join(ctx.dirs.reports, 'integrity.json');
/** @param {IntegrityContext} ctx */
export const repairLogPath = (ctx) => join(ctx.dirs.reports, 'repairs.ndjson');

// --- staleness: which sources changed after each verdict? -----------------------------------------------

/**
 * The folders whose edits can change a render, resolved against `base`: each existing folder once.
 * `roots` names them; an `affects` list goes through `folders` first, which drops its files.
 * @param {string} base
 * @param {string[]} roots
 */
export function sourceRoots(base, roots) {
  return [...new Set(roots.map((r) => resolve(base, r)))].filter(
    (r) => existsSync(r) && statSync(r).isDirectory()
  );
}

/** The entries of an `affects` list that name a folder (no file extension). @param {string[]} list */
export const folders = (list) => list.filter((p) => !/\.[a-z]+$/i.test(p));

/**
 * Source files modified after `sinceMs` (tests, build output and dot-folders skipped).
 * @param {IntegrityContext} ctx
 * @param {number} sinceMs
 */
export function editedFilesSince(ctx, sinceMs) {
  /** @type {EditedFile[]} */
  const out = [];
  /** @param {string} dir */
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
  const roots = process.env.PXSIG_SOURCES?.split(',') ??
    ctx.integrity.sourceRoots ?? [ctx.srcRoot, ...folders(ctx.config.affectsAll ?? [])];
  for (const r of sourceRoots(ctx.repoRoot, roots)) walk(r);
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The Rust import graph over one long-lived `pxsig serve`: `affected(file)` → entry ids.
 * Returns null when the binary is not built (callers fall back to the folder rule).
 * @param {IntegrityContext} ctx
 * @returns {RustAffected | null}
 */
export function rustAffected(ctx) {
  if (!existsSync(ctx.rustBin)) return null;
  const proc = spawn(ctx.rustBin, ['serve'], {
    cwd: ctx.repoRoot,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  /** @type {Map<number, { resolve: (r: ServeAnswer['result']) => void, reject: (e: Error) => void }>} */
  const pending = new Map();
  let seq = 0;
  /** @type {Error | null} */
  let dead = null;
  // stdio[1] is 'pipe': stdout is a stream.
  createInterface({ input: /** @type {import('node:stream').Readable} */ (proc.stdout) }).on(
    'line',
    (line) => {
      /** @type {ServeAnswer} */
      let msg;
      try {
        // The engine's own answer line (`pxsig serve`, one JSON object per line).
        msg = /** @type {ServeAnswer} */ (JSON.parse(line));
      } catch {
        return;
      }
      // JSON that is not an object (`null`, a number) answers nothing either.
      if (!msg || typeof msg !== 'object') return;
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(msg.error));
      else if (msg.result == null)
        p.reject(new Error('the engine answered with neither a result nor an error'));
      else p.resolve(msg.result);
    }
  );
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
        // stdio[0] is 'pipe': stdin is a stream.
        /** @type {import('node:stream').Writable} */ (proc.stdin).write(
          `${JSON.stringify({ id, method: 'affected', params: { manifest: ctx.manifestPath, root: ctx.repoRoot, files: [file] } })}\n`
        );
      });
    },
    close: () => /** @type {import('node:stream').Writable} */ (proc.stdin).end(),
  };
}

// --- the reconciler ---------------------------------------------------------------------------------

/**
 * @param {string} dir
 * @param {RegExp} re
 */
export function listFiles(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => re.test(n));
}

/** @param {IntegrityContext} ctx */
export function sigFilesOnDisk(ctx) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
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
    /** @param {string} dir */
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

/**
 * @param {IntegrityContext} ctx
 * @param {string} abs
 */
export const sigComponent = (ctx, abs) => {
  if (ctx.pixelsRoot) return toPosix(dirname(relative(resolve(ctx.repoRoot, ctx.pixelsRoot), abs)));
  return toPosix(dirname(dirname(relative(resolve(ctx.repoRoot, ctx.srcRoot), abs))));
};

/**
 * Other manifests whose baselines are not orphans: config.integrity.manifests, else `manifest.<suite>.json` beside the main one.
 * @param {IntegrityContext} ctx
 */
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

/**
 * Write the ledger atomically; returns its path.
 * @param {IntegrityContext} ctx
 * @param {Ledger} ledger
 */
export function writeLedger(ctx, ledger) {
  const p = ledgerPath(ctx);
  writeJsonAtomic(p, ledger);
  return p;
}
