/**
 * lib/text/doctor.mjs — what `pxsig doctor` says about text capture. Neither changes its exit:
 *
 *   text-capture (info)  on or off (and why), and how many of the manifest's baselines carry a text
 *                        record (a `boxes` section)
 *   text-config  (warn)  a bad `text` value, and what it does to this run
 */
import { baselineFacts } from '../baseline-facts.mjs';
import { textConfig } from './config.mjs';
/** @import { Project } from '../../types.js' */
/** @import { SigFacts } from '../integrity/sig-read.mjs' */

/** @typedef {{ code: 'text-capture' | 'text-config', severity: 'info' | 'warn', text: string }} TextFinding */

/**
 * @param {Project} P
 * @param {SigFacts[]} [facts] the manifest's baselines (baseline-facts.mjs)
 * @returns {TextFinding[]}
 */
export function textFindings(P, facts = baselineFacts(P)) {
  const t = textConfig(P);
  /** @type {TextFinding[]} */
  const out = t.problems.map((p) => ({ code: 'text-config', severity: 'warn', text: p }));
  const baselines = facts.length;
  const recorded = facts.filter((f) => f.boxes).length;
  out.push({
    code: 'text-capture',
    severity: 'info',
    text: `${t.on ? 'on' : `off (${t.off})`} · ${recorded} of ${baselines} baselines have a text record`,
  });
  return out;
}
