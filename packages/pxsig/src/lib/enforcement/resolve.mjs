/** Each gate's setting for a run, and what a run exits with (enforcement.mjs). */
import { humanAtTerminal, whyNotPerson } from '../term.mjs';
/** @import { Config, Flags } from '../../types.js' */
/** @import { Enforcement, EnforcementOptions, EnforcementProject, Finding, GateName, GateSetting, Outcome } from '../../types/t2.js' */

/** @type {GateName[]} */
export const GATES = ['visual', 'a11y', 'verify', 'env', 'doctor', 'stale'];
export const DAY = 86_400_000;
/** The layers that count as "configured": reviewed config, or a person's `--warn` for this run. */
export const CONFIGURED = new Set(['project config', 'workspace defaults', '--warn']);

export class EnforcementError extends Error {
  /**
   * @param {string} message
   * @param {number} [exit] the process exit code: 2 a setup error, 3 a person-only refusal
   */
  constructor(message, exit = 2) {
    super(message);
    this.exit = exit;
  }
}

/**
 * Validate a merged `enforcement` object; throws with the problem (a setup error at load).
 * @param {{ default?: unknown, gates?: unknown, warnUntil?: unknown, noticeDays?: unknown, advisoryExit?: unknown } | null | undefined} e
 *   the config as read: any value, checked here
 * @param {string} [where]
 */
export function checkEnforcementConfig(e, where = 'enforcement') {
  if (e == null) return;
  /** @type {(m: string) => never} */
  const bad = (m) => {
    throw new EnforcementError(`${where}: ${m}`);
  };
  if (typeof e !== 'object' || Array.isArray(e)) bad('must be an object');
  for (const k of Object.keys(e))
    if (!['default', 'gates', 'warnUntil', 'noticeDays', 'advisoryExit'].includes(k))
      bad(`unknown key "${k}" (default, gates, warnUntil, noticeDays, advisoryExit)`);
  if (e.default != null && !(/** @type {unknown[]} */ (['enforce', 'warn']).includes(e.default)))
    bad(`default must be "enforce" or "warn"`);
  if (e.gates != null) {
    if (typeof e.gates !== 'object' || Array.isArray(e.gates))
      bad('gates must map a gate to enforce or warn');
    // An object: checked just above.
    for (const [g, v] of Object.entries(/** @type {Record<string, unknown>} */ (e.gates))) {
      if (!(/** @type {string[]} */ (GATES).includes(g)))
        bad(`unknown gate "${g}" (gates: ${GATES.join(', ')})`);
      const ok = g === 'a11y' ? ['enforce', 'warn', 'off'] : ['enforce', 'warn'];
      if (!(/** @type {unknown[]} */ (ok).includes(v)))
        bad(`gates.${g} must be ${ok.map((x) => `"${x}"`).join(' or ')}`);
    }
  }
  if (
    e.warnUntil != null &&
    (typeof e.warnUntil !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.warnUntil) ||
      Number.isNaN(Date.parse(`${e.warnUntil}T00:00:00Z`)))
  )
    bad('warnUntil must be a date, YYYY-MM-DD');
  // `Number.isInteger` is true only for a number.
  if (
    e.noticeDays != null &&
    !(Number.isInteger(e.noticeDays) && /** @type {number} */ (e.noticeDays) >= 0)
  )
    bad('noticeDays must be a whole number of days, 0 or more');
  if (
    e.advisoryExit != null &&
    !(
      Number.isInteger(e.advisoryExit) &&
      (e.advisoryExit === 0 ||
        (/** @type {number} */ (e.advisoryExit) >= 10 &&
          /** @type {number} */ (e.advisoryExit) <= 125))
    )
  )
    bad(
      'advisoryExit must be 0, or 10 to 125 (1, 2 and 3 already mean something, and higher codes are signals)'
    );
}

/**
 * `--warn` / `--enforce` → the gates they name: `true` (no value) is every gate.
 * @param {Flags[string]} v
 * @param {string} name
 * @returns {string[] | null}
 */
