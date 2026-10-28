/**
 * research.mjs — what the research tools share: flags, the project, the Rust engine, scratch space.
 *
 * Every signature, comparison and metric comes from the Rust binary (`P.rustBin`): one-shot CLI
 * calls for batch work, and the stdio daemon (`pxsig serve`) for many small requests. Nothing here
 * decodes a PNG or computes a metric in JavaScript.
 *
 * Where the tools write:
 *   <store>/reports/<name>.json        the reports the dashboard reads
 *   <store>/renders/<tag>/<scenario>/  scenario renders (the dashboard's inspector shows them)
 *   <store>/diffs/<tag>/<scenario>/    diff artifacts for those renders
 *   <store>/cache/research/            scratch: baseline images, throwaway signatures, manifests
 * All four are git-ignored by the store's .gitignore. Nothing is written under <store>/baselines
 * or next to a component (`__pxsig__`): `assertScratch` refuses it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
/** @import { ManifestEntry, Project, RunManifest } from '../../packages/pxsig/src/types.js' */
/** @import { CaptureLib, Engine, EngineLine, RustCall, Waiting } from '../types.js' */

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(here, '..', '..', 'packages', 'pxsig', 'src', 'lib');
export const { openProject, writeRunManifest } =
  /** @type {typeof import('../../packages/pxsig/src/lib/workspace.mjs')} */ (
    await import(join(lib, 'workspace.mjs'))
  );
// capture.mjs's own JSDoc does not cover these yet: CaptureLib is what they take and return.
export const { browserPool, renderStories, STORYBOOK_ERROR } = /** @type {CaptureLib} */ (
  await import(join(lib, 'capture.mjs'))
);
const { readImage } = /** @type {typeof import('../../packages/pxsig/src/lib/psig.mjs')} */ (
  await import(join(lib, 'psig.mjs'))
);

/**
 * `--key value` and bare `--flag` → object.
 * @param {string[]} [argv]
 */
export function parseFlags(argv = process.argv.slice(2)) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith('--'))
      flags[argv[i].slice(2)] =
        argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return flags;
}
/** @param {string | boolean | undefined} v */
export const str = (v) => (v && v !== true ? String(v) : null);
/**
 * @param {string | boolean | undefined} v
 * @param {number[]} dflt
 */
export const nums = (v, dflt) => (str(v) ? String(v).split(',').map(Number) : dflt);

/**
 * The project (`--project`, `--workspace`, else the cwd), its run manifest and its scratch root.
 * @param {Record<string, string | true>} flags
 */
export function project(flags) {
  const P = openProject({ project: str(flags.project), workspace: str(flags.workspace) });
  const run = writeRunManifest(P);
  const scratch = join(P.store.cache, 'research');
  mkdirSync(scratch, { recursive: true });
  mkdirSync(P.store.reports, { recursive: true });
  return { P, run: run.manifest, runPath: run.path, scratch };
}

/**
 * Refuse any write target that is a baseline: the store's baselines folder or a colocated one.
 * @param {Project} P
 * @param {string} path
 */
export function assertScratch(P, path) {
  const abs = resolve(path);
  const bad =
    [P.store.baselines].some((b) => abs === b || abs.startsWith(b + sep)) ||
    abs.split(sep).includes('__pxsig__');
  if (bad) throw new Error(`refusing to write a baseline location: ${abs}`);
  return abs;
}

/**
 * A fresh scratch folder under <store>/cache/research/.
 * @param {Project} P
 * @param {...string} parts
 */
