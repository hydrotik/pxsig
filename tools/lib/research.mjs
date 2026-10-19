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

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(here, '..', '..', 'packages', 'pxsig', 'src', 'lib');
export const { openProject, writeRunManifest } = await import(join(lib, 'workspace.mjs'));
export const { browserPool, renderStories, STORYBOOK_ERROR } = await import(join(lib, 'capture.mjs'));
const { readImage } = await import(join(lib, 'psig.mjs'));

/** `--key value` and bare `--flag` → object. */
export function parseFlags(argv = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return flags;
}
export const str = (v) => (v && v !== true ? String(v) : null);
export const nums = (v, dflt) => (str(v) ? String(v).split(',').map(Number) : dflt);

/** The project (`--project`, `--workspace`, else the cwd), its run manifest and its scratch root. */
export function project(flags) {
  const P = openProject({ project: str(flags.project), workspace: str(flags.workspace) });
  const run = writeRunManifest(P);
  const scratch = join(P.store.cache, 'research');
  mkdirSync(scratch, { recursive: true });
  mkdirSync(P.store.reports, { recursive: true });
  return { P, run: run.manifest, runPath: run.path, scratch };
}

/** Refuse any write target that is a baseline: the store's baselines folder or a colocated one. */
export function assertScratch(P, path) {
  const abs = resolve(path);
  const bad = [P.store.baselines].some((b) => abs === b || abs.startsWith(b + sep)) || abs.split(sep).includes('__pxsig__');
  if (bad) throw new Error(`refusing to write a baseline location: ${abs}`);
  return abs;
}

/** A fresh scratch folder under <store>/cache/research/. */
export function freshDir(P, ...parts) {
  const d = assertScratch(P, join(P.store.cache, 'research', ...parts));
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

export function writeReport(P, name, data) {
  const p = join(P.store.reports, `${name}.json`);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return relative(P.workspaceRoot, p);
}
export const readReport = (P, name) => {
  try {
    return JSON.parse(readFileSync(join(P.store.reports, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
};

/** One CLI call; parses stdout as JSON when `json`. Exit 2 is an engine error. */
export function rust(P, args, { json = true, env } = {}) {
  const t = performance.now();
  const r = spawnSync(P.rustBin, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env });
  const wallMs = performance.now() - t;
  if (r.error) throw new Error(`pxsig ${args[0]}: ${r.error.message} (binary: ${P.rustBin})`);
  if (r.status === 2 || (json && !r.stdout.trim())) throw new Error(`pxsig ${args.join(' ')} → exit ${r.status}\n${r.stderr}`);
  return { out: json ? JSON.parse(r.stdout) : r.stdout, status: r.status, wallMs, stderr: r.stderr };
}

/** The Rust daemon (`pxsig serve`): one JSON request per line, answers matched by id. */
export function engine(P) {
  const child = spawn(P.rustBin, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(`pxsig serve: ${msg.error}`));
    else w.resolve({ ...msg.result, _ms: msg.ms });
  });
  child.on('exit', () => {
    for (const w of waiting.values()) w.reject(new Error('pxsig serve exited'));
    waiting.clear();
  });
  return {
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
  };
}

/** Run async jobs with at most `n` in flight (the daemon answers in order; this keeps its pipe full). */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
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
 */
export function baselineImages(P, entries, dir) {
  mkdirSync(assertScratch(P, dir), { recursive: true });
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

/** A manifest for Rust over `entries`, with each sig rewritten by `sigOf` (scratch only). */
export function scratchManifest(P, path, base, entries, sigOf) {
  const stories = entries.map((e) => {
    const sig = sigOf ? sigOf(e) : e.sig;
    if (sigOf) assertScratch(P, resolve(dirname(path), sig));
    return { ...e, sig };
  });
  writeFileSync(assertScratch(P, path), JSON.stringify({ ...base, stories }));
  return path;
}

/** Crop renders to content the way a check does (the run manifest's `trim`), in place. */
export function trimDir(P, run, dir) {
  if (!run.trim || !existsSync(dir)) return null;
  return rust(P, ['trim', dir, '--json', '--pad', String(run.trim.pad ?? 16), '--tolerance', String(run.trim.tolerance ?? 8)]).out;
}

export const log = (tag) => (m) => console.log(`[${tag}] ${m}`);
export const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
