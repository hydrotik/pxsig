/** The write guard and the repair log (repair.mjs): the line each action appends, naming no person. */
import { mkdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { repairLogPath, SCHEMA_VERSION } from '../integrity.mjs';
import { appendLine } from '../files.mjs';
import { stamp } from '../approvals.mjs';
/** @import { IntegrityContext } from '../integrity.mjs' */
/** @import { RepairLogLine } from '../../types/t3.js' */

// --- the write guard ------------------------------------------------------------------------------------

/**
 * Refuse any write that could touch a signature or the baselines folder.
 * @param {IntegrityContext} ctx
 * @param {string} path
 */
export function guardWrite(ctx, path) {
  const abs = resolve(path);
  const baselines = resolve(ctx.dirs.baselines) + sep;
  const pixels = ctx.pixelsRoot ? resolve(ctx.repoRoot, ctx.pixelsRoot) + sep : null;
  if (
    /\.(pxsig\.json|psig)$/i.test(abs) ||
    abs.startsWith(baselines) ||
    (pixels && abs.startsWith(pixels))
  )
    throw new Error(
      `refused: repair never writes signatures or baselines (${relative(ctx.repoRoot, abs)})`
    );
  return abs;
}

/**
 * @param {IntegrityContext} ctx
 * @param {RepairLogLine} line
 */
export function logRepair(ctx, line) {
  const p = guardWrite(ctx, repairLogPath(ctx));
  mkdirSync(dirname(p), { recursive: true });
  // stamp (lib/approvals.mjs) returns the line with `agent` and `pxsig`, never a `by`.
  const full = /** @type {Record<string, unknown>} */ (
    stamp({ schemaVersion: SCHEMA_VERSION, at: new Date().toISOString(), ...line })
  );
  appendLine(p, full);
  return full;
}
