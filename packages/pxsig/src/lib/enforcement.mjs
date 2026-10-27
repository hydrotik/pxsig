/**
 * enforcement.mjs — warn mode: a per-gate choice between `enforce` (today) and `warn`.
 *
 * A gate in `warn` runs exactly the same checks on exactly the same selection; only the exit code
 * changes (to `advisoryExit`, default 0, where that gate alone would have failed) and every surface
 * says so: an ADVISORY lead and last line on the CLI, a lead block in `summary.md`, `enforcement` in
 * `check.json`, setup codes in `pxsig doctor` and the dashboard banner, MCP fields. Warn is never a
 * pass, and never narrows a selection.
 *
 *   visual   check rows not passing (changed, new, render error)
 *   a11y     new axe violations against a11y.json: `warn` by default, quiet unless one appears
 *            (decision 88); `off` restores the output from before the gate existed
 *   verify   `approve verify`: only baselines with no log line (a mismatch or a rewritten log is
 *            never warned, decision 10.4)
 *   env      `--strict-env`'s refusal: under warn the check renders and lists the mismatches
 *   doctor   findings at or above `--fail-on`
 *   stale    stale or inconsistent rows
 *
 * Setup errors (exit 2) and person-only refusals (exit 3) are never warned (decision 10.2).
 *
 * Who can lower a gate to `warn` (decision 10.3): the committed config (`pxsig.config.json`, the
 * workspace file's `defaults`), or a person at a terminal with `--warn` for one run. Anything can
 * raise one to `enforce`: `--enforce`, `PXSIG_ENFORCEMENT=enforce`. CI variables, assistants and MCP
 * tools can only make a run stricter.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoStateDir } from './machine.mjs';
import { spawnSync } from './spawn.mjs';
import { humanAtTerminal, whyNotPerson } from './term.mjs';

export const GATES = ['visual', 'a11y', 'verify', 'env', 'doctor', 'stale'];
const DAY = 86_400_000;
/** The layers that count as "configured": reviewed config, or a person's `--warn` for this run. */
const CONFIGURED = new Set(['project config', 'workspace defaults', '--warn']);
const LAYER_LABEL = { 'project config': 'pxsig.config.json', 'workspace defaults': 'the workspace defaults', '--warn': '--warn at this terminal', 'built-in': 'built-in default' };

export class EnforcementError extends Error {
  constructor(message, exit = 2) {
    super(message);
    this.exit = exit;
  }
}

/** Validate a merged `enforcement` object; throws with the problem (a setup error at load). */
export function checkEnforcementConfig(e, where = 'enforcement') {
  if (e == null) return;
  const bad = (m) => {
    throw new EnforcementError(`${where}: ${m}`);
  };
  if (typeof e !== 'object' || Array.isArray(e)) bad('must be an object');
  for (const k of Object.keys(e)) if (!['default', 'gates', 'warnUntil', 'noticeDays', 'advisoryExit'].includes(k)) bad(`unknown key "${k}" (default, gates, warnUntil, noticeDays, advisoryExit)`);
  if (e.default != null && !['enforce', 'warn'].includes(e.default)) bad(`default must be "enforce" or "warn"`);
  if (e.gates != null) {
    if (typeof e.gates !== 'object' || Array.isArray(e.gates)) bad('gates must map a gate to enforce or warn');
    for (const [g, v] of Object.entries(e.gates)) {
      if (!GATES.includes(g)) bad(`unknown gate "${g}" (gates: ${GATES.join(', ')})`);
      const ok = g === 'a11y' ? ['enforce', 'warn', 'off'] : ['enforce', 'warn'];
      if (!ok.includes(v)) bad(`gates.${g} must be ${ok.map((x) => `"${x}"`).join(' or ')}`);
    }
  }
  if (e.warnUntil != null && (typeof e.warnUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.warnUntil) || Number.isNaN(Date.parse(`${e.warnUntil}T00:00:00Z`)))) bad('warnUntil must be a date, YYYY-MM-DD');
  if (e.noticeDays != null && !(Number.isInteger(e.noticeDays) && e.noticeDays >= 0)) bad('noticeDays must be a whole number of days, 0 or more');
  if (e.advisoryExit != null && !(Number.isInteger(e.advisoryExit) && (e.advisoryExit === 0 || (e.advisoryExit >= 10 && e.advisoryExit <= 125))))
    bad('advisoryExit must be 0, or 10 to 125 (1, 2 and 3 already mean something, and higher codes are signals)');
}

