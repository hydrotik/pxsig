/**
 * lib/text/env-plan.mjs — the env plan `pxsig check --env` reads (`{ envs, byId }`, the shape
 * `pxsig baseline --env` takes): each entry's render environment, by its browser. The engine
 * compares a render's text record with its baseline's only when the two environment ids are equal
 * (the id the pixel check's `baselineEnv` / `env` report); otherwise the row's `textDiff` says
 * `env-differs`. Labels only.
 */
import { byId } from '../env.mjs';
/** @import { EnvRecord } from '../../types.js' */

/**
 * @param {{ id: string, browser?: string }[]} entries
 * @param {Record<string, EnvRecord> | null | undefined} current the run's env per browser
 * @returns {{ envs: Record<string, EnvRecord>, byId: Record<string, string> }}
 */
export function envPlan(entries, current) {
  /** @type {Record<string, string>} */
  const ids = {};
  for (const e of entries) {
    const id = current?.[e.browser ?? 'chromium']?.id;
    if (id) ids[e.id] = id;
  }
  return { envs: byId(current), byId: ids };
}
