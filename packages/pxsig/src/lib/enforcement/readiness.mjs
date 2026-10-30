/** The readiness tally (enforcement.mjs): one line per configured-warn run, outside the repository. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoStateDir } from '../machine.mjs';
import { spawnSync } from '../spawn.mjs';
import { DAY } from './resolve.mjs';
/** @import { MachineOptions, Project } from '../../types.js' */
/** @import { ReadinessLine, ReadinessTally } from '../../types/t2.js' */
/** @import { outcome, resolveEnforcement } from './resolve.mjs' */
/** Which machine's state folder (tests point it elsewhere); lib/machine.mjs `repoStateDir`. */
/** @typedef {MachineOptions & { git?: (cwd: string, args: string[]) => string }} StateOptions */

// --- the readiness tally (docs/configuration.md#enforcement): one line per configured-warn run ---

const KEEP_LINES = 5000;
const KEEP_DAYS = 90;

/**
 * `<stateDir>/readiness.ndjson` for this project's repository.
 * @param {Pick<Project, 'workspaceRoot'>} P
 * @param {StateOptions} [opts]
 */
export const readinessPath = (P, opts) =>
  join(repoStateDir(P.workspaceRoot, opts), 'readiness.ndjson');

/**
 * @param {string} cwd
 * @param {string[]} args
 */
const gitOut = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/**
 * Append one readiness line, when a configured gate is on warn (never for the quiet built-in a11y
 * default). Keeps the last 5,000 lines per project and gate set, and 90 days.
 * A write failure is one warning on stderr and never changes the exit code.
 * @param {Pick<Project, 'workspaceRoot' | 'name'>} P
 * @param {ReturnType<typeof resolveEnforcement>} enf
 * @param {ReturnType<typeof outcome>} out
 * @param {{ source?: string, suite?: string | null, counts?: Record<string, number>, now?: Date, opts?: StateOptions }} [extra]
 */
export function appendReadiness(
  P,
  enf,
  out,
  { source, suite = null, counts = {}, now = new Date(), opts } = {}
) {
  if (!enf.configured.length) return null;
  const sha = gitOut(P.workspaceRoot, ['rev-parse', 'HEAD']);
  let branch = gitOut(P.workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') branch = null;
  /** @type {ReadinessLine} */
  const line = {
    at: now.toISOString(),
    project: P.name,
    suite,
    sha,
    branch,
    gates: enf.configured,
    wouldFail: out.wouldFail,
    wouldExit: out.wouldExit,
    counts,
    source,
  };
  try {
    const path = readinessPath(P, opts);
    mkdirSync(join(path, '..'), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    trimReadiness(path, now);
    return line;
  } catch (e) {
    process.stderr.write(
      `[pxsig] warn mode: the readiness tally was not written (${/** @type {Error} */ (e).message}); the run's result is unchanged\n`
    );
    return null;
  }
}

/**
 * The readiness lines, a line that does not parse left out. The file is pxsig's own
 * (`appendReadiness`), so every line that parses is a ReadinessLine.
 * @param {string} path
 * @returns {ReadinessLine[]}
 */
function readReadiness(path) {
  try {
    return /** @type {ReadinessLine[]} */ (
      readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return /** @type {ReadinessLine} */ (JSON.parse(l));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    );
  } catch {
    return [];
  }
}

/**
 * @param {string} path
 * @param {Date} now
 */
function trimReadiness(path, now) {
  const lines = readReadiness(path);
  const cutoff = now.getTime() - KEEP_DAYS * DAY;
  const fresh = lines.filter((l) => Date.parse(l.at) >= cutoff);
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {ReadinessLine[]} */
  const keep = [];
  for (let i = fresh.length - 1; i >= 0; i--) {
    const k = `${fresh[i].project}\n${[...(fresh[i].gates ?? [])].sort().join(',')}`;
    const n = seen.get(k) ?? 0;
    if (n >= KEEP_LINES) continue;
    seen.set(k, n + 1);
    keep.push(fresh[i]);
  }
  if (keep.length !== lines.length)
    writeFileSync(
      path,
      keep
        .reverse()
        .map((l) => JSON.stringify(l))
        .join('\n') + (keep.length ? '\n' : '')
    );
}

/**
 * The tally for this project: runs and would-fail runs over the kept lines, and separately on the
 * default branch (`main` or `master`). Null when there are none.
 * @param {Pick<Project, 'workspaceRoot' | 'name'>} P
 * @param {{ opts?: StateOptions, branchNames?: string[] }} [extra]
 * @returns {ReadinessTally | null}
 */
export function readinessTally(P, { opts, branchNames = ['main', 'master'] } = {}) {
  const lines = readReadiness(readinessPath(P, opts)).filter((l) => l.project === P.name);
  if (!lines.length) return null;
  /** @param {ReadinessLine[]} ls */
  const wf = (ls) => ls.filter((l) => l.wouldFail).length;
  const main = branchNames
    .map(
      /**
       * @param {string} b
       * @returns {[string, ReadinessLine[]]}
       */
      (b) => [b, lines.filter((l) => l.branch === b)]
    )
    .find(([, ls]) => ls.length);
  return {
    runs: lines.length,
    wouldFail: wf(lines),
    ...(main ? { main: { branch: main[0], runs: main[1].length, wouldFail: wf(main[1]) } } : {}),
    last: lines.filter((l) => l.wouldFail).pop() ?? null,
  };
}