/** `--warn` / `--enforce` → the gates they name: `true` (no value) is every gate. */
function flagGates(v, name) {
  if (v == null || v === false) return null;
  const list = v === true ? GATES : String(v).split(',').map((s) => s.trim()).filter(Boolean);
  for (const g of list) if (!GATES.includes(g)) throw new EnforcementError(`--${name}: unknown gate "${g}" (gates: ${GATES.join(', ')})`);
  return list;
}

/**
 * Each gate's setting for this run, and the layer that decided it.
 * `P` is an opened project (`config.enforcement`, `configSources`). Throws an `EnforcementError`
 * (exit 3 for `--warn` without a person, 2 for anything else not allowed).
 */
export function resolveEnforcement(P, { flags = {}, env = process.env, human = () => humanAtTerminal(), why = () => whyNotPerson(), now = new Date() } = {}) {
  const e = P.config?.enforcement ?? {};
  const src = P.configSources ?? {};
  const present = P.config?.enforcement != null;
  const def = e.default ?? 'enforce';
  const gates = {};
  const layers = {};
  for (const g of GATES) {
    if (e.gates?.[g] != null) {
      gates[g] = e.gates[g];
      layers[g] = src[`enforcement.gates.${g}`] ?? 'project config';
    } else if (e.default != null && g !== 'a11y') {
      // `default` covers every gate but a11y, which keeps its own built-in default (decision 10.1).
      gates[g] = def;
      layers[g] = src['enforcement.default'] ?? 'project config';
    } else {
      // The built-in defaults: every gate enforced, the a11y gate on warn (decision 10.1).
      gates[g] = g === 'a11y' ? 'warn' : 'enforce';
      layers[g] = 'built-in';
    }
  }
  // warnUntil: the committed promise ends warn for the configured gates (decision 10.6 (a)).
  const warnUntil = e.warnUntil ?? null;
  const noticeDays = e.noticeDays ?? 14;
  const advisoryExit = e.advisoryExit ?? 0;
  const end = warnUntil ? Date.parse(`${warnUntil}T23:59:59.999Z`) : null;
  const t = now.getTime();
  const expired = [];
  if (end != null && t > end)
    for (const g of GATES)
      if (gates[g] === 'warn' && CONFIGURED.has(layers[g])) {
        gates[g] = 'enforce';
        layers[g] = 'warnUntil';
        expired.push(g);
      }
  const daysLeft = end != null && t <= end ? Math.max(0, Math.ceil((end - t) / DAY)) : null;
  const daysSince = end != null && t > end ? Math.floor((t - end) / DAY) : null;
  // --warn: a person at a terminal may try warn for one local run (decision 10.3 (c)).
  const lower = flagGates(flags.warn, 'warn');
  if (lower) {
    if (!human()) throw new EnforcementError(`warn mode for this run needs a person at a terminal (${why()}); set it in pxsig.config.json ("enforcement") instead`, 3);
    for (const g of lower) {
      gates[g] = 'warn';
      layers[g] = '--warn';
    }
  }
  // Raising always wins: --enforce, PXSIG_ENFORCEMENT=enforce.
  const pe = env.PXSIG_ENFORCEMENT;
  if (pe != null && pe !== '') {
    if (pe === 'warn') throw new EnforcementError('PXSIG_ENFORCEMENT=warn is refused: warn comes from committed config ("enforcement" in pxsig.config.json) or --warn at a terminal; the variable can only make a run stricter (PXSIG_ENFORCEMENT=enforce)');
    if (pe !== 'enforce') throw new EnforcementError(`PXSIG_ENFORCEMENT takes "enforce"; got "${pe}"`);
    for (const g of GATES)
      if (gates[g] !== 'enforce') {
        gates[g] = 'enforce';
        layers[g] = 'PXSIG_ENFORCEMENT';
      }
  }
  const raise = flagGates(flags.enforce, 'enforce');
  for (const g of raise ?? [])
    if (gates[g] !== 'enforce') {
      gates[g] = 'enforce';
      layers[g] = '--enforce';
    }
  const warned = GATES.filter((g) => gates[g] === 'warn');
  const configured = warned.filter((g) => CONFIGURED.has(layers[g]));
  return {
    gates,
    layers,
    present,
    warnUntil,
    noticeDays,
    advisoryExit,
    daysLeft,
    daysSince,
    expired,
    /** Gates on warn because reviewed config (or a person's --warn) said so: these always speak. */
    configured,
    /** Gates on warn by the built-in default only (the a11y gate): quiet unless they would fail. */
    quiet: warned.filter((g) => layers[g] === 'built-in'),
    ending: configured.length > 0 && daysLeft != null && daysLeft <= noticeDays,
  };
}

