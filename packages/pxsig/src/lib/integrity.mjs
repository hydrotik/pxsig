/**
 * integrity.mjs — the coverage / integrity reconciler.
 *
 * Joins every source of truth pxsig has, per entry and per component, and says what is wrong
 * without anyone opening an entry to find out:
 *
 *   story index      Storybook's `<baseUrl>/index.json` when it is reachable and healthy, else a
 *                    static scan of the CSF files under `srcRoot` (Storybook's own id rules)
 *   manifest         <store>/manifest.json (entries = story × mode × interaction state)
 *   config           the project's pxsig.config.json (nonVisual, modes, `integrity` options)
 *   baselines        each entry's `.psig` (signature + baseline image; never written here)
 *   renders          <store>/renders/latest/<id>.png
 *   diffs            <store>/diffs/latest/<id>.diff.png and the signature reconstruction
 *                    `<id>.baseline.png` the Rust check writes for failures
 *   report           <store>/reports/check.json rows (pass, error, flaky, checkedAt)
 *   review/approvals <store>/reports/review.json, <store>/approvals.ndjson
 *   a11y baseline    <store>/a11y.json
 *   source freshness file mtimes under the source roots vs each verdict, traced through the
 *                    Rust import graph (`pxsig affected`) when available, else per story folder
 *
 * Output: a versioned ledger (`<store>/reports/integrity.json`, schema in docs/integrity.md) with one
 * status per entry and per component. Reading is side-effect free; `writeLedger` is the only
 * write. Nothing here renders, checks, approves or touches a signature.
 */
export {
  SCHEMA_VERSION,
  CODES,
  SEVERITIES,
  primaryOf,
  phrase,
  BENIGN_INFO,
  summarise,
  filterLedger,
  oneLine,
} from './integrity/codes.mjs';
export {
  DEFAULT_INTEGRITY,
  readJson,
  sha256File,
  writeJsonAtomic,
  resolveContext,
  ledgerPath,
  repairLogPath,
  editedFilesSince,
  rustAffected,
  siblingManifests,
  writeLedger,
} from './integrity/context.mjs';
export {
  sanitize,
  storyNameFromExport,
  toId,
  normaliseImportPath,
  componentOf,
  fetchStoryIndex,
  scanStories,
  loadStoryIndex,
} from './integrity/stories.mjs';
export { reconcile } from './integrity/reconcile.mjs';
/** @typedef {import('./integrity/context.mjs').IntegrityContext} IntegrityContext */