function flagGates(v, name) {
  if (v == null || v === false) return null;
  const list =
    v === true
      ? GATES
      : String(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
  for (const g of list)
    if (!(/** @type {string[]} */ (GATES).includes(g)))
      throw new EnforcementError(`--${name}: unknown gate "${g}" (gates: ${GATES.join(', ')})`);
  return list;
}

/**
 * Each gate's setting for this run, and the layer that decided it.
 * `P` is an opened project (`config.enforcement`, `configSources`). Throws an `EnforcementError`
 * (exit 3 for `--warn` without a person, 2 for anything else not allowed).
 * @param {EnforcementProject} P
 * @param {EnforcementOptions} [options]
 * @returns {Enforcement}
 */
export function resolveEnforcement(
  P,
  {
    flags = {},
    env = process.env,
    human = () => humanAtTerminal(),
    why = () => whyNotPerson(),
    now = new Date(),
  } = {}
) {
  /** @type {NonNullable<Config['enforcement']>} */
  const e = P.config?.enforcement ?? {};
  const src = P.configSources ?? {};
  const present = P.config?.enforcement != null;
  const def = e.default ?? 'enforce';
  /** @type {Record<string, GateSetting>} */
  const gates = {};
  /** @type {Record<string, string>} */
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
  /** @type {string[]} */
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
    if (!human())
      throw new EnforcementError(
        `warn mode for this run needs a person at a terminal (${why()}); set it in pxsig.config.json ("enforcement") instead`,
        3
      );
    for (const g of lower) {
      gates[g] = 'warn';
      layers[g] = '--warn';
    }
  }
  // Raising always wins: --enforce, PXSIG_ENFORCEMENT=enforce.
  const pe = env.PXSIG_ENFORCEMENT;
  if (pe != null && pe !== '') {
    if (pe === 'warn')
      throw new EnforcementError(
        'PXSIG_ENFORCEMENT=warn is refused: warn comes from committed config ("enforcement" in pxsig.config.json) or --warn at a terminal; the variable can only make a run stricter (PXSIG_ENFORCEMENT=enforce)'
      );
    if (pe !== 'enforce')
      throw new EnforcementError(`PXSIG_ENFORCEMENT takes "enforce"; got "${pe}"`);
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
 * @param {Pick<Enforcement, 'gates' | 'configured' | 'advisoryExit'>} enf
 * @param {readonly Finding[]} found
 * @returns {Outcome}
 */
export function outcome(enf, found) {
  const failing = found.filter((f) => f.exit > 0 && !(f.gate && enf.gates[f.gate] === 'off'));
  const wouldExit = Math.max(0, ...failing.map((f) => f.exit));
  const enforced = failing.filter((f) => !f.gate || enf.gates[f.gate] === 'enforce');
  const advisory = failing.filter((f) => f.gate && enf.gates[f.gate] === 'warn');
  // A quiet built-in gate (a11y) that would fail exits 0 (decision 88); advisoryExit is for the
  // gates a team chose to warn.
  const exit = enforced.length
    ? Math.max(...enforced.map((f) => f.exit))
    : // An advisory finding has a gate: `f.gate &&` above.
      advisory.some((f) => enf.configured.includes(/** @type {string} */ (f.gate)))
      ? enf.advisoryExit
      : 0;
  // `filter(Boolean)` leaves the named gates.
  const ran = [...new Set(/** @type {string[]} */ (found.map((f) => f.gate).filter(Boolean)))];
  return {
    exit,
    wouldExit,
    wouldFail: wouldExit > 0,
    advisory: !enforced.length && advisory.length > 0,
    reasons: advisory.map(({ gate, count, what }) => ({ gate, count, what })),
    enforcedFailures: enforced.map(({ gate, count, what }) => ({ gate, count, what })),
    warnedFailing: [...new Set(advisory.map((f) => /** @type {string} */ (f.gate)))],
    ran,
  };
}
