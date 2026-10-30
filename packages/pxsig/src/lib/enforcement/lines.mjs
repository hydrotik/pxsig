/** What warn mode says: lead and last lines, check.json's block, doctor's row (enforcement.mjs). */
import { CONFIGURED, GATES } from './resolve.mjs';
/** @import { SetupProblem } from '../../types.js' */
/** @import { Enforcement, EnforcementReport, Outcome, TallyCounts } from '../../types/t2.js' */

/** @type {Record<string, string>} */
const LAYER_LABEL = {
  'project config': 'pxsig.config.json',
  'workspace defaults': 'the workspace defaults',
  '--warn': '--warn at this terminal',
  'built-in': 'built-in default',
};

/**
 * Whether this run says anything about warn mode: configured warn, or a quiet gate that would fail.
 * @param {Pick<Enforcement, 'configured' | 'expired' | 'quiet'>} enf
 * @param {Pick<Outcome, 'warnedFailing'> | null} [out]
 */
export const speaks = (enf, out = null) =>
  enf.configured.length > 0 ||
  enf.expired.length > 0 ||
  Boolean(out?.warnedFailing?.some((g) => enf.quiet.includes(g)));

/**
 * The gates a lead line names, with where they came from.
 * @param {Enforcement} enf
 * @param {string[]} [gates]
 */
function warnedText(enf, gates = enf.configured) {
  const from = [...new Set(gates.map((g) => LAYER_LABEL[enf.layers[g]] ?? enf.layers[g]))].join(
    ', '
  );
  const until =
    enf.warnUntil && gates.some((g) => CONFIGURED.has(enf.layers[g]) && enf.layers[g] !== '--warn')
      ? `; until ${enf.warnUntil}${enf.ending ? `, enforced in ${enf.daysLeft} day${enf.daysLeft === 1 ? '' : 's'}` : ''}`
      : '';
  return `${gates.join(', ')} (${from}${until})`;
}

/**
 * The first line of a gated command under configured warn, or null.
 * @param {Enforcement} enf
 */
export function leadLine(enf) {
  if (!enf.configured.length)
    return enf.expired.length
      ? `ADVISORY: warn mode ended on ${enf.warnUntil}; ${enf.expired.join(', ')} ${enf.expired.length === 1 ? 'is' : 'are'} enforced again.`
      : null;
  const exit = enf.advisoryExit
    ? `a failure in ${enf.configured.length === 1 ? 'it' : 'them'} exits ${enf.advisoryExit}`
    : 'the exit stays 0';
  return `ADVISORY: warn mode for ${warnedText(enf)}. Failures are reported; ${exit}.`;
}

/**
 * The last line: what would have happened, and the readiness tally when there is one.
 * @param {Enforcement} enf
 * @param {Outcome} out
 * @param {TallyCounts | null} [tally]
 */
export function lastLine(enf, out, tally = null) {
  if (!speaks(enf, out)) return null;
  const counts = out.reasons.map((r) => `${r.count} ${r.what}`).join(', ');
  const t = tally?.runs
    ? ` Would-fail runs: ${tally.wouldFail} of ${tally.runs}${tally.main ? ` (${tally.main.branch} ${tally.main.wouldFail} of ${tally.main.runs})` : ''}.`
    : '';
  if (out.advisory)
    return `ADVISORY: would have failed (exit ${out.wouldExit}): ${counts}. Not blocking.${t}`;
  if (out.reasons.length) return `ADVISORY: warned gates would also have failed: ${counts}.${t}`;
  return `ADVISORY: would have passed.${t}`;
}

/**
 * The `enforcement` key of `check.json`, or null when nothing about warn mode applies.
 * @param {Enforcement} enf
 * @param {Outcome} out
 * @returns {EnforcementReport | null}
 */
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

/**
 * The enforcement row for `pxsig doctor` and `pxsig config`: "visual warn until … · others enforce".
 * @param {Enforcement} enf
 */
export function describeEnforcement(enf) {
  const parts = GATES.filter((g) => enf.gates[g] !== 'enforce').map(
    (g) =>
      `${g} ${enf.gates[g]}${enf.layers[g] === 'built-in' ? ' (default)' : enf.warnUntil && enf.configured.includes(g) && enf.layers[g] !== '--warn' ? ` until ${enf.warnUntil}` : ''}`
  );
  return parts.length ? `${parts.join(' · ')} · others enforce` : 'every gate enforced';
}

/**
 * Setup-level codes (never per entry, so story cards and `doctor`'s exit stay as they are):
 * `enforcement-warn` (info), `enforcement-ending` (warn, within noticeDays of warnUntil),
 * `enforcement-expired` (info, for noticeDays after). Built-in quiet gates produce none.
 * @param {Enforcement} enf
 * @param {TallyCounts | null} [tally]
 */
export function enforcementProblems(enf, tally = null) {
  /** @type {SetupProblem[]} */
  const out = [];
  const t = tally?.runs ? ` Would-fail runs: ${tally.wouldFail} of the last ${tally.runs}.` : '';
  if (enf.configured.length)
    out.push({
      code: 'enforcement-warn',
      severity: 'info',
      reason: `warn mode for ${warnedText(enf)}: failures in ${enf.configured.length === 1 ? 'this gate are' : 'these gates are'} reported, not blocking.${t}`,
    });
  if (enf.ending)
    out.push({
      code: 'enforcement-ending',
      severity: 'warn',
      reason: `${enf.configured.join(', ')} ${enf.configured.length === 1 ? 'is' : 'are'} enforced from ${enf.warnUntil} (in ${enf.daysLeft} day${enf.daysLeft === 1 ? '' : 's'}).${t} Extend warnUntil in a pull request to keep warn mode`,
    });
  if (enf.expired.length && enf.daysSince != null && enf.daysSince <= enf.noticeDays)
    out.push({
      code: 'enforcement-expired',
      severity: 'info',
      reason: `${enf.expired.join(', ')} ${enf.expired.length === 1 ? 'has' : 'have'} been enforced since ${enf.warnUntil} (warnUntil passed): failures exit as they did before warn mode`,
    });
  return out;
}