/**
 * The run's exit from what each gate found. `found`: `[{ gate, exit, count, what }]`, one per gate
 * that would fail (exit > 0); `gate: null` marks a failure no setting can warn (a verify mismatch).
 * A failure in an enforced gate exits as today (the worst code wins); when every failure came from
 * warned gates, the run exits `advisoryExit`.
 */
export function outcome(enf, found) {
  const failing = found.filter((f) => f.exit > 0 && !(f.gate && enf.gates[f.gate] === 'off'));
  const wouldExit = Math.max(0, ...failing.map((f) => f.exit));
  const enforced = failing.filter((f) => !f.gate || enf.gates[f.gate] === 'enforce');
  const advisory = failing.filter((f) => f.gate && enf.gates[f.gate] === 'warn');
  // A quiet built-in gate (a11y) that would fail exits 0 (decision 88); advisoryExit is for the
  // gates a team chose to warn.
  const exit = enforced.length ? Math.max(...enforced.map((f) => f.exit)) : advisory.some((f) => enf.configured.includes(f.gate)) ? enf.advisoryExit : 0;
  const ran = [...new Set(found.map((f) => f.gate).filter(Boolean))];
  return {
    exit,
    wouldExit,
    wouldFail: wouldExit > 0,
    advisory: !enforced.length && advisory.length > 0,
    reasons: advisory.map(({ gate, count, what }) => ({ gate, count, what })),
    enforcedFailures: enforced.map(({ gate, count, what }) => ({ gate, count, what })),
    warnedFailing: [...new Set(advisory.map((f) => f.gate))],
    ran,
  };
}

/** Whether this run says anything about warn mode: configured warn, or a quiet gate that would fail. */
export const speaks = (enf, out = null) => enf.configured.length > 0 || enf.expired.length > 0 || Boolean(out?.warnedFailing?.some((g) => enf.quiet.includes(g)));

/** The gates a lead line names, with where they came from. */
function warnedText(enf, gates = enf.configured) {
  const from = [...new Set(gates.map((g) => LAYER_LABEL[enf.layers[g]] ?? enf.layers[g]))].join(', ');
  const until = enf.warnUntil && gates.some((g) => CONFIGURED.has(enf.layers[g]) && enf.layers[g] !== '--warn') ? `; until ${enf.warnUntil}${enf.ending ? `, enforced in ${enf.daysLeft} day${enf.daysLeft === 1 ? '' : 's'}` : ''}` : '';
  return `${gates.join(', ')} (${from}${until})`;
}

/** The first line of a gated command under configured warn, or null. */
export function leadLine(enf) {
  if (!enf.configured.length) return enf.expired.length ? `ADVISORY: warn mode ended on ${enf.warnUntil}; ${enf.expired.join(', ')} ${enf.expired.length === 1 ? 'is' : 'are'} enforced again.` : null;
  const exit = enf.advisoryExit ? `a failure in ${enf.configured.length === 1 ? 'it' : 'them'} exits ${enf.advisoryExit}` : 'the exit stays 0';
  return `ADVISORY: warn mode for ${warnedText(enf)}. Failures are reported; ${exit}.`;
}

/** The last line: what would have happened, and the readiness tally when there is one. */
export function lastLine(enf, out, tally = null) {
  if (!speaks(enf, out)) return null;
  const counts = out.reasons.map((r) => `${r.count} ${r.what}`).join(', ');
  const t = tally?.runs ? ` Would-fail runs: ${tally.wouldFail} of ${tally.runs}${tally.main ? ` (${tally.main.branch} ${tally.main.wouldFail} of ${tally.main.runs})` : ''}.` : '';
  if (out.advisory) return `ADVISORY: would have failed (exit ${out.wouldExit}): ${counts}. Not blocking.${t}`;
  if (out.reasons.length) return `ADVISORY: warned gates would also have failed: ${counts}.${t}`;
  return `ADVISORY: would have passed.${t}`;
}

