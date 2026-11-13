/**
 * screens-verdict.mjs — which engine makes the verdicts of pxsig's own screens (screens-check.mjs),
 * and the check that it applied the colour rule.
 *
 * The screens render in pxsig's container (docker/screens-image.json), whose engine is the image's
 * release. The verdicts come from this checkout's engine when PXSIG_LIVE_BIN names a Linux build of
 * it (the screens and release workflows build one), so a gate change holds pxsig's own screens to
 * it too. The image's engine predates the colour rule (0.7.7): a verdict without it is refused,
 * never written as a pass.
 */
import { assertColourRule } from '../../packages/pxsig/src/lib/rows.mjs';

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} imageBin the engine the project resolves (the image's, PXSIG_BIN)
 */
export const verdictEngine = (env, imageBin) => env.PXSIG_LIVE_BIN || imageBin;

/**
 * Throw when any compared row was judged without the colour rule, naming the fix.
 * @param {(import('../../packages/pxsig/src/types.js').EngineResult & { id: string })[]} results the engine's
 *   `check --json` rows
 */
export function assertVerdicts(results) {
  try {
    for (const r of results) assertColourRule(r.id, r);
  } catch (e) {
    throw new Error(
      `${/** @type {Error} */ (e).message}: set PXSIG_LIVE_BIN to a Linux build of this checkout (docs/releasing.md, "Live screens")`
    );
  }
}
