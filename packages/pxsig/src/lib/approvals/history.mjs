/** The log in git (approvals.mjs): lines added since a base, routes, the PR each came in by. */
import { spawnSync } from '../spawn.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { gitShow } from './core.mjs';
/** @import { ApprovalLine } from '../../types.js' */
/** @import { Appended, MergeBase, Route, RouteCounts, TraceRow } from '../../types/t2.js' */

/**
 * The merge base of `ref` and HEAD, read from `dir`'s repository: `{ base }`, `{ base: null }` when
 * there is none (a shallow clone), or `{ error }` when `ref` is not a commit there.
 * @param {string} dir
 * @param {string} ref
 * @returns {MergeBase}
 */
export function mergeBase(dir, ref) {
  const ok = spawnSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    encoding: 'utf8',
  });
  if (ok.status !== 0)
    return { error: `\`${ref}\` is not a commit here (fetch it, or pass another --since)` };
  const r = spawnSync('git', ['-C', dir, 'merge-base', ref, 'HEAD'], { encoding: 'utf8' });
  if (r.status === 0) return { base: r.stdout.trim() };
  const shallow =
    spawnSync('git', ['-C', dir, 'rev-parse', '--is-shallow-repository'], {
      encoding: 'utf8',
    }).stdout?.trim() === 'true';
  return {
    base: null,
    why: `no merge base between ${ref} and HEAD${shallow ? ' (shallow clone: fetch with fetch-depth: 0)' : ''}`,
  };
}

/**
 * The approval log lines added since `base`: the log there must be a byte prefix of today's (the
 * log is append-only). `{ rewritten: true }` when it is not.
 * @param {{ store: { approvals: string } }} P
 * @param {string} base
 * @returns {Appended}
 */
export function appendedSince(P, base) {
  const file = P.store.approvals;
  const now = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  const before = gitShow(file, base) ?? Buffer.alloc(0);
  if (now.length < before.length || !now.subarray(0, before.length).equals(before))
    return { rewritten: true, lines: [] };
  /** @type {ApprovalLine[]} */
  const lines = [];
  for (const t of now.subarray(before.length).toString('utf8').split('\n')) {
    if (!t.trim()) continue;
    try {
      // The log is pxsig's own (`record`, `pxsig migrate`): a complete line is an ApprovalLine.
      lines.push(/** @type {ApprovalLine} */ (JSON.parse(t)));
    } catch {
      // a torn line: `verify` reports it
    }
  }
  return { rewritten: false, lines };
}

/**
 * How a log line's approval was made, for the PR summary (decision 80).
 * @param {Pick<ApprovalLine, 'via' | 'reason'>} l
 * @returns {Route}
 */
export function route(l) {
  if (l.via === 'dashboard' || (l.via === 'undo' && /\(dashboard\)$/.test(l.reason ?? '')))
    return 'dashboard';
  if (l.via === 'mcp') return 'mcp';
  if (['cli', 'check-update', 'undo', 'adopt'].includes(l.via)) return 'terminal';
  return 'other';
}

/**
 * The baselines a range of log lines changed, counted by how each was last approved, and the
 * assistant markers on them (decision 80). Names no person: lines carry none by default (81).
 * @param {readonly (Pick<ApprovalLine, 'via'> & Partial<ApprovalLine> | null | undefined)[]} lines
 * @returns {RouteCounts}
 */
export function changedByRoute(lines) {
  /** @type {Map<string, Pick<ApprovalLine, 'via'> & Partial<ApprovalLine>>} */
  const last = new Map();
  for (const l of lines) if (l?.id) last.set(l.id, l);
  /** @type {RouteCounts} */
  const out = { total: last.size, dashboard: 0, terminal: 0, mcp: 0, other: 0, agents: {} };
  for (const l of last.values()) {
    out[route(l)]++;
    if (l.agent) out.agents[l.agent] = (out.agents[l.agent] ?? 0) + 1;
  }
  return out;
}

/** The pull request a commit came in by: GitHub's merge subject, GitLab's "See merge request", or a squash's "(#12)". */
/** @param {string} text */
const prOf = (text) => {
  const m =
    /Merge pull request #(\d+)/.exec(text) ??
    /See merge request \S*!(\d+)/.exec(text) ??
    /\(#(\d+)\)\s*$/m.exec(text);
  return m ? Number(m[1]) : null;
};

/**
 * Where each approval came in (decision 82): for every log line, the commit that added it
 * (`git blame`) and the pull request that merged that commit (the first merge on HEAD's
 * first-parent line after it, or the commit's own squash subject). Reads git only and returns no
 * author, email or other name: git and the forge hold who. Null when the log is not in git.
 * @param {{ store: { approvals: string } }} P
 * @returns {TraceRow[] | null}
 */
export function traceLog(P) {
  const file = P.store.approvals;
  if (!existsSync(file)) return [];
  const dir = dirname(file);
  const blame = spawnSync('git', ['-C', dir, 'blame', '--porcelain', '--', basename(file)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (blame.status !== 0) return null;
  /** @type {(string | null)[]} */
  const commitOf = [];
  let sha = null;
  for (const row of blame.stdout.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
    if (h) {
      sha = h[1];
      commitOf[Number(h[2])] = /^0+$/.test(sha) ? null : sha;
    }
  }
  // A commit on HEAD's first-parent line came in by itself (a squash, or straight to the branch);
  // any other came in by the first merge on that line that descends from it.
  const mainline = new Set(
    (
      spawnSync('git', ['-C', dir, 'rev-list', '--first-parent', 'HEAD'], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      }).stdout ?? ''
    )
      .split('\n')
      .filter(Boolean)
  );
  /** @type {Map<string, number | null>} */
  const prs = new Map();
  /**
   * @param {string} c
   * @returns {number | null}
   */
  const pr = (c) => {
    if (!prs.has(c)) {
      const own =
        spawnSync('git', ['-C', dir, 'log', '-1', '--format=%s', c], { encoding: 'utf8' }).stdout ??
        '';
      let merge = '';
      if (!mainline.has(c)) {
        // Merges that descend from the commit (newest first); the oldest on the first-parent line brought it in.
        const after = (
          spawnSync('git', ['-C', dir, 'rev-list', '--merges', '--ancestry-path', `${c}..HEAD`], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
          }).stdout ?? ''
        ).split('\n');
        const m = after.filter((x) => mainline.has(x)).at(-1);
        if (m)
          merge =
            spawnSync('git', ['-C', dir, 'log', '-1', '--format=%s%n%b', m], { encoding: 'utf8' })
              .stdout ?? '';
      }
      prs.set(c, prOf(merge) ?? prOf(own));
    }
    // Set just above when it was missing.
    return /** @type {number | null} */ (prs.get(c));
  };
  /** @type {TraceRow[]} */
  const out = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      if (!text.trim()) return;
      /** @type {ApprovalLine} */
      let l;
      try {
        // The log is pxsig's own: a line that parses is an ApprovalLine.
        l = /** @type {ApprovalLine} */ (JSON.parse(text));
      } catch {
        return;
      }
      const c = commitOf[i + 1] ?? null;
      out.push({
        line: i + 1,
        id: l.id,
        batch: l.batch,
        at: l.at,
        via: l.via,
        commit: c ? c.slice(0, 12) : null,
        pr: c ? pr(c) : null,
      });
    });
  return out;
}