/** The `enforcement` key of `check.json`, or null when nothing about warn mode applies. */
export function reportBlock(enf, out) {
  if (!speaks(enf, out)) return null;
  const enforce = out.ran.filter((g) => enf.gates[g] === 'enforce');
  const advisory = out.ran.filter((g) => enf.gates[g] === 'warn');
  return {
    gates: enf.gates,
    layers: enf.layers,
    warnUntil: enf.warnUntil,
    ...(enf.ending ? { daysLeft: enf.daysLeft } : {}),
    ...(enf.expired.length ? { expired: enf.expired } : {}),
    configured: enf.configured,
    wouldFail: out.wouldFail,
    wouldExit: out.wouldExit,
    exit: out.exit,
    reasons: out.reasons,
    // Per gate set (decision R1): the enforce context carries these gates, the advisory one those.
    contexts: { enforce, advisory },
  };
}

/** The enforcement row for `pxsig doctor` and `pxsig config`: "visual warn until … · others enforce". */
export function describeEnforcement(enf) {
  const parts = GATES.filter((g) => enf.gates[g] !== 'enforce').map((g) => `${g} ${enf.gates[g]}${enf.layers[g] === 'built-in' ? ' (default)' : enf.warnUntil && enf.configured.includes(g) && enf.layers[g] !== '--warn' ? ` until ${enf.warnUntil}` : ''}`);
  return parts.length ? `${parts.join(' · ')} · others enforce` : 'every gate enforced';
}

/**
 * Setup-level codes (never per entry, so story cards and `doctor`'s exit stay as they are):
 * `enforcement-warn` (info), `enforcement-ending` (warn, within noticeDays of warnUntil),
 * `enforcement-expired` (info, for noticeDays after). Built-in quiet gates produce none.
 */
export function enforcementProblems(enf, tally = null) {
  const out = [];
  const t = tally?.runs ? ` Would-fail runs: ${tally.wouldFail} of the last ${tally.runs}.` : '';
  if (enf.configured.length) out.push({ code: 'enforcement-warn', severity: 'info', reason: `warn mode for ${warnedText(enf)}: failures in ${enf.configured.length === 1 ? 'this gate are' : 'these gates are'} reported, not blocking.${t}` });
  if (enf.ending) out.push({ code: 'enforcement-ending', severity: 'warn', reason: `${enf.configured.join(', ')} ${enf.configured.length === 1 ? 'is' : 'are'} enforced from ${enf.warnUntil} (in ${enf.daysLeft} day${enf.daysLeft === 1 ? '' : 's'}).${t} Extend warnUntil in a pull request to keep warn mode` });
  if (enf.expired.length && enf.daysSince != null && enf.daysSince <= enf.noticeDays) out.push({ code: 'enforcement-expired', severity: 'info', reason: `${enf.expired.join(', ')} ${enf.expired.length === 1 ? 'has' : 'have'} been enforced since ${enf.warnUntil} (warnUntil passed): failures exit as they did before warn mode` });
  return out;
}

// --- the readiness tally (decision 10.7): one line per configured-warn run, outside the repository --------

const KEEP_LINES = 5000;
const KEEP_DAYS = 90;

/** `<stateDir>/readiness.ndjson` for this project's repository. */
export const readinessPath = (P, opts) => join(repoStateDir(P.workspaceRoot, opts), 'readiness.ndjson');

const gitOut = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/**
 * Append one readiness line, when a configured gate is on warn (never for the quiet built-in a11y
 * default, decision 88). Keeps the last 5,000 lines per project and gate set, and 90 days (R26).
 * A write failure is one warning on stderr and never changes the exit code.
 */
