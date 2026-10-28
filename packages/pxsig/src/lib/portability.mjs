/**
 * portability.mjs — store problems that only show on another OS: text records checked out with CRLF,
 * `.psig` files git would convert, and baseline paths Windows cannot hold. Setup-level, `warn`: they
 * never change an exit code (doctor exits 2 only on setup errors).
 */
import { spawnSync } from './spawn.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { toPosix } from './paths.mjs';
/** @import { SetupProblem } from '../types.js' */

/** Windows device names, reserved with or without an extension (`CON`, `nul.txt`, `COM1.psig`). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID = /[<>:"|?*\u0000-\u001f]/;
/** Below Windows' 260-character MAX_PATH, leaving room for the folder the repository is cloned into. */
export const MAX_PATH = 240;

/**
 * Why Windows cannot hold this repository-relative path (`/`-separated), or null.
 * @param {string} rel
 * @returns {string | null}
 */
export function windowsPathProblem(rel) {
  if (rel.length > MAX_PATH) return `${rel.length} characters (over ${MAX_PATH})`;
  for (const part of rel.split('/')) {
    if (RESERVED.test(part)) return `"${part}" is a reserved name on Windows`;
    if (/[. ]$/.test(part)) return `"${part}" ends in a dot or a space`;
    if (INVALID.test(part)) return `"${part}" has a character Windows does not allow (<>:"|?*)`;
  }
  return null;
}

/**
 * Paths that differ only in case: one file on Windows and default macOS, two on Linux.
 * @param {Iterable<string>} rels
 * @returns {[string, string][]}
 */
export function caseCollisions(rels) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  /** @type {[string, string][]} */
  const out = [];
  for (const r of rels) {
    const k = r.toLowerCase();
    // `seen.has(k)`: the get finds the first spelling.
    if (seen.has(k) && seen.get(k) !== r) out.push([/** @type {string} */ (seen.get(k)), r]);
    else seen.set(k, r);
  }
  return out;
}

/**
 * Text files holding CRLF line endings, from `files` (absolute paths).
 * @param {string[]} files
 */
export function crlfFiles(files) {
  return files.filter((f) => {
    try {
      return existsSync(f) && readFileSync(f, 'utf8').includes('\r\n');
    } catch {
      return false;
    }
  });
}

/**
 * Whether git treats `rel` (repository-relative) as binary: true, false, or null when git cannot say.
 * @param {string} repoRoot
 * @param {string} rel
 * @returns {boolean | null}
 */
function gitBinary(repoRoot, rel) {
  const r = spawnSync('git', ['-C', repoRoot, 'check-attr', 'binary', '--', rel], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status !== 0 || !r.stdout) return null;
  return /: binary: set\s*$/.test(r.stdout.trim());
}

/**
 * `line-endings` and `path-portability` setup problems for a project. `sigPaths` are the absolute
 * baseline paths the manifests name; `records` the text records to check for CRLF.
 * @param {{ repoRoot: string, sigPaths: Iterable<string>, records: string[] }} opts
 * @returns {SetupProblem[]}
 */
export function portabilityProblems({ repoRoot, sigPaths, records }) {
  /** @type {SetupProblem[]} */
  const out = [];
  /** @param {string} p */
  const rel = (p) => toPosix(relative(repoRoot, p));
  const crlf = crlfFiles(records).map(rel);
  if (crlf.length)
    out.push({
      code: 'line-endings',
      severity: 'warn',
      reason: `${crlf.join(', ')} checked out with CRLF line endings: add \`*.json text eol=lf\` and \`*.ndjson text eol=lf\` to the store's .gitattributes, then \`git add --renormalize .\``,
    });
  const sigs = [...sigPaths].map(rel);
  if (sigs.length && gitBinary(repoRoot, sigs[0]) === false)
    out.push({
      code: 'line-endings',
      severity: 'warn',
      reason: `git does not treat .psig files as binary (${sigs[0]}): add \`*.psig binary\` to the store's .gitattributes, or git may convert them on checkout`,
    });
  const bad = sigs.map((r) => [r, windowsPathProblem(r)]).filter(([, why]) => why);
  if (bad.length)
    out.push({
      code: 'path-portability',
      severity: 'warn',
      reason: `${bad.length} baseline path(s) Windows cannot check out, e.g. ${bad[0][0]}: ${bad[0][1]}`,
    });
  const pairs = caseCollisions(sigs);
  if (pairs.length)
    out.push({
      code: 'path-portability',
      severity: 'warn',
      reason: `${pairs.length} pair(s) of baseline paths differ only in case (one file on Windows and macOS), e.g. ${pairs[0][0]} and ${pairs[0][1]}`,
    });
  return out;
}
