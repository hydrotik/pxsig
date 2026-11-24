/**
 * setup/migrate-pairs.mjs — `pxsig migrate` packs each old record with an image only when they
 * are one render: the image, captured as `capture` would at the record's grid, has the record's
 * `sha256` (the engine's `pairs --plan`). A pair from two different renders keeps its record and
 * leaves the image out; each such id is in the plan's `pairMismatch` and the command's output, and
 * the integrity ledger reports the missing image (`missing-baseline-image`) so a person reviews it.
 * An engine that cannot check refuses the migration: nothing is packed unchecked.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairsOf } from '../pairs.mjs';
import { SetupError } from '../workspace.mjs';
/** @import { MigratePack, MigratePlan } from '../../types/t6.js' */

/** A record packed without its image, with the record's and the image's sha256 (12 characters). */
/** @typedef {{ id: string, record: string, image: string }} PairLeftOut */
/**
 * `migrateLegacy`'s plan with the pairs it packed without their image.
 * @typedef {MigratePlan & { pairMismatch: PairLeftOut[], summary: MigratePlan['summary'] & { pairMismatch: number } }} PairedPlan
 */

/**
 * Check every item with an image; leave the image out of each whose pair differs (or whose image
 * the engine cannot read). Returns those ids, with the record's and the image's sha256.
 * @param {string} rustBin
 * @param {MigratePack[]} pack
 * @returns {PairLeftOut[]}
 */
export function dropMismatchedImages(rustBin, pack) {
  const withImage = pack.filter((x) => x.image);
  if (!withImage.length) return [];
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-migrate-'));
  try {
    const plan = join(dir, 'pairs.json');
    writeFileSync(
      plan,
      JSON.stringify(withImage.map((x) => ({ id: x.entry.id, sig: x.sig, image: x.image })))
    );
    const got = pairsOf(rustBin, '', dir, { plan });
    if (!got.rows)
      throw new SetupError(`${got.error}: no record and image were packed together unchecked`);
    const rows = new Map(got.rows.map((r) => [r.id, r]));
    /** @type {PairLeftOut[]} */
    const out = [];
    for (const x of withImage) {
      const r = rows.get(x.entry.id);
      if (r?.match === true) continue;
      x.image = null;
      out.push({
        id: x.entry.id,
        record: String(r?.record ?? '').slice(0, 12),
        image: r?.error ? 'unreadable' : String(r?.image ?? '').slice(0, 12),
      });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