export function freshDir(P, ...parts) {
  const d = assertScratch(P, join(P.store.cache, 'research', ...parts));
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * @param {Project} P
 * @param {string} name
 * @param {unknown} data
 */
export function writeReport(P, name, data) {
  const p = join(P.store.reports, `${name}.json`);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return relative(P.workspaceRoot, p);
}
/**
 * A report a tool wrote (<store>/reports/<name>.json), or null; the caller says which one it reads.
 * @param {Project} P
 * @param {string} name
 * @returns {unknown}
 */
export const readReport = (P, name) => {
  try {
    return JSON.parse(readFileSync(join(P.store.reports, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * One CLI call; parses stdout as JSON when `json`. Exit 2 is an engine error. `out` is the
 * engine's JSON (or its stdout): the caller says which command's output it reads.
 * @param {Project} P
 * @param {string[]} args
 * @param {{ json?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {RustCall<unknown>}
 */
export function rust(P, args, { json = true, env } = {}) {
  const t = performance.now();
  const r = spawnSync(P.rustBin, args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const wallMs = performance.now() - t;
  if (r.error) throw new Error(`pxsig ${args[0]}: ${r.error.message} (binary: ${P.rustBin})`);
  if (r.status === 2 || (json && !r.stdout.trim()))
    throw new Error(`pxsig ${args.join(' ')} → exit ${r.status}\n${r.stderr}`);
  return {
    out: json ? /** @type {unknown} */ (JSON.parse(r.stdout)) : r.stdout,
    status: r.status,
    wallMs,
    stderr: r.stderr,
  };
}

/**
 * The Rust daemon (`pxsig serve`): one JSON request per line, answers matched by id.
 * @param {Project} P
 * @returns {Engine}
 */
export function engine(P) {
  const child = spawn(P.rustBin, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
  /** @type {Map<number, Waiting>} */
  const waiting = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on('line', (line) => {
    // A line the daemon printed: `{ id, result | error, ms }`.
    const msg = /** @type {EngineLine} */ (JSON.parse(line));
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(`pxsig serve: ${msg.error}`));
    // The daemon's answer to the method `call` sent: Engine types it per method.
    else w.resolve({ ...msg.result, _ms: /** @type {number} */ (msg.ms) });
  });
  child.on('exit', () => {
    for (const w of waiting.values()) w.reject(new Error('pxsig serve exited'));
    waiting.clear();
  });
  // Each request resolves with the daemon's answer to its method: the shapes Engine lists.
  return /** @type {Engine} */ ({
    /**
     * @param {string} method
     * @param {Record<string, unknown>} [params]
     * @returns {Promise<unknown>}
     */
    call(method, params = {}) {
      const id = next++;
      return new Promise((resolve_, reject) => {
        waiting.set(id, { resolve: resolve_, reject });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    close() {
      child.stdin.end();
    },
  });
}

/**
 * Run async jobs with at most `n` in flight (the daemon answers in order; this keeps its pipe full).
 * @template T, R
 * @param {T[]} items
 * @param {number} n
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function pool(items, n, fn) {
  const out = /** @type {R[]} */ (Array.from({ length: items.length }));
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

/**
 * The baseline images of `entries`, out of their `.psig` files, as `<dir>/<id>.png` (a container
 * read: the bytes the engine stored, nothing decoded). Returns the ids that have one.
 * @param {Project} P
 * @param {Pick<ManifestEntry, 'id' | 'sig'>[]} entries
 * @param {string} dir
 */
export function baselineImages(P, entries, dir) {
  mkdirSync(assertScratch(P, dir), { recursive: true });
  /** @type {string[]} */
  const have = [];
  for (const e of entries) {
    const img = readImage(resolve(P.workspaceRoot, e.sig));
    if (!img) continue;
    writeFileSync(join(dir, `${e.id}.png`), img);
    have.push(e.id);
  }
  return have;
}

/**
 * The entries the tools work on: one per entry without an interaction state (`--states` keeps
 * those too), every `--every`th, at most `--max`, or the ids matching a suite pattern.
 * @param {RunManifest} run
 * @param {Record<string, string | true>} flags
 * @param {RegExp | null} [pattern]
 */
export function pickEntries(run, flags, pattern = null) {
  let es = run.stories.filter((e) => flags.states || !e.state);
  if (str(flags.modes)) {
    const want = new Set(String(flags.modes).split(','));
    es = es.filter((e) => want.has(e.mode));
  }
  if (pattern) return es.filter((e) => pattern.test(e.story ?? e.id));
  const every = Number(flags.every) || 1;
  es = es.filter((_, i) => i % every === 0);
  return Number(flags.max) ? es.slice(0, Number(flags.max)) : es;
}

/**
 * A manifest for Rust over `entries`, with each sig rewritten by `sigOf` (scratch only).
 * @template {Pick<ManifestEntry, 'sig'>} E
 * @param {Project} P
 * @param {string} path
 * @param {object} base
 * @param {E[]} entries
 * @param {(e: E) => string} [sigOf]
 */
export function scratchManifest(P, path, base, entries, sigOf) {
  const stories = entries.map((e) => {
    const sig = sigOf ? sigOf(e) : e.sig;
    if (sigOf) assertScratch(P, resolve(dirname(path), sig));
    return { ...e, sig };
  });
  writeFileSync(assertScratch(P, path), JSON.stringify({ ...base, stories }));
  return path;
}

/**
 * Crop renders to content the way a check does (the run manifest's `trim`), in place.
 * @param {Project} P
 * @param {RunManifest} run
 * @param {string} dir
 */
export function trimDir(P, run, dir) {
  if (!run.trim || !existsSync(dir)) return null;
  return rust(P, [
    'trim',
    dir,
    '--json',
    '--pad',
    String(run.trim.pad ?? 16),
    '--tolerance',
    String(run.trim.tolerance ?? 8),
  ]).out;
}

/** @param {string} tag */
export const log = (tag) => (/** @type {string} */ m) => console.log(`[${tag}] ${m}`);
/** @param {number[]} xs */
export const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/**
 * @param {number} a
 * @param {number} b
 */
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
