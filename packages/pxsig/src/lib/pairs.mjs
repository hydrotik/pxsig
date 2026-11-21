/**
 * pairs.mjs — each baseline's record against its own image, through the engine (`pxsig pairs`,
 * crates/pxsig-cli/src/cmd_pairs.rs). A `.psig` holds a record (what the gate reads) and a baseline
 * image (what the dashboard shows); a pair from two different renders has a record whose `sha256`
 * is not the image's, captured at the record's grid. `pxsig migrate` used to pack such pairs; the
 * integrity ledger reports them (`baseline-pair-mismatch`) and `pxsig approve repair-records`
 * writes the records of the eligible ones again (lib/approvals/record-repair.mjs).
 *
 * Reading only: the engine decodes each image and hashes its signature, nothing is written. On a
 * 2,754-baseline store it takes about 0.15 s, so nothing is cached.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from './spawn.mjs';

/**
 * One baseline's pair, as the engine reports it.
 * `pixels` / `latestPixels`: the image's and (with `pngDir`) the latest render's pixel hash.
 * @typedef {{ id: string, file?: string, record?: string, image?: string | null, pixels?: string | null, latestPixels?: string | null, grid?: number, match?: boolean | null, error?: string }} PairRow
 */

/**
 * The pairs of a manifest's `.psig` baselines (`only`: those ids). `error` when the engine is not
 * built or does not know `pairs` (an engine older than this pxsig).
 * @param {string} rustBin
 * @param {string} manifest a manifest with `stories[].sig` relative to `root` (unused with `plan`)
 * @param {string} root
 * @param {{ only?: string[], pngDir?: string, plan?: string }} [opts] `pngDir`: hash each entry's
 *   render there too; `plan`: a file of `[{ id, sig, image? }]` to read instead of the manifest
 * @returns {{ rows: PairRow[], error?: undefined } | { rows: null, error: string }}
 */
export function pairsOf(rustBin, manifest, root, { only, pngDir, plan } = {}) {
  if (!existsSync(rustBin)) return { rows: null, error: 'the pxsig engine is not built' };
  if (only && !only.length) return { rows: [] };
  const r = spawnSync(
    rustBin,
    [
      'pairs',
      ...(plan ? ['--plan', plan] : ['--manifest', manifest]),
      '--root',
      root,
      ...(only ? ['--only', only.join(',')] : []),
      ...(pngDir ? ['--png-dir', pngDir] : []),
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.status !== 0)
    return {
      rows: null,
      error: `the engine could not check the pairs: ${
        String(r.stderr || r.stdout || `exit ${r.status}`)
          .trim()
          .split('\n')[0]
      }`,
    };
  // The engine's `pairs` answer: `{ summary, results }`.
  return { rows: /** @type {{ results: PairRow[] }} */ (JSON.parse(String(r.stdout))).results };
}

/**
 * The rows whose record and image differ.
 * @param {PairRow[]} rows
 */
export const mismatched = (rows) => rows.filter((x) => x.match === false);
