/**
 * approvals.mjs — every baseline write is backed up, logged and reversible.
 *
 *   <store>/approvals.ndjson          one line per approved entry: when, how, why, batch, the git
 *                                     HEAD, the sha256 of the baseline before / after, and the
 *                                     assistant marker when there is one
 *   <store>/history/<batch>/<id>.psig the previous baseline (signature + image), for `undo`
 *
 * The server calls `snapshot()` + `record()` around every approve, whichever client asked
 * (dashboard, Storybook panel, MCP, CLI), so nothing reaches a baseline without a trail.
 *
 * `undo` restores a batch from `history/<batch>/` when this machine has it. The history folder is
 * not committed, so on another machine (a teammate, CI) it restores from git instead: each log
 * line names the git HEAD at approval time and the sha256 of the baseline it replaced, and a file
 * is restored from a commit only when its bytes hash to exactly that `before`. A first baseline
 * (`before: null`) is undone by moving the file to the store trash/.
 *
 * Order of an approval: snapshot, then the new `.psig`, then the log line (appended in one write,
 * lib/files.mjs). A crash between the last two leaves a baseline the log does not know yet:
 * `verify` calls it `interrupted` (not `mismatch`) when the batch's snapshot still holds the logged
 * bytes, and `approve undo <batch>` puts it back.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from './spawn.mjs';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { appendLine, fault, readLines, writeAtomic } from './files.mjs';
import { agentName } from './agents.mjs';
import { PXSIG_VERSION } from './workspace.mjs';
/** @import { ApprovalLine, Config, Project, TornLine } from '../types.js' */

export const sha256 = (path) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;

/** @returns {{ latestPng: string, sig: string, log: string, history: string }} */
export function paths(P, entry) {
  return {
    latestPng: join(P.store.latest, `${entry.id}.png`),
    sig: resolve(P.workspaceRoot, entry.sig),
    log: P.store.approvals,
    history: P.store.history,
  };
}

const git = (root, ...args) =>
  spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';
/**
 * Who approved, for the log: nobody by default (decision 81). The commit that adds a line, and the
 * pull request that merges it, already say who; pxsig keeps no personal data. A team that wants the
 * git email on every line sets `approvals.identity: "git-email"`.
 * @param {Pick<Config, 'approvals'> | null} [config]
 */
export const who = (root, config = null) =>
  config?.approvals?.identity === 'git-email'
    ? git(root, 'config', 'user.email') || process.env.USER || 'unknown'
    : null;
/**
 * A log line with `by` only when there is one, the pxsig version that wrote it (decision 92), and
 * `agent` when this process carries an assistant's marker (lib/agents.mjs; decision 80): the
 * assistant's name, never a person's. A decision a person made through the dashboard link or the CLI
 * carries none: the CLI refuses under a marker, so a server started under an assistant would
 * otherwise mark a person's decisions with the assistant that started it.
 */
