/**
 * lib/react/index.mjs — one React analysis run (alert mode: nothing here changes an exit code).
 *
 *   1. the engine's `react-plan`: the changed module files, each side's hash and cache hit;
 *   2. the cache misses only, compiled by the project's React Compiler in a worker pool;
 *   3. the engine's `react-diff`: base vs now per function, the cache, `reports/react.json`.
 *
 * The plan, options and results pass as files under `<store>/reports/.run/`. A run with nothing to
 * compile starts no worker and loads no Babel. When another process holds the store (the server),
 * the run reads the cache, works in a temporary folder and writes nothing in the store.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from '../spawn.mjs';
import { writeAtomic } from '../files.mjs';
import { describeLock, readLock } from '../lock.mjs';
import { relPath } from '../paths.mjs';
import { SetupError, writeRunManifest } from '../workspace.mjs';
import { configWarning, reactConfig } from './config.mjs';
import { autoTarget, BABEL, COMPILER, reactPeers } from './peers.mjs';
import { createPool } from './pool.mjs';

/** @import { Flags, Project } from '../../types.js' */
/** @import { CompileResult, ReactPlan, ReactReport, ReactRun } from '../../types/react.js' */

/** @param {unknown} code an exit code, or a spawn error's code */
const engineCode = (code) =>
  typeof code === 'number' || typeof code === 'string' ? String(code) : 'an error';

/**
 * Run the engine; resolves with its stdout, rejects with a message that names no path.
 * @param {string} bin
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<string>}
 */
const engine = (bin, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }, (err, out) => {
      if (err)
        reject(
          new Error(
            `the engine's ${args[0]} exited with ${engineCode(/** @type {{ code?: unknown }} */ (err).code)}`
          )
        );
      else resolve(String(out));
    });
  });

/**
 * The line for a project that does not have what the compiler analysis needs.
 * @param {string[]} missing
 */
const notInstalled = (missing) =>
  `react: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not installed in this project: compiler analysis skipped (react.compiler: false hides this line)`;

/**
 * Analyse the changed React files of a project.
 * @param {Project} P
 * @param {{ since?: string, files?: string[], all?: boolean, workers?: number, flags?: Flags, env?: NodeJS.ProcessEnv, manifest?: string }} [opts]
 *   `since` (default `main`), `files` (workspace-relative, compared with HEAD) or `all`; `workers`:
 *   the pool's size at most (default: the CPUs less one, at most 4); `manifest`: a run manifest
 *   already written (a check's, its suite's entries), else the project's is written.
 * @returns {Promise<ReactRun>}
 */
export async function analyse(
  P,
  { since, files, all = false, workers, flags = {}, env = process.env, manifest: runManifest } = {}
) {
  const t0 = Date.now();
  const cfg = reactConfig(P, { flags, env });
  // A bad value that turns the compiler analysis off (a bad `react.renders` turns off only
  // render counting).
  const warning = configWarning(cfg);
  if (warning) return { ran: false, why: 'config', text: warning };
  if (cfg.off) return { ran: false, why: 'off', text: `react: off (${cfg.off})` };
  if (!cfg.compiler)
    return {
      ran: false,
      why: 'off',
      text: 'react: compiler analysis is off (react.compiler: false)',
    };
  const peers = reactPeers(P);
  const missing = [peers.compiler ? null : COMPILER, peers.babel ? null : BABEL].filter(
    (x) => x != null
  );
  if (!peers.compiler || !peers.babel)
    return { ran: false, why: 'not-installed', text: notInstalled(missing) };

  const held = readLock(P);
  const heldBy = held && !held.stale && held.pid !== process.pid ? describeLock(P, held) : null;
  const runDir = heldBy
    ? mkdtempSync(join(tmpdir(), 'pxsig-react-'))
    : join(P.store.reports, '.run');
  /** @type {ReturnType<typeof createPool> | null} */
  let pool = null;
  try {
    const manifest = runManifest ?? writeRunManifest(P, undefined, { dir: runDir }).path;
    const options = {
      compilationMode: cfg.compilationMode,
      target: cfg.target === 'auto' ? autoTarget(peers.react) : cfg.target,
      environment: cfg.environment,
      lint: cfg.lint,
    };
    const key = {
      backend: 'babel',
      compiler: peers.compiler.version,
      babel: peers.babel.version,
      options,
    };
    const optionsFile = join(runDir, 'react-options.json');
    writeAtomic(optionsFile, JSON.stringify({ key, exclude: cfg.exclude }));
    const planFile = join(runDir, 'react-plan.json');
    const cache = join(P.store.cache, 'react');
    const select = all
      ? ['--all']
      : files?.length
        ? ['--files', files.join(',')]
        : ['--since', since ?? 'main'];
    // `--root`: the workspace, like `affected` (paths in the plan are workspace-relative).
    await engine(
      P.rustBin,
      [
        'react-plan',
        '--manifest',
        manifest,
        '--root',
        P.workspaceRoot,
        ...select,
        '--cache',
        cache,
        '--options',
        `@${optionsFile}`,
        '--out',
        planFile,
      ],
      P.workspaceRoot
    );
    const plan = /** @type {ReactPlan} */ (JSON.parse(readFileSync(planFile, 'utf8')));
    /** @type {Map<string, { path: string, text: string, parser: string[] }>} */
    const misses = new Map();
    for (const f of plan.files)
      for (const side of [f.head, f.base])
        if (side && !side.hit && side.text != null)
          misses.set(side.sha, { path: f.path, text: side.text, parser: f.parser });
    /** @type {Record<string, CompileResult>} */
    const results = {};
    if (misses.size) {
      pool = createPool({
        size: Math.max(
          1,
          Math.min(misses.size, workers ?? Math.min(availableParallelism() - 1, 4))
        ),
        babel: peers.babel.path,
        compiler: peers.compiler.path,
        cwd: P.workspaceRoot,
        options,
      });
      const p = pool;
      await Promise.all(
        [...misses].map(async ([sha, task]) => {
          results[sha] = await p.compile(task);
        })
      );
      await pool.close();
    }
    const resultsFile = join(runDir, 'react-results.json');
    writeAtomic(
      resultsFile,
      JSON.stringify({
        backend: {
          name: 'babel',
          compiler: peers.compiler.version,
          babel: peers.babel.version,
          options,
        },
        project: P.name,
        ms: Date.now() - t0,
        results,
      })
    );
    const out = heldBy ? join(runDir, 'react.json') : join(P.store.reports, 'react.json');
    await engine(
      P.rustBin,
      [
        'react-diff',
        '--plan',
        planFile,
        '--results',
        resultsFile,
        '--cache',
        cache,
        '--out',
        out,
        ...(heldBy ? ['--read-only'] : []),
      ],
      P.workspaceRoot
    );
    const report = /** @type {ReactReport} */ (JSON.parse(readFileSync(out, 'utf8')));
    return {
      ran: true,
      report,
      saved: heldBy ? null : relPath(P.workspaceRoot, out),
      heldBy,
      compiled: misses.size,
      workers: pool?.started ?? 0,
    };
  } catch (e) {
    // No manifest yet, or another setup problem: exit 2, like every command.
    if (e instanceof SetupError) throw e;
    return {
      ran: false,
      why: 'failed',
      text: `react: analysis failed (${/** @type {Error} */ (e).message}): nothing compared`,
    };
  } finally {
    await pool?.close();
    if (heldBy) rmSync(runDir, { recursive: true, force: true });
  }
}
