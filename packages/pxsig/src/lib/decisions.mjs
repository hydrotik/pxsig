/**
 * lib/decisions.mjs — the reason a person gives with a decision stays on the machine.
 *
 * The approval and a11y logs are committed: each line carries the decision's opaque reference
 * (`ref`, lib/approvals/core.mjs `decisionRef`) and no reason. The reason goes to
 * `<store>/reports/decisions.ndjson`, one line per reference, and only when the store's reports/
 * is git-ignored (`reportsIgnored`): a file git could pick up never holds one. No line names a
 * person, a host or a path.
 */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFile, spawnSync } from './spawn.mjs';
import { appendLine, readLines } from './files.mjs';
import { stamp } from './approvals/core.mjs';
import { relPath, toPosix } from './paths.mjs';

/** An approve or prune reason's limit, in characters. */
export const REASON_MAX = 500;

/**
 * A reason as stored: one line of plain text. Control characters, line breaks and bidirectional
 * overrides become a space, runs of spaces one, the ends are trimmed and the rest is cut at `max`
 * characters (as a reader counts them). Nothing left (or not a string): no reason, null.
 * @param {unknown} v
 * @param {number} [max]
 * @returns {string | null}
 */
export function reasonText(v, max = REASON_MAX) {
  if (typeof v !== 'string') return null;
  const one = v
    // oxlint-disable-next-line no-control-regex -- control characters are what this removes
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Characters as a reader sees them (grapheme clusters): an emoji is never cut in half.
  const chars = Array.from(new Intl.Segmenter().segment(one), (g) => g.segment);
  return chars.slice(0, max).join('').trim() || null;
}

/** @typedef {{ workspaceRoot: string, store: { root: string, reports: string } }} DecisionProject */

/** @param {DecisionProject} P */
export const decisionsFile = (P) => join(P.store.reports, 'decisions.ndjson');

/**
 * Where git is asked from (the first folder that exists), and the file's path from there.
 * @param {DecisionProject} P
 */
function where(P) {
  const dir =
    [P.store.reports, P.store.root, P.workspaceRoot].find((d) => existsSync(d)) ?? P.workspaceRoot;
  return { dir, args: ['-C', dir, 'check-ignore', '-q', toPosix(relative(dir, decisionsFile(P)))] };
}
/**
 * `git check-ignore`'s exit: 0 ignored; 1 not ignored (a tracked file too); 128 (not a
 * repository) or no git: nothing there can be committed, so ignored.
 * @param {number | null | undefined} status
 */
const ignoredBy = (status) => status !== 1;
/** @type {Map<string, { at: number, ignored: boolean }>} */
const cache = new Map();
const CACHE_MS = 10_000;
/** @param {string} dir */
const cached = (dir) => {
  const c = cache.get(dir);
  return c && Date.now() - c.at < CACHE_MS ? c.ignored : null;
};
/**
 * @param {string} dir
 * @param {boolean} ignored
 */
const remember = (dir, ignored) => (cache.set(dir, { at: Date.now(), ignored }), ignored);
/** Forget what git said (a test, or a .gitignore just written): the next call asks again. */
export const forgetIgnored = () => cache.clear();

/**
 * Whether git leaves the store's reports/ out (decisions.ndjson as the probe); cached 10 s per store.
 * @param {DecisionProject} P
 * @returns {boolean}
 */
export function reportsIgnored(P) {
  const { dir, args } = where(P);
  const c = cached(dir);
  if (c != null) return c;
  let status = null;
  try {
    status = spawnSync('git', args, { stdio: 'ignore' }).status;
  } catch {
    // git refused or missing: as outside a repository
  }
  return remember(dir, ignoredBy(status));
}

/**
 * `reportsIgnored` without blocking the event loop (the server).
 * @param {DecisionProject} P
 * @returns {Promise<boolean>}
 */
export function reportsIgnoredAsync(P) {
  const { dir, args } = where(P);
  const c = cached(dir);
  if (c != null) return Promise.resolve(c);
  return new Promise((ok) => {
    try {
      execFile('git', args, {}, (err) => {
        const code = /** @type {{ code?: unknown } | null} */ (err)?.code;
        ok(remember(dir, ignoredBy(err ? (typeof code === 'number' ? code : null) : 0)));
      });
    } catch {
      ok(remember(dir, true));
    }
  });
}

/**
 * Keep a decision's reason beside its reference, when there is one and reports/ is git-ignored.
 * @param {DecisionProject} P
 * @param {{ ref: string, log: 'approvals' | 'a11y', id: string, batch?: string | null, via: string, reason?: unknown }} d
 * @param {boolean} ignored `reportsIgnored(P)`, asked by the caller only when there is a reason
 * @returns {{ kept: boolean }}
 */
export function keepReason(P, { ref, log, id, batch = null, via, reason }, ignored) {
  const text = reasonText(reason);
  if (!text || !ignored) return { kept: false };
  const at = new Date().toISOString();
  appendLine(decisionsFile(P), stamp({ at, ref, log, id, batch, via, reason: text }));
  return { kept: true };
}

/**
 * The kept reasons, by reference. A missing or unreadable file reads as none; a torn line (or any
 * line that is not a reason) is left out. Never throws.
 * @param {DecisionProject} P
 * @returns {Map<string, string>}
 */
export function readReasons(P) {
  /** @type {Map<string, string>} */
  const out = new Map();
  let lines = [];
  try {
    lines = readLines(decisionsFile(P)).lines;
  } catch {
    return out;
  }
  for (const l of lines) {
    const { ref, reason } = /** @type {{ ref?: unknown, reason?: unknown }} */ (l ?? {});
    if (typeof ref === 'string' && typeof reason === 'string') out.set(ref, reason);
  }
  return out;
}

/**
 * What the CLI prints, once, when a reason was given and not kept; `what` names it (`Note` for a
 * rejection's reason, which the server says so in its answer).
 * @param {DecisionProject} P
 * @param {'Reason' | 'Note'} [what]
 */
export const notKept = (P, what = 'Reason') =>
  `${what} not kept: ${relPath(P.workspaceRoot, P.store.reports)}/ is not git-ignored. pxsig doctor shows the fix.`;
