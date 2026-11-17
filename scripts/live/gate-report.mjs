/**
 * live/gate-report.mjs — the live screens' scrub of `GET /__pxsig/gate-report` (live/volatile.mjs):
 * the report's facts name the pxsig and engine versions and the class of the machines that rendered
 * (OS, architecture, browser major, GPU). Those vary with the release and the host (x64 or arm64),
 * so a live screen would move with them. The scrub sets them to fixed values and makes the text and
 * the link again from the facts with pxsig's own code (lib/gate-report/text.mjs), as the server
 * did. Only this harness rewrites them: the server's answer to a real page is untouched.
 *
 * Zero dependencies.
 */
import { gateText, issueUrl } from '../../packages/pxsig/src/lib/gate-report/text.mjs';

/** @import { GateFacts } from '../../packages/pxsig/src/lib/gate-report.mjs' */

/** The versions a live report shows. */
export const FIXED_VERSION = '0.0.0-live';
/** The environment class a live report shows; the second one when render and baseline differ. */
export const FIXED_ENV = 'Linux x64 · chromium 145 · GPU swiftshader';
export const FIXED_ENV_OTHER = 'Linux x64 · chromium 144 · GPU swiftshader';

/**
 * Fix the versions and environments of a gate report answer in place and make its text, link and
 * trimmed fields again; returns the problems (empty when clean).
 * @param {Record<string, unknown>} answer the answer: `{ text, url, trimmed, facts, image }`
 * @param {string} at the facts' shown path
 * @returns {string[]}
 */
export function fixGateReport(answer, at) {
  const f = /** @type {GateFacts} */ (answer.facts);
  if (f == null || typeof f !== 'object' || typeof f.pxsig !== 'string' || !f.environment)
    return [`${at} is not a gate report's facts`];
  if (typeof answer.text !== 'string' || typeof answer.url !== 'string')
    return [`${at}: the answer has no text or link`];
  f.pxsig = FIXED_VERSION;
  if (f.engine != null) f.engine = FIXED_VERSION;
  const env = f.environment;
  const differ = env.render != null && env.baseline != null && env.render !== env.baseline;
  if (env.render != null) env.render = FIXED_ENV;
  if (env.baseline != null) env.baseline = differ ? FIXED_ENV_OTHER : FIXED_ENV;
  const { url, trimmed } = issueUrl(f);
  answer.text = gateText(f);
  answer.url = url;
  answer.trimmed = trimmed;
  return [];
}
