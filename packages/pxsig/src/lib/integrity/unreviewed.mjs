/**
 * integrity/unreviewed.mjs — baselines no person approved, told from the approval log, never guessed
 * (docs/integrity.md, "Unreviewed baselines").
 *
 * Reviewed: a line of approvals.ndjson for the entry, made by a person, logged exactly the bytes
 * the baseline holds now (its `after` is the file's sha256). A person's line came through the
 * dashboard or the CLI (`PERSON_VIA`), carries no assistant marker (`agent`) and is not an undo.
 * Anything else is unreviewed: written by `pxsig migrate`, `approve verify --adopt`,
 * `check --update` or an assistant; logged by no line at all; or bytes no line logged (changed
 * outside pxsig). An undo back to bytes a person approved is reviewed again.
 *
 * The ratchet needs no file of its own. An unreviewed baseline whose bytes were written before
 * RATCHET_VERSION (its line's `pxsig` older, or no line for the entry at all) is in the **queue**,
 * which only shrinks: no newer pxsig can add to it. One written by RATCHET_VERSION or later, or
 * bytes no line logged for an entry that has lines, is **new**: growth past the ratchet, named
 * in a setup problem (`unreviewed-new`, warn). Nothing fails. A flag, not a status: an entry keeps
 * its status and issues, and carries `unreviewed` beside them.
 *
 * The queue's order (badge RCA, owner decision 4): the components an adapter uses first, then the
 * most used, then the rest. Only the project knows those, so `approvals.reviewOrder` may name a
 * workspace-relative JSON file `{ "first": [component, …], "usage": { component: count } }`. A
 * component matches by its ledger name or that name's last segment (`components/Badge` → Badge).
 * Without the file, by name.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERSON_VIA, sha256 } from '../approvals/core.mjs';
import { readJson, readLines } from '../files.mjs';
import { componentOf } from './stories.mjs';
/** @import { ApprovalLine } from '../../types.js' */
/** @import { Ledger, LedgerEntry, LedgerSetup } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

/** The release the ratchet starts at: unreviewed bytes written from it on are growth. */
export const RATCHET_VERSION = '0.7.7';
/** How many of the queue the summary names. */
export const QUEUE_SHOWN = 10;

/** @param {string | undefined} v @returns {number[]} */
const parts = (v) =>
  String(v ?? '0')
    .split('-')[0]
    .split('.')
    .map((n) => Number(n) || 0);
/**
 * Whether version `v` is `min` or later (a pre-release of `min` counts as `min`).
 * @param {string | undefined} v
 * @param {string} min
 */
export function atLeast(v, min) {
  const a = parts(v);
  const b = parts(min);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** Whether a log line is a person's decision. @param {ApprovalLine} l */
export const byPerson = (l) => PERSON_VIA.has(l.via) && !l.agent && !l.undo;

/**
 * An entry's review state from its log lines and its baseline's current hash.
 * @param {ApprovalLine[]} lines the entry's lines, oldest first
 * @param {string} hash
 * @returns {{ reviewed: true } | { reviewed: false, new: boolean, by: string }}
 *   `by`: what wrote the bytes (the line's `via`, `assistant`, `unlogged` or `outside pxsig`)
 */
export function reviewState(lines, hash) {
  if (lines.some((l) => l.after === hash && byPerson(l))) return { reviewed: true };
  const wrote = lines.filter((l) => l.after === hash).pop();
  if (wrote)
    return {
      reviewed: false,
      new: atLeast(wrote.pxsig, RATCHET_VERSION),
      by: wrote.agent ? 'assistant' : wrote.via,
    };
  return lines.length
    ? { reviewed: false, new: true, by: 'outside pxsig' }
    : { reviewed: false, new: false, by: 'unlogged' };
}

/** @type {Map<string, { key: string, hash: string | null }>} */
const hashes = new Map();
/** A file's sha256, cached by its size and mtime. @param {string} file */
function hashOf(file) {
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st) return null;
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = hashes.get(file);
  if (hit?.key === key) return hit.hash;
  const hash = sha256(file);
  hashes.set(file, { key, hash });
  return hash;
}

/**
 * The queue's order: `approvals.reviewOrder`'s file, when the project names one.
 * @param {IntegrityContext} ctx
 * @returns {{ rank: (component: string) => [number, number], source: 'file' | 'name', problem?: string }}
 */
export function reviewOrder(ctx) {
  const rel = ctx.config.approvals?.reviewOrder;
  const byName = {
    rank: () => /** @type {[number, number]} */ ([0, 0]),
    source: /** @type {const} */ ('name'),
  };
  if (!rel) return byName;
  const file = resolve(ctx.repoRoot, rel);
  /** @type {unknown} */
  let read = null;
  try {
    // A JSON file the project wrote: its two keys are checked below.
    if (existsSync(file)) read = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    read = null;
  }
  if (!read || typeof read !== 'object')
    return { ...byName, problem: `approvals.reviewOrder: ${rel} is missing or not JSON` };
  const data = /** @type {{ first?: unknown, usage?: unknown }} */ (read);
  const first = Array.isArray(data.first) ? data.first.map(String) : [];
  const usage = /** @type {Record<string, number>} */ (
    data.usage && typeof data.usage === 'object' ? data.usage : {}
  );
  /** @param {string} c */
  const keys = (c) => [c, c.split('/').pop() ?? c];
  return {
    source: 'file',
    rank: (c) => {
      const k = keys(c);
      const i = first.findIndex((f) => k.includes(f));
      const used = Math.max(0, ...k.map((x) => Number(usage[x]) || 0));
      return [i >= 0 ? i : first.length, -used];
    },
  };
}

