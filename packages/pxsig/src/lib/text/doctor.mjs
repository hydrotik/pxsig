/**
 * lib/text/doctor.mjs — what `pxsig doctor` says about text capture. Neither changes its exit:
 *
 *   text-capture (info)  on or off (and why), and how many of the manifest's baselines carry a text
 *                        record (a `boxes` section)
 *   text-config  (warn)  a bad `text` value, and what it does to this run
 */
import { resolve } from 'node:path';
import { readJson } from '../files.mjs';
import { readHeader } from '../psig.mjs';
import { textConfig } from './config.mjs';
/** @import { Project } from '../../types.js' */

/** @typedef {{ code: 'text-capture' | 'text-config', severity: 'info' | 'warn', text: string }} TextFinding */

/**
 * @param {Project} P
 * @returns {TextFinding[]}
 */
export function textFindings(P) {
  const t = textConfig(P);
  /** @type {TextFinding[]} */
  const out = t.problems.map((p) => ({ code: 'text-config', severity: 'warn', text: p }));
  // The committed manifest (pxsig's own file): every entry's baseline path, workspace-relative.
  const m = /** @type {{ stories?: { sig?: string }[] } | null} */ (
    readJson(P.manifestPath(), null)
  );
  let baselines = 0;
  let recorded = 0;
  for (const e of m?.stories ?? []) {
    if (!e.sig?.endsWith('.psig')) continue;
    const h = readHeader(resolve(P.workspaceRoot, e.sig));
    if (!h) continue;
    baselines++;
    if (h.sections?.some((s) => s.name === 'boxes')) recorded++;
  }
  out.push({
    code: 'text-capture',
    severity: 'info',
    text: `${t.on ? 'on' : `off (${t.off})`} · ${recorded} of ${baselines} baselines have a text record`,
  });
  return out;
}
