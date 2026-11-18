/**
 * baseline-facts.mjs — what `pxsig doctor` counts in every baseline of a project's committed
 * manifest: the text records (text/doctor.mjs) and the masks (capture/doctor.mjs). Each baseline
 * is read once (integrity/sig-read.mjs), and not again when the ledger just read it.
 */
import { resolve } from 'node:path';
import { readJson } from './files.mjs';
import { sigFacts } from './integrity/sig-read.mjs';
/** @import { Project } from '../types.js' */
/** @import { SigFacts } from './integrity/sig-read.mjs' */

/**
 * The facts of the manifest's `.psig` baselines that read as one, in manifest order.
 * @param {Project} P
 * @returns {SigFacts[]}
 */
export function baselineFacts(P) {
  // The committed manifest (pxsig's own file): every entry's baseline path, workspace-relative.
  const m = /** @type {{ stories?: { sig?: string }[] } | null} */ (
    readJson(P.manifestPath(), null)
  );
  /** @type {SigFacts[]} */
  const out = [];
  for (const e of m?.stories ?? []) {
    if (!e.sig?.endsWith('.psig')) continue;
    const f = sigFacts(resolve(P.workspaceRoot, e.sig));
    if (f?.psig) out.push(f);
  }
  return out;
}
