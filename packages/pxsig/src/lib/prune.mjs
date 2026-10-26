/**
 * prune.mjs — `pxsig a11y --prune`: accepted axe rules that no longer fire, taken off a11y.json.
 *
 * `a11y.json` keeps, per entry, the axe rules a person accepted. A rule fixed since stays on the
 * list until someone takes it off, and would hide the same violation if it came back. The plan
 * classifies every accepted rule; only `prunable` ones are ever removed:
 *
 *   prunable     a row for the entry (check.json or any check-<suite>.json) where axe ran with no
 *                render error, checked after the entry's last accessibility decision and its last
 *                approval, not stale (the test `pxsig stale` uses), and the rule is not among its
 *                violations (PHASE-1 §5, evidence rules 1–4; no age limit, decision 5.3)
 *   still-fires  that row lists the rule
 *   stale        the row is older than a decision, an approval or an edit that can change it
 *   not-covered  no row where axe ran (never checked, `--no-a11y`, a render or axe error)
 *
 * Applying a plan (a person at a terminal, through `pxsig serve` when it holds the store, else
 * under the store lock) removes the prunable rules, writes one `action: "prune"` line per entry to
 * a11y-decisions.ndjson, and updates the report rows' accepted lists. It is pinned to the sha256 of
 * a11y.json at planning time: any decision in between refuses the whole plan.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readLog, sha256, stamp, who } from './approvals.mjs';
import { appendLine, readLines, writeJson } from './files.mjs';
import { relPath } from './paths.mjs';

export const CLASSES = ['prunable', 'still-fires', 'stale', 'not-covered'];
export const PRUNE_RULE = /^[\w.-]{1,80}$/;
export const PRUNE_ID = /^[a-z0-9-]+--[a-z0-9-]+(__[a-z0-9-]+)?(@[a-z0-9-]+)?$/;

const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

export const decisionsPath = (P) => join(dirname(P.store.a11y), 'a11y-decisions.ndjson');

/** The check reports: check.json (suite null) and each check-<suite>.json, with their rows. */
export function readReports(P) {
  const out = [];
  const dir = P.store.reports;
  const main = join(dir, 'check.json');
  if (existsSync(main)) out.push({ suite: null, path: main });
  if (existsSync(dir))
    for (const name of readdirSync(dir).sort()) {
      const m = name.match(/^check-(.+)\.json$/);
      if (m) out.push({ suite: m[1], path: join(dir, name) });
    }
  return out
    .map((r) => ({ ...r, file: relPath(P.workspaceRoot, r.path), check: readJson(r.path, null) }))
    .filter((r) => Array.isArray(r.check?.rows));
}

/** id → the time of its latest line in a log (`actions`: only those actions), as milliseconds. */
function latestBy(lines, actions = null) {
  const out = new Map();
  for (const l of lines) {
    if (typeof l?.id !== 'string' || (actions && !actions.has(l.action))) continue;
    const t = Date.parse(l.at);
    if (Number.isFinite(t) && t > (out.get(l.id) ?? -Infinity)) out.set(l.id, t);
  }
  return out;
}

/** The last accept, unaccept, undo or prune of each entry (a11y-decisions.ndjson). */
export const decisionTimes = (P) => latestBy(readLines(decisionsPath(P)).lines, new Set(['accept', 'unaccept', 'undo', 'prune']));
/** The last approval-log line of each entry (approve, undo, adopt, check --update: each rewrites its accepted list). */
export const approvalTimes = (P) => latestBy(readLog(P));

/** Why a row says nothing about the rules, or null when axe ran on it. */
function notCovered(row) {
  if (row.skipped) return 'left out of its last run';
  if (row.error) return 'its render failed';
  if (row.a11y?.error) return `axe failed: ${String(row.a11y.error).slice(0, 120)}`;
  if (!Array.isArray(row.a11y?.violations)) return 'axe did not run on it';
  return null;
}

const iso = (t) => new Date(t).toISOString();

/**
 * Classify every accepted rule. `stale(report)` → `{ ids: Map id → why, unknown: why | null }` for
 * that report's rows (unknown: staleness could not be traced, so every row of it counts as stale).
 * Filters: `only` (ids), `component` (id substring), `mode`.
 */
