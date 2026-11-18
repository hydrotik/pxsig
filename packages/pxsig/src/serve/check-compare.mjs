/**
 * serve/check-compare.mjs — a check queued with `since` (a git ref) or `changed` (files), as
 * `pxsig check --since` / `--changed` hands it over when this server holds the store: the request's
 * ref and files checked as the CLI checks its flags (lib/git-ref.mjs), and, beside the renders, what
 * the check without a server adds for them: `affected` and `react` in check.json (the React
 * Compiler compared with the merge base) and the history line's `react` counts.
 */
import { filesFault, refFault } from '../lib/git-ref.mjs';
import { reactBlock } from '../check/react.mjs';
import { checkAnalysis } from './react.mjs';
/** @import { ServeContext } from '../types/serve.js' */
/** @import { AffectedResult } from '../types/t4.js' */
/** @import { RequestBody } from '../types/t5.js' */
/** @import { CheckReact, ReactRun } from '../types/react.js' */
/** @import { ProjectState } from './projects.mjs' */

/**
 * What a check compares with: one ref or a list of workspace-relative files, and whether React
 * was switched off where it was asked for (`react: false`).
 * @typedef {({ since: string } | { files: string[] }) & { off: boolean }} Compare
 */

/**
 * The request's `since` / `changed`, checked: `{ compare }` (null when it names neither), or
 * `{ error }` (answered 400; nothing is queued).
 * @param {RequestBody} body
 * @param {ProjectState} S
 * @returns {{ compare: Compare | null } | { error: string }}
 */
export function compareOf(body, S) {
  const off = body.react === false;
  if (body.since !== undefined && body.changed !== undefined)
    return { error: 'pass since or changed, not both' };
  if (body.changed !== undefined) {
    const fault = filesFault(body.changed);
    return fault
      ? { error: fault }
      : { compare: { files: /** @type {string[]} */ (body.changed), off } };
  }
  if (body.since === undefined) return { compare: null };
  const fault = refFault(S.P.workspaceRoot, body.since);
  return fault ? { error: fault } : { compare: { since: /** @type {string} */ (body.since), off } };
}

/**
 * Start what a compared check adds; it runs while the entries render.
 * @param {ServeContext} srv
 * @param {ProjectState} S
 * @param {Compare} compare
 * @returns {Promise<{ affected: AffectedResult | null, run: ReactRun }>}
 */
export async function startCompare(srv, S, compare) {
  const sel = 'files' in compare ? { files: compare.files } : { since: compare.since };
  const affected = /** @type {Promise<AffectedResult | null>} */ (
    srv
      .trace('affected', {
        manifest: /** @type {string} */ (S.runPath),
        root: S.P.workspaceRoot,
        ...sel,
      })
      .catch(() => null)
  );
  /** @type {ReactRun} */
  const run = compare.off
    ? { ran: false, why: 'off', text: 'react: off (--no-react)' }
    : await checkAnalysis(srv, S, sel);
  return { affected: await affected, run };
}

/**
 * check.json's top-level keys after a compared run: `affected` and `react` as the CLI writes them.
 * @param {{ affected: AffectedResult | null, run: ReactRun }} done
 * @returns {{ affected: AffectedResult | null, react: CheckReact }}
 */
export const compareKeys = (done) => ({
  affected: done.affected,
  react: /** @type {CheckReact} */ (reactBlock(done.run)),
});
