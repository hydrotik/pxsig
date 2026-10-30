/** The approval trail (approvals.mjs): hashes, the snapshot before a write, the log line. */
import { createHash } from 'node:crypto';
import { spawnSync } from '../spawn.mjs';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { appendLine, fault, readLines } from '../files.mjs';
import { agentName } from '../agents.mjs';
import { PXSIG_VERSION } from '../workspace.mjs';
/** @import { ApprovalLine, Config, Project } from '../../types.js' */
/** @import { ApprovalProject, EntryPaths, RecordOptions } from '../../types/t2.js' */

/**
 * A file's sha256, or null when it does not exist.
 * @param {string} path
 */
export const sha256 = (path) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;

/**
 * @param {ApprovalProject} P
 * @param {EntryPaths} entry
 * @returns {{ latestPng: string, sig: string, log: string, history: string }}
 */
export function paths(P, entry) {
  return {
    latestPng: join(P.store.latest, `${entry.id}.png`),
    sig: resolve(P.workspaceRoot, entry.sig),
    log: P.store.approvals,
    history: P.store.history,
  };
}

/**
 * @param {string} root
 * @param {string[]} args
 */
const git = (root, ...args) =>
  spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';
/**
 * Who approved, for the log: nobody by default (`approvals.identity`, docs/configuration.md#keys).
 * The commit that adds a line, and the pull request that merges it, already say who; pxsig keeps no
 * personal data. A team that wants the git email on every line sets `approvals.identity:
 * "git-email"`.
 * @param {string} root
 * @param {Pick<Config, 'approvals'> | null} [config]
 */
export const who = (root, config = null) =>
  config?.approvals?.identity === 'git-email'
    ? git(root, 'config', 'user.email') || process.env.USER || 'unknown'
    : null;
/**
 * A log line with `by` only when there is one, the pxsig version that wrote it, and `agent` when
 * this process carries an assistant's marker (lib/agents.mjs;
 * docs/agents.md#what-a-marker-changes): the assistant's name, never a person's. A decision a
 * person made through the dashboard link or the CLI carries none: the CLI refuses under a marker,
 * so a server started under an assistant would otherwise mark a person's decisions with the
 * assistant that started it.
 * @type {ReadonlySet<string | undefined>}
 */
export const PERSON_VIA = new Set(['dashboard', 'cli']);
/**
 * @template {{ via?: string, by?: unknown }} L
 * @param {L} line
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ person?: boolean }} [options]
 */
export const stamp = (line, env = process.env, { person = PERSON_VIA.has(line.via) } = {}) => {
  const { by, ...rest } = line;
  const agent = person ? null : agentName(env);
  return { ...rest, ...(by ? { by } : {}), ...(agent ? { agent } : {}), pxsig: PXSIG_VERSION };
};
/** @param {string} via */
export const newBatch = (via) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${via}`;

/**
 * Copy the current baseline aside before it is overwritten.
 * @param {ApprovalProject} P
 * @param {EntryPaths} entry
 * @param {string} batch
 */
export function snapshot(P, entry, batch) {
  const p = paths(P, entry);
  const dir = join(p.history, batch);
  mkdirSync(dir, { recursive: true });
  if (existsSync(p.sig)) copyFileSync(p.sig, join(dir, `${entry.id}.psig`));
  fault('after-snapshot');
  return { before: sha256(p.sig) };
}

/**
 * @param {ApprovalProject & Pick<Project, 'config'>} P
 * @param {EntryPaths} entry
 * @param {RecordOptions} options
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

/**
 * A file's bytes at a git revision, or null. Works from the file's own folder (any repo root).
 * @param {string} file
 * @param {string} rev
 * @returns {Buffer | null}
 */
export function gitShow(file, rev) {
  const r = spawnSync('git', ['-C', dirname(file), 'show', `${rev}:./${basename(file)}`], {
    maxBuffer: 256 * 1024 * 1024,
  });
  // No `encoding`: Node returns stdout as a Buffer.
  return r.status === 0 ? /** @type {Buffer} */ (r.stdout) : null;
}
