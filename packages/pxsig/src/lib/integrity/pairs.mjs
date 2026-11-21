/**
 * integrity/pairs.mjs — `baseline-pair-mismatch`: baselines whose record and image come from two
 * different renders (lib/pairs.mjs). The gate reads the record and the inspector shows the image,
 * so such an entry can fail with nothing to see, or pass while its image shows something else.
 *
 * A setup error, never a per-entry code, with every entry named (`ids`, `pairs`). It is an error
 * at least: `integrity.severity` cannot lower it, and a lower value is named in the reason, as
 * `gate-color-off` does. An engine that cannot check the pairs is a warning under the same code.
 */
import { mismatched, pairsOf } from '../pairs.mjs';
/** @import { LedgerSetup } from '../../types/t3.js' */
/** @import { IntegrityContext } from './context.mjs' */

export const PAIR_CODE = 'baseline-pair-mismatch';

/** The fix, as the reason and `pxsig doctor` give it. */
export const PAIR_FIX =
  '`pxsig approve repair-records` lists the entries whose record can be written again from their own image (a person at a terminal confirms with --yes; the dashboard has the same action); review each of the others in the dashboard and approve or reject it';

/**
 * @param {IntegrityContext} ctx
 * @returns {LedgerSetup[]}
 */
export function pairProblems(ctx) {
  const got = pairsOf(ctx.rustBin, ctx.manifestPath, ctx.repoRoot);
  if (!got.rows)
    // No engine at all (a test without the Rust build, a fresh clone) checks nothing else either.
    return got.error === 'the pxsig engine is not built'
      ? []
      : [
          {
            code: PAIR_CODE,
            severity: 'warn',
            count: 0,
            reason: `${got.error}: whether each baseline's record and image are one render is not known (an engine older than this pxsig)`,
          },
        ];
  const bad = mismatched(got.rows);
  if (!bad.length) return [];
  const ids = bad.map((x) => x.id);
  const set = ctx.integrity?.severity?.[PAIR_CODE];
  const lowered =
    set && set !== 'error'
      ? `. integrity.severity sets ${PAIR_CODE} to "${set}", which is not applied: it is an error`
      : '';
  return [
    {
      code: PAIR_CODE,
      severity: 'error',
      count: ids.length,
      reason: `${ids.length} baselines hold a record and an image from different renders (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}): the gate reads the record, the inspector shows the image. ${PAIR_FIX}${lowered}`,
      ids,
      pairs: bad.map((x) => ({
        id: x.id,
        record: String(x.record ?? '').slice(0, 12),
        image: String(x.image ?? '').slice(0, 12),
      })),
    },
  ];
}

/**
 * `pxsig doctor`'s table of the mismatched pairs: every entry, with its record's and its image's
 * sha256 (12 characters).
 * @param {LedgerSetup[]} setup
 * @returns {import('../../types/t2.js').Block[]}
 */
export const pairBlocks = (setup) =>
  setup
    .filter((x) => x.code === PAIR_CODE && x.pairs?.length)
    .map((x) => ({
      table: {
        cols: [
          { key: 'id', label: 'Entry' },
          { key: 'record', label: 'Record' },
          { key: 'image', label: 'Image' },
        ],
        rows: x.pairs ?? [],
      },
    }));
