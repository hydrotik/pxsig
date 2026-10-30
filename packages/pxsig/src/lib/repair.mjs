/**
 * repair.mjs — deterministic, provably-safe repairs for what the integrity ledger finds.
 *
 * Guarantees (tested in test/integrity.test.mjs):
 *   - NEVER changes a signature and never approves anything. Every JS write goes through
 *     `guardWrite`, which refuses baseline files (*.psig, *.pxsig.json) and the baselines folder.
 *   - A missing baseline image is restored only when the fresh latest render passes the
 *     signature gate (Rust `pxsig check`, no cache). Rust `pxsig attach` then adds it to the
 *     `.psig`: it refuses a `.psig` that already has an image and verifies the record and
 *     signature bytes are unchanged. Otherwise the entry stays flagged and the signature
 *     reconstruction (`<id>.baseline.png`) is kept for display.
 *   - A legacy `.pxsig.json` baseline is converted to `.psig` (Rust `pxsig pack`: the same record,
 *     byte for byte, read back and compared) with its latest render as the image, only when that
 *     render passes the signature gate. The manifest entry then points at the `.psig`; the old file
 *     moves to the store trash/.
 *   - New stories are added to the manifest with no signature: they surface as NEW and wait for
 *     a person to approve their first render.
 *   - Orphans are only reported. `prune` (a person at a terminal, typed confirmation) moves them
 *     to `<store>/trash/<timestamp>/`; nothing is ever deleted.
 *   - Every action is appended to `<store>/reports/repairs.ndjson`: who, when, what, why, result.
 *
 * No LLM, no heuristics that guess: each step has a precondition it checks right before acting.
 */
export { guardWrite, logRepair, who } from './repair/core.mjs';
export { ACTIONS, planRepairs } from './repair/plan.mjs';
export {
  entriesOfStory,
  registerNamed,
  registerStories,
  storyOfEntry,
} from './repair/register.mjs';
export { convertLegacy, gateLatest, restoreBaselineImages } from './repair/restore.mjs';
export { applyRepairs, defaultHooks, pruneOrphans, serverStatus } from './repair/apply.mjs';
