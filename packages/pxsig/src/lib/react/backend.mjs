/**
 * lib/react/backend.mjs — which React Compiler a project's analysis uses (`react.compiler`), and the
 * built-in one's half of a run.
 *
 *   auto (true, the default)  the project's babel-plugin-react-compiler with @babel/core (peers.mjs,
 *                             worker.mjs in a pool); missing packages: the "not installed" line
 *   babel                     the same, named
 *   oxc                       the engine's built-in compiler (`pxsig react-compile`, crates/pxsig-react,
 *                             oxc_react_compiler), in a process of its own: no Node packages
 *
 * `auto` keeps meaning Babel until the built-in compiler agrees with the newest released Babel
 * plugin (the parity gate). Outputs name each compiler by package and version only, never a path.
 */
import { execFile, spawnSync } from '../spawn.mjs';
import { BABEL, COMPILER, reactPeers } from './peers.mjs';

/** @import { Project } from '../../types.js' */
/** @import { CompileResult, ReactConfig, ReactPeers } from '../../types/react.js' */

/** The built-in compiler's crate, as the engine names it. */
export const OXC = 'oxc_react_compiler';
/** Each file side may take this long in the engine, as a Babel worker's task may (pool.mjs). */
const PER_FILE_MS = 10_000;
const NO_FEATURE = 'this engine is built without the built-in React Compiler';
/** @param {string | Buffer} stderr the engine's: read for this one reason, never passed on (it may name paths) */
const noFeature = (stderr) => /built without the React Compiler/.test(stderr.toString());

/**
 * The compiler the settings pick: `oxc` for "oxc", else Babel (`auto` and "babel").
 * @param {Pick<ReactConfig, 'choice'>} cfg
 * @returns {'babel' | 'oxc'}
 */
export const backendOf = (cfg) => (cfg.choice === 'oxc' ? 'oxc' : 'babel');

/**
 * The packages the chosen compiler needs and the project lacks (names only): none for `oxc`.
 * @param {Pick<Project, 'root' | 'workspaceRoot'>} P
 * @param {Pick<ReactConfig, 'choice'>} cfg
 * @param {ReactPeers} [peers]
 */
export function missingFor(P, cfg, peers) {
  if (backendOf(cfg) === 'oxc') return [];
  const p = peers ?? reactPeers(P);
  return [p.compiler ? null : COMPILER, p.babel ? null : BABEL].filter((x) => x != null);
}

/**
 * A run's compiler in words, from react.json's `backend`: "babel-plugin-react-compiler 1.0.0 with
 * @babel/core 7.29.0", or "oxc_react_compiler 0.143.0 (built-in, experimental)".
 * @param {{ name?: string, compiler?: string | null, babel?: string | null }} b
 */
export function compilerName(b) {
  if (b.name === 'oxc') return `${OXC} ${b.compiler ?? ''} (built-in, experimental)`;
  return `${COMPILER} ${b.compiler ?? ''}${b.babel ? ` with ${BABEL} ${b.babel}` : ''}`;
}

/**
 * The engine's answer, or why it gave none (a message with no path).
 * @param {{ status: number | null, stdout: string, stderr: string, error?: Error }} r
 * @returns {{ version: string } | { why: string }}
 */
function versionFrom(r) {
  if (r.status === 0)
    try {
      const out = /** @type {{ compiler?: { version?: unknown } }} */ (JSON.parse(r.stdout));
      if (typeof out.compiler?.version === 'string') return { version: out.compiler.version };
    } catch {
      // not JSON: an engine too old to have react-compile
    }
  if (noFeature(r.stderr)) return { why: NO_FEATURE };
  return {
    why: `the engine's react-compile exited with ${r.error ? 'an error' : String(r.status)}`,
  };
}

/**
 * The built-in compiler's version, asked of the engine with an empty batch (no file compiled), or
 * why it cannot run: an engine built without the `react-oxc` feature exits 2.
 * @param {string} rustBin
 * @returns {{ version: string } | { why: string }}
 */
export function oxcVersion(rustBin) {
  const r = spawnSync(rustBin, ['react-compile'], {
    input: '{"files":[]}',
    encoding: 'utf8',
    timeout: PER_FILE_MS,
  });
  return versionFrom({
    status: r.status,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
    error: r.error,
  });
}

/**
 * Compile file sides with the built-in compiler: one engine process for the batch. The engine
 * isolates a file that crashes the compiler (`compiler-error`); a batch that runs out of time or is
 * skipped (`signal`) rejects, and the run says it failed.
 * @param {string} rustBin
 * @param {string} cwd
 * @param {{ path: string, text: string, parser: string[] }[]} files
 * @param {{ compilationMode: string, target: string, environment: Record<string, unknown>, lint: boolean }} options
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ results: CompileResult[], warnings: string[] }>}
 */
export function compileOxc(rustBin, cwd, files, options, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      rustBin,
      ['react-compile'],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        timeout: PER_FILE_MS * Math.max(1, files.length),
        ...(signal ? { signal } : {}),
      },
      (err, out, stderr) => {
        if (err) {
          const code = /** @type {{ code?: unknown }} */ (err).code;
          reject(
            new Error(
              noFeature(stderr)
                ? NO_FEATURE
                : `the engine's react-compile exited with ${typeof code === 'number' ? code : 'an error'}`
            )
          );
          return;
        }
        try {
          const o = /** @type {{ results?: CompileResult[], warnings?: string[] }} */ (
            JSON.parse(String(out))
          );
          if (!Array.isArray(o.results) || o.results.length !== files.length)
            throw new Error('short');
          resolve({ results: o.results, warnings: o.warnings ?? [] });
        } catch {
          reject(new Error("the engine's react-compile answered no results"));
        }
      }
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ options, files }));
  });
}