/**
 * The ledger with every unreviewed baseline flagged: `unreviewed` on its entry (`queue`: its place,
 * or `new: true`) and the count on its component, `summary.unreviewed`, and the `unreviewed-new`
 * setup problem when the queue grew. Writes nothing.
 * @param {Ledger} ledger
 * @param {IntegrityContext} ctx
 * @returns {Ledger}
 */
export function withReview(ledger, ctx) {
  const { lines } = /** @type {{ lines: ApprovalLine[] }} */ (readLines(ctx.files.approvals));
  /** @type {Map<string, ApprovalLine[]>} */
  const byId = new Map();
  for (const l of lines) byId.set(l.id, [...(byId.get(l.id) ?? []), l]);
  /** @type {{ entry: LedgerEntry, state: { new: boolean, by: string } }[]} */
  const flagged = [];
  for (const e of ledger.entries) {
    if (!e.files?.sigExists || e.status === 'excluded') continue;
    const hash = hashOf(resolve(ctx.repoRoot, e.files.sig));
    if (!hash) continue;
    const state = reviewState(byId.get(e.id) ?? [], hash);
    if (!state.reviewed) flagged.push({ entry: e, state });
  }
  const order = reviewOrder(ctx);
  const queue = flagged
    .filter((f) => !f.state.new)
    .map((f) => f.entry)
    .sort((a, b) => {
      const [ra, ua] = order.rank(a.component);
      const [rb, ub] = order.rank(b.component);
      return (
        ra - rb || ua - ub || a.component.localeCompare(b.component) || a.id.localeCompare(b.id)
      );
    });
  const place = new Map(queue.map((e, i) => [e.id, i + 1]));
  const grown = flagged.filter((f) => f.state.new);
  for (const { entry, state } of flagged) {
    const at = place.get(entry.id);
    entry.unreviewed = at != null ? { queue: at, by: state.by } : { new: true, by: state.by };
  }
  /** @type {Map<string, number>} */
  const perComponent = new Map();
  for (const { entry } of flagged)
    perComponent.set(entry.component, (perComponent.get(entry.component) ?? 0) + 1);
  const components = ledger.components.map((c) =>
    perComponent.has(c.component) ? { ...c, unreviewed: perComponent.get(c.component) } : c
  );
  /** @type {LedgerSetup[]} */
  const setup = [];
  if (grown.length)
    setup.push({
      code: 'unreviewed-new',
      severity: ctx.integrity.severity['unreviewed-new'] ?? 'warn',
      count: grown.length,
      reason: `${grown.length} baseline${grown.length === 1 ? '' : 's'} no person approved, written since the review queue was closed (${grown
        .slice(0, 3)
        .map((f) => `${f.entry.id}, by ${f.state.by}`)
        .join(
          '; '
        )}${grown.length > 3 ? '; …' : ''}): approve each in the dashboard after looking at it`,
    });
  if (order.problem) setup.push({ code: 'review-order', severity: 'warn', reason: order.problem });
  return {
    ...ledger,
    components,
    setup: [...ledger.setup, ...setup],
    summary: {
      ...ledger.summary,
      unreviewed: {
        count: flagged.length,
        queue: queue.length,
        new: grown.length,
        order: order.source,
        next: queue.slice(0, QUEUE_SHOWN).map((e) => e.id),
      },
    },
  };
}

/**
 * `summary.unreviewed` without the rest of the ledger: the manifest's entries, each with its
 * baseline, flagged as `withReview` flags them (for `pxsig status` and `pxsig_status`, which do not
 * reconcile). Entries in a `nonVisual` folder are left out, as the ledger leaves them out.
 * @param {IntegrityContext} ctx
 */
export function unreviewedSummary(ctx) {
  const manifest =
    /** @type {{ stories?: { id: string, story?: string, sig: string, importPath?: string }[] } | null} */ (
      readJson(ctx.manifestPath, null)
    );
  const nonVisual = new Set(ctx.config.nonVisual ?? []);
  const entries = /** @type {LedgerEntry[]} */ (
    (manifest?.stories ?? [])
      .map((e) => ({
        id: e.id,
        component: componentOf(ctx, e.importPath, e.story ?? null) ?? '(unscoped)',
        status: 'ok',
        files: { sig: e.sig, sigExists: existsSync(resolve(ctx.repoRoot, e.sig)) },
      }))
      .filter((e) => !nonVisual.has(e.component.split('/')[0]))
  );
  const L = /** @type {Ledger} */ (
    /** @type {unknown} */ ({ entries, components: [], setup: [], summary: {} })
  );
  return withReview(L, ctx).summary.unreviewed ?? null;
}