export const PERSON_VIA = new Set(['dashboard', 'cli']);
export const stamp = (line, env = process.env, { person = PERSON_VIA.has(line.via) } = {}) => {
  const { by, ...rest } = line;
  const agent = person ? null : agentName(env);
  return { ...rest, ...(by ? { by } : {}), ...(agent ? { agent } : {}), pxsig: PXSIG_VERSION };
};
export const newBatch = (via) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${via}`;

/** Copy the current baseline aside before it is overwritten. */
export function snapshot(P, entry, batch) {
  const p = paths(P, entry);
  const dir = join(p.history, batch);
  mkdirSync(dir, { recursive: true });
  if (existsSync(p.sig)) copyFileSync(p.sig, join(dir, `${entry.id}.psig`));
  fault('after-snapshot');
  return { before: sha256(p.sig) };
}

/**
 * @param P
 * @param entry
 * @param {{ batch: string, via: string, reason?: string | null, before?: string | null, kind?: string | null, person?: boolean }} opts
 */
export function record(P, entry, { batch, via, reason = null, before, kind = null, person }) {
  const p = paths(P, entry);
  fault('after-psig');
  const line = stamp(
    {
      at: new Date().toISOString(),
      id: entry.id,
      by: who(P.workspaceRoot, P.config),
      via,
      batch,
      reason,
      kind,
      gitHead: git(P.workspaceRoot, 'rev-parse', '--short', 'HEAD'),
      before,
      after: sha256(p.sig),
    },
    process.env,
    { person: person ?? PERSON_VIA.has(via) }
  );
  appendLine(p.log, line);
  return line;
}

/**
 * The logged approvals; a torn line (a write cut short by a crash) is left out: see `tornLines`.
 * The log is pxsig's own (`record`, `pxsig migrate`), so every complete line is an ApprovalLine.
 * @param {{ store: { approvals: string } }} P
 * @returns {ApprovalLine[]}
 */
export const readLog = (P) => /** @type {ApprovalLine[]} */ (readLines(P.store.approvals).lines);

/**
 * Lines of the approval log a crash cut short, `{ line, text }` (integrity code `log-torn`).
 * @param {{ store: { approvals: string } }} P
 */
export const tornLines = (P) => readLines(P.store.approvals).torn;

const sha256Bytes = (b) => createHash('sha256').update(b).digest('hex');

/** A file's bytes at a git revision, or null. Works from the file's own folder (any repo root). */
function gitShow(file, rev) {
  const r = spawnSync('git', ['-C', dirname(file), 'show', `${rev}:./${basename(file)}`], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : null;
}

/** Revisions to look for the pre-approval bytes in: the recorded HEAD first, then the file's history. */
function candidateRevs(file, gitHead) {
  const r = spawnSync(
    'git',
    ['-C', dirname(file), 'log', '--format=%H', '-n', '200', '--', basename(file)],
    { encoding: 'utf8' }
  );
  const log = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  return [...new Set([...(gitHead ? [gitHead] : []), ...log])];
}

/**
 * Restore every entry a batch approved (or only `ids` of them) to the baseline it replaced. Returns
 * `{ restored: [id], removed: [id], refused: [{ id, why }], source }`; `source` is `history` (the
 * local snapshot) or `git`. With neither available for an entry, it is refused, never guessed.
 * @param {Project} P
 */
export function undo(P, manifest, batch, { git = true, ids: only = null } = {}) {
  const keep = (id) => !only || only.includes(id);
  const lines = readLog(P).filter((l) => l.batch === batch && keep(l.id));
  const dir = join(P.store.history, batch);
  const local = existsSync(dir);
  if (!local && !lines.length)
    throw new Error(`no snapshot and no approvals logged for batch ${batch}`);
  if (!local && !git) throw new Error(`no snapshot for batch ${batch} on this machine`);
  const byId = new Map(manifest.stories.map((s) => [s.id, s]));
  const out = { restored: [], removed: [], refused: [], source: local ? 'history' : 'git' };
  const trashDir = join(P.store.trash, `undo-${batch}`);
  const toTrash = (file, id) => {
    const dest = join(trashDir, relative(P.workspaceRoot, file));
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(file, dest);
    out.removed.push(id);
  };
  // The first line per id is the one that holds the pre-batch state.
  const first = new Map();
  for (const l of lines) if (!first.has(l.id)) first.set(l.id, l);
  const snaps = local
    ? new Set(
        readdirSync(dir)
          .filter((n) => n.endsWith('.psig'))
          .map((n) => n.slice(0, -'.psig'.length))
          .filter(keep)
      )
    : new Set();
  const ids = new Set([...snaps, ...first.keys()]);
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      out.refused.push({ id, why: 'not in the manifest any more' });
      continue;
    }
    const file = paths(P, entry).sig;
    const l = first.get(id);
    if (snaps.has(id)) {
      writeAtomic(file, readFileSync(join(dir, `${id}.psig`)));
      out.restored.push(id);
      continue;
    }
    if (!l) continue;
    if (l.before == null) {
      // A first baseline: undoing it removes the file, if it is still the one approved.
      if (!existsSync(file)) continue;
      if (l.after && sha256(file) !== l.after)
        out.refused.push({ id, why: 'the baseline changed after this batch: not removing it' });
      else toTrash(file, id);
      continue;
    }
    if (local) {
      out.refused.push({ id, why: 'no snapshot of the old baseline in this batch' });
      continue;
    }
    let bytes = null;
    for (const rev of candidateRevs(file, l.gitHead)) {
      const b = gitShow(file, rev);
      if (b && sha256Bytes(b) === l.before) {
        bytes = b;
        break;
      }
    }
    if (!bytes) {
      out.refused.push({
        id,
        why: `no commit holds the old baseline (sha256 ${l.before.slice(0, 12)}…): not restoring it`,
      });
      continue;
    }
    writeAtomic(file, bytes);
    out.restored.push(id);
  }
  return out;
}

/** When a batch started, from its name (`newBatch`: an ISO time with `-` for `:` and `.`); else null. */
function batchTime(batch) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(batch);
  return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : null;
}

/**
 * The batch whose approval of `id` was cut short: it started after the entry's last log line, its
 * snapshot holds the bytes that line logged, and it logged no line for the entry. Null when no
 * snapshot on this machine says so.
 */
function interruptedBatch(P, id, last, batchesWithLine) {
  const logged = last?.after;
  if (!logged || !existsSync(P.store.history)) return null;
  for (const batch of readdirSync(P.store.history).sort().reverse()) {
    if (batchesWithLine.has(`${batch}\0${id}`)) continue;
    const t = batchTime(batch);
    if (t == null || !(t >= Date.parse(last.at))) continue;
    const snap = join(P.store.history, batch, `${id}.psig`);
    if (existsSync(snap) && sha256(snap) === logged) return batch;
  }
  return null;
}

/**
 * Baselines whose bytes differ from the last approval logged for them: written outside the trail
 * (`mismatched`), or by an approval a crash cut short before its log line (`interrupted`).
 */
/** A log line's pxsig older than this one (major.minor), or written before lines named theirs. */
export const olderThanThis = (v) => {
  if (!v) return true;
  const [a, b] = String(v).split('.').map(Number);
  const [x, y] = PXSIG_VERSION.split('.').map(Number);
  return a < x || (a === x && b < y);
};

/** @param {Project} P */
export function verify(P, manifest) {
  // The approval log is pxsig's own: every complete line is an ApprovalLine.
  const { lines, torn } = /** @type {{ lines: ApprovalLine[], torn: TornLine[] }} */ (
    readLines(P.store.approvals)
  );
  const last = new Map();
  const batchesWithLine = new Set();
  for (const l of lines) {
    last.set(l.id, l);
    batchesWithLine.add(`${l.batch}\0${l.id}`);
  }
  const untracked = [];
  const mismatched = [];
  const interrupted = [];
  for (const e of manifest.stories) {
    const l = last.get(e.id);
    if (!l) {
      // A baseline with no log line. An entry with no baseline yet has nothing to verify.
      if (existsSync(paths(P, e).sig)) untracked.push(e.id);
      continue;
    }
    const now = sha256(paths(P, e).sig);
    if (now === l.after) continue;
    const batch = interruptedBatch(P, e.id, l, batchesWithLine);
    // The pxsig that wrote the line (lines before 0.4.0 carry none): an older one beside this one
    // (a teammate who has not upgraded) explains a difference better than "outside the trail".
    const writtenBy = l.pxsig ?? null;
    if (batch)
      interrupted.push({
        id: e.id,
        batch,
        logged: l.after?.slice(0, 12),
        now: now?.slice(0, 12),
        writtenBy,
      });
    else
      mismatched.push({
        id: e.id,
        logged: l.after?.slice(0, 12),
        now: now?.slice(0, 12),
        writtenBy,
        older: olderThanThis(writtenBy),
      });
  }
  return {
    logged: last.size,
    untracked: untracked.length,
    untrackedSample: untracked.slice(0, 10),
    untrackedIds: untracked,
    mismatched,
    interrupted,
    torn: torn.length,
  };
}

/**
 * The merge base of `ref` and HEAD, read from `dir`'s repository: `{ base }`, `{ base: null }` when
 * there is none (a shallow clone), or `{ error }` when `ref` is not a commit there.
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
 */
export function appendedSince(P, base) {
  const file = P.store.approvals;
  const now = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  const before = gitShow(file, base) ?? Buffer.alloc(0);
  if (now.length < before.length || !now.subarray(0, before.length).equals(before))
    return { rewritten: true, lines: [] };
  const lines = [];
  for (const t of now.subarray(before.length).toString('utf8').split('\n')) {
    if (!t.trim()) continue;
    try {
      lines.push(JSON.parse(t));
    } catch {
      // a torn line: `verify` reports it
    }
  }
  return { rewritten: false, lines };
}

/** How a log line's approval was made, for the PR summary (decision 80). */
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
 */
export function changedByRoute(lines) {
  const last = new Map();
  for (const l of lines) if (l?.id) last.set(l.id, l);
  const out = { total: last.size, dashboard: 0, terminal: 0, mcp: 0, other: 0, agents: {} };
  for (const l of last.values()) {
    out[route(l)]++;
    if (l.agent) out.agents[l.agent] = (out.agents[l.agent] ?? 0) + 1;
  }
  return out;
}

/** The pull request a commit came in by: GitHub's merge subject, GitLab's "See merge request", or a squash's "(#12)". */
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
  const prs = new Map();
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
    return prs.get(c);
  };
  const out = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      if (!text.trim()) return;
      let l;
      try {
        l = JSON.parse(text);
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

/**
 * Store files and baselines (any `.psig`, for the colocated layout) git lists as conflicted
 * (`git ls-files -u`): a merge or rebase left them half-done. Workspace-relative.
 */
export function conflictedStoreFiles(P) {
  // Run from the workspace root without --full-name: git prints paths relative to it.
  const store = relative(P.workspaceRoot, P.store.root).split('\\').join('/') || '.';
  const r = spawnSync(
    'git',
    ['-C', P.workspaceRoot, 'ls-files', '-u', '-z', '--', store, '*.psig'],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) return [];
  const files = new Set();
  for (const rec of r.stdout.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab > 0) files.add(rec.slice(tab + 1));
  }
  return [...files].sort();
}