export function classify({ accepted, reports, decided, approved, stale, modeOf = () => null, only = null, component = null, mode = null }) {
  const items = [];
  const rowsById = new Map();
  for (const rep of reports)
    for (const row of rep.check.rows) {
      if (typeof row?.id !== 'string') continue;
      if (!rowsById.has(row.id)) rowsById.set(row.id, []);
      rowsById.get(row.id).push({ row, rep });
    }
  const staleOf = new Map(reports.map((rep) => [rep, stale(rep)]));
  for (const id of Object.keys(accepted).sort()) {
    const rules = accepted[id];
    if (!Array.isArray(rules) || !rules.length) continue;
    if (only?.length && !only.includes(id)) continue;
    if (component && !id.includes(String(component).toLowerCase())) continue;
    const candidates = rowsById.get(id) ?? [];
    const entryMode = modeOf(id) ?? candidates[0]?.row.mode ?? null;
    if (mode && entryMode !== mode) continue;
    const add = (cls, why, ev = {}) => {
      for (const rule of [...rules].sort()) items.push({ id, rule, class: cls, why, mode: entryMode, ...ev });
    };
    const usable = candidates.filter((c) => !notCovered(c.row));
    if (!usable.length) {
      add('not-covered', candidates.length ? notCovered(candidates[0].row) : 'no report has a row for it', { suite: candidates[0]?.rep.suite ?? null });
      continue;
    }
    const at = (c) => Date.parse(c.row.checkedAt ?? c.rep.check.generatedAt) || 0;
    const best = usable.reduce((a, b) => (at(b) > at(a) ? b : a));
    const checkedAt = at(best);
    const ev = { report: best.rep.file, checkedAt: checkedAt ? iso(checkedAt) : null, suite: best.rep.suite };
    const st = staleOf.get(best.rep);
    let why = null;
    if (!checkedAt) why = 'the row has no check time';
    else if ((decided.get(id) ?? -Infinity) >= checkedAt) why = `accessibility decision at ${iso(decided.get(id))}, after this check`;
    else if ((approved.get(id) ?? -Infinity) >= checkedAt) why = `approved at ${iso(approved.get(id))}, after this check`;
    else if (st.unknown) why = st.unknown;
    else if (st.ids.has(id)) why = `${st.ids.get(id)} changed after this check`;
    if (why) {
      add('stale', why, ev);
      continue;
    }
    const firing = new Set(best.row.a11y.violations.map((v) => v?.id ?? v));
    for (const rule of [...rules].sort())
      items.push(firing.has(rule) ? { id, rule, class: 'still-fires', why: 'still in its violations', mode: entryMode, ...ev } : { id, rule, class: 'prunable', why: 'not in its violations', mode: entryMode, ...ev });
  }
  return items;
}

/** What would make the rules that are not prunable decidable: one command per suite and class. */
export function coverCommands(items, cmd = 'pxsig') {
  const out = [];
  const group = (cls) => {
    const by = new Map();
    for (const x of items.filter((i) => i.class === cls)) {
      const k = x.suite ?? '';
      if (!by.has(k)) by.set(k, new Set());
      by.get(k).add(x.id);
    }
    return by;
  };
  for (const [suite, ids] of group('not-covered')) out.push({ class: 'not-covered', entries: ids.size, command: `${cmd} check --full${suite ? ` --suite ${suite}` : ''}` });
  for (const [suite, ids] of group('stale'))
    out.push({ class: 'stale', entries: ids.size, command: suite ? `${cmd} check --full --suite ${suite}` : ids.size <= 10 ? `${cmd} check ${[...ids].join(' ')}` : `${cmd} check --full` });
  return out;
}

/** The plan: every rule classified, the prunable ones grouped per entry, pinned to a11y.json. */
export function buildPlan(P, { stale, modeOf, only = null, component = null, mode = null, cmd = 'pxsig' }) {
  const accepted = readJson(P.store.a11y, {});
  const reports = readReports(P);
  const items = classify({ accepted, reports, decided: decisionTimes(P), approved: approvalTimes(P), stale, modeOf, only, component, mode });
  const counts = Object.fromEntries(CLASSES.map((c) => [c, items.filter((i) => i.class === c).length]));
  const byId = new Map();
  for (const x of items.filter((i) => i.class === 'prunable')) {
    if (!byId.has(x.id)) byId.set(x.id, { id: x.id, before: [...accepted[x.id]].sort(), rules: [], evidence: { report: x.report, checkedAt: x.checkedAt } });
    byId.get(x.id).rules.push(x.rule);
  }
  const prune = [...byId.values()].map((p) => ({ ...p, after: p.before.filter((r) => !p.rules.includes(r)) }));
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    project: P.name,
    a11y: relPath(P.workspaceRoot, P.store.a11y),
    a11ySha: sha256(P.store.a11y),
    reports: reports.map((r) => ({ file: r.file, suite: r.suite, rows: r.check.rows.length })),
    counts,
    entries: new Set(items.map((i) => i.id)).size,
    prune,
    items,
    cover: coverCommands(items, cmd),
  };
}

