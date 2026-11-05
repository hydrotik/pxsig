/**
 * The `react` settings (pxsig.config.json, `defaults.react` in pxsig.workspace.json): the off
 * switches and `react.renders`. A bad value never fails a run: it is one warning line and that
 * part off, so this alert-only feature cannot fail a check.
 */
/** @import { ReactSettings } from '../../types/react.js' */

/** @type {Set<string>} */
const warned = new Set();

/**
 * @param {unknown} config the project's merged config (`P.config`)
 * @param {{ env?: NodeJS.ProcessEnv, warn?: (line: string) => void }} [opts]
 * @returns {ReactSettings}
 */
export function reactSettings(config, { env = process.env, warn = (l) => console.error(l) } = {}) {
  /** @param {string} line */
  const once = (line) => {
    if (warned.has(line)) return;
    warned.add(line);
    warn(`[pxsig] ${line}`);
  };
  const off = (/** @type {string} */ why) => ({ off: why, renders: false });
  const flag = String(env.PXSIG_REACT ?? '').toLowerCase();
  if (['off', 'false', '0'].includes(flag)) return off('PXSIG_REACT=off');
  const react = /** @type {Record<string, unknown> | null | undefined} */ (config)?.react;
  // `false` is canonical; "off" is accepted as the same (owner answer, 2026-11-03).
  if (react === false || react === 'off') return off('react: false');
  if (react == null || react === true) return { off: null, renders: false };
  if (typeof react !== 'object' || Array.isArray(react)) {
    once('react must be false or an object: React features are off for this run');
    return off('a bad react value');
  }
  const r = /** @type {Record<string, unknown>} */ (react);
  if (r.renders !== undefined && typeof r.renders !== 'boolean') {
    once('react.renders must be true or false: render counting is off for this run');
    return { off: null, renders: false };
  }
  return { off: null, renders: r.renders === true };
}