export function appendReadiness(P, enf, out, { source, suite = null, counts = {}, now = new Date(), opts } = {}) {
  if (!enf.configured.length) return null;
  const sha = gitOut(P.workspaceRoot, ['rev-parse', 'HEAD']);
  let branch = gitOut(P.workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') branch = null;
  const line = { at: now.toISOString(), project: P.name, suite, sha, branch, gates: enf.configured, wouldFail: out.wouldFail, wouldExit: out.wouldExit, counts, source };
  try {
    const path = readinessPath(P, opts);
    mkdirSync(join(path, '..'), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    trimReadiness(path, now);
    return line;
  } catch (e) {
    process.stderr.write(`[pxsig] warn mode: the readiness tally was not written (${e.message}); the run's result is unchanged\n`);
    return null;
  }
}

function readReadiness(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function trimReadiness(path, now) {
  const lines = readReadiness(path);
  const cutoff = now.getTime() - KEEP_DAYS * DAY;
  const fresh = lines.filter((l) => Date.parse(l.at) >= cutoff);
  const seen = new Map();
  const keep = [];
  for (let i = fresh.length - 1; i >= 0; i--) {
    const k = `${fresh[i].project}\n${[...(fresh[i].gates ?? [])].sort().join(',')}`;
    const n = seen.get(k) ?? 0;
    if (n >= KEEP_LINES) continue;
    seen.set(k, n + 1);
    keep.push(fresh[i]);
  }
  if (keep.length !== lines.length) writeFileSync(path, keep.reverse().map((l) => JSON.stringify(l)).join('\n') + (keep.length ? '\n' : ''));
}

/**
 * The tally for this project: runs and would-fail runs over the kept lines, and separately on the
 * default branch (`main` or `master`). Null when there are none.
 */
export function readinessTally(P, { opts, branchNames = ['main', 'master'] } = {}) {
  const lines = readReadiness(readinessPath(P, opts)).filter((l) => l.project === P.name);
  if (!lines.length) return null;
  const wf = (ls) => ls.filter((l) => l.wouldFail).length;
  const main = branchNames.map((b) => [b, lines.filter((l) => l.branch === b)]).find(([, ls]) => ls.length);
  return { runs: lines.length, wouldFail: wf(lines), ...(main ? { main: { branch: main[0], runs: main[1].length, wouldFail: wf(main[1]) } } : {}), last: lines.filter((l) => l.wouldFail).pop() ?? null };
}

/** For the CLIs: resolve, or print the refusal and exit with its code. */
export function resolveOrExit(P, opts, print = (m) => process.stderr.write(`pxsig: ${m}\n`)) {
  try {
    return resolveEnforcement(P, opts);
  } catch (e) {
    if (!(e instanceof EnforcementError)) throw e;
    print(e.message, e.exit);
    process.exit(e.exit);
  }
}

/** Combine several projects' exits: a real failure beats an advisory exit (worst code wins). */
export function combineExits(results) {
  const real = results.filter((r) => !r.advisory).map((r) => r.exit ?? 0);
  const worst = Math.max(0, ...real);
  if (worst > 0) return worst;
  return Math.max(0, ...results.filter((r) => r.advisory).map((r) => r.exit ?? 0));
}

/**
 * What a check's rows would fail on, per gate: the visual gate by kind (changed, new, render
 * errors), the a11y gate as the entries with new violations. Rows skipped or approved count for none.
 */
export function checkFindings(rows) {
  const checked = rows.filter((r) => !r.skipped);
  const failing = checked.filter((r) => !r.pass && !r.approved);
  const errors = failing.filter((r) => r.error).length;
  const fresh = failing.filter((r) => !r.error && r.new).length;
  const changed = failing.filter((r) => !r.error && !r.new).length;
  const found = [];
  if (changed) found.push({ gate: 'visual', exit: 1, count: changed, what: 'changed' });
  if (fresh) found.push({ gate: 'visual', exit: 1, count: fresh, what: 'new' });
  if (errors) found.push({ gate: 'visual', exit: 1, count: errors, what: errors === 1 ? 'render error' : 'render errors' });
  if (!found.length) found.push({ gate: 'visual', exit: 0, count: 0, what: 'changed' });
  const a11y = checked.filter((r) => (r.a11y?.new ?? 0) > 0).length;
  found.push({ gate: 'a11y', exit: a11y ? 1 : 0, count: a11y, what: a11y === 1 ? 'entry with new a11y violations' : 'entries with new a11y violations' });
  return found;
}

/** The readiness counts of a check (decision 10.7's fields). */
export function checkCounts(rows) {
  const by = (what) => checkFindings(rows).filter((f) => f.what.startsWith(what)).reduce((n, f) => n + f.count, 0);
  return { changed: by('changed'), new: by('new'), renderErrors: by('render error'), a11yNew: by('entr') };
}