/** The phrase a person types to remove `n` rules. */
export const prunePhrase = (n) => `PRUNE ${n} RULES`;

/** Ask for the phrase (`ask` prints a question, resolves with the typed line); true only on an exact match. */
export async function confirmPrune(plan, ask) {
  const n = plan.prune.reduce((k, p) => k + p.rules.length, 0);
  const phrase = prunePhrase(n);
  return (await ask(`Remove ${n} accepted rules from ${plan.prune.length} entries' lists (each logged in a11y-decisions.ndjson). Type "${phrase}" to continue: `)) === phrase;
}

/** Check a plan's shape before applying it (a plan the server receives is the CLI's). */
export function checkPlan(plan) {
  if (!plan || typeof plan !== 'object') return 'no plan';
  if (plan.a11ySha !== null && !/^[0-9a-f]{64}$/.test(String(plan.a11ySha))) return 'bad a11ySha';
  if (!Array.isArray(plan.prune) || !plan.prune.length) return 'nothing to prune';
  for (const p of plan.prune) {
    if (!PRUNE_ID.test(String(p?.id))) return `bad id ${String(p?.id).slice(0, 80)}`;
    if (!Array.isArray(p.rules) || !p.rules.length || !p.rules.every((r) => PRUNE_RULE.test(String(r)))) return `bad rules for ${p.id}`;
  }
  return null;
}

/**
 * Remove a plan's prunable rules. Refuses the whole plan (status 409) when a11y.json changed since
 * it was made. `lockCheck` runs before the writes (fencing: a lock taken over writes nothing).
 * Returns `{ batch, entries, rules, lines }`.
 */
export function applyPrune(P, plan, { batch, reason = null, via = 'cli', lockCheck = () => {} } = {}) {
  const bad = checkPlan(plan);
  if (bad) throw Object.assign(new Error(`a11y --prune: ${bad}`), { status: 400 });
  if (sha256(P.store.a11y) !== plan.a11ySha) throw Object.assign(new Error(`${relPath(P.workspaceRoot, P.store.a11y)} changed since this plan (a decision was made): run the prune again`), { status: 409 });
  const base = readJson(P.store.a11y, {});
  const at = new Date().toISOString();
  const by = who(P.workspaceRoot, P.config);
  const lines = [];
  for (const p of plan.prune) {
    const before = Array.isArray(base[p.id]) ? base[p.id] : [];
    const rules = p.rules.filter((r) => before.includes(r));
    if (!rules.length) continue;
    const after = before.filter((r) => !rules.includes(r));
    base[p.id] = after;
    lines.push({ at, by, via, action: 'prune', id: p.id, before, after, rules, batch, reason, evidence: { report: p.evidence?.report ?? null, checkedAt: p.evidence?.checkedAt ?? null } });
  }
  if (!lines.length) return { batch, entries: 0, rules: 0, lines };
  lockCheck();
  writeJson(P.store.a11y, base, { pretty: true });
  for (const l of lines) appendLine(decisionsPath(P), stamp(l));
  // The report rows carry each entry's accepted list: keep them in step (as unaccept does).
  const now = new Map(lines.map((l) => [l.id, l.after]));
  for (const rep of readReports(P)) {
    let touched = false;
    rep.check.rows = rep.check.rows.map((r) => {
      if (!now.has(r.id) || !Array.isArray(r.a11y?.violations)) return r;
      touched = true;
      const after = now.get(r.id);
      return { ...r, a11y: { ...r.a11y, baseline: after, new: r.a11y.violations.filter((v) => !after.includes(v?.id ?? v)).length } };
    });
    if (touched) writeJson(rep.path, rep.check);
  }
  return { batch, entries: lines.length, rules: lines.reduce((n, l) => n + l.rules.length, 0), lines };
}
