/**
 * lint-ratchet.mjs — lint warnings may only go down.
 *
 * oxlint warnings do not fail `pnpm lint:ci`, so on their own they only grow.
 * This counts them per file and rule and compares the counts with a recorded
 * baseline, the same way the design-rules baseline works: a file may not gain
 * a warning of any rule, and once it loses one the baseline is lowered so it
 * stays lower.
 *
 * Zero dependencies; the caller runs oxlint and passes its JSON diagnostics.
 */
/** @import { Counts } from '../types.js' */

/**
 * `{ file: { rule: count } }` for the warnings in oxlint's JSON diagnostics.
 * @param {{ filename: string, code: string, severity: string }[]} diagnostics
 */
export function countWarnings(diagnostics) {
  return countDiagnostics(diagnostics.filter((d) => d.severity === 'warning'));
}

/**
 * `{ file: { code: count } }` for any diagnostics (scripts/check-types.mjs passes tsc's errors).
 * @param {{ filename: string, code: string }[]} diagnostics
 */
export function countDiagnostics(diagnostics) {
  /** @type {Record<string, Record<string, number>>} */
  const counts = {};
  for (const d of diagnostics) {
    const file = d.filename.replace(/\\/g, '/');
    counts[file] ??= {};
    counts[file][d.code] = (counts[file][d.code] ?? 0) + 1;
  }
  return sortKeys(counts);
}

/**
 * Every file/rule whose count rose above the baseline.
 * @param {Counts} baseline
 * @param {Counts} current
 */
export function regressions(baseline, current) {
  /** @type {{ file: string, rule: string, allowed: number, count: number }[]} */
  const out = [];
  for (const [file, rules] of Object.entries(current)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (count > allowed) out.push({ file, rule, allowed, count });
    }
  }
  return out;
}

/**
 * The baseline lowered to what is left: counts that fell drop, fixed entries
 * go, and nothing rises (new warnings are regressions, not baseline).
 * @param {Counts} baseline
 * @param {Counts} current
 */
export function lowered(baseline, current) {
  /** @type {Counts} */
  const next = {};
  for (const [file, rules] of Object.entries(baseline)) {
    for (const [rule, allowed] of Object.entries(rules)) {
      const now = Math.min(allowed, current[file]?.[rule] ?? 0);
      if (now > 0) (next[file] ??= {})[rule] = now;
    }
  }
  return sortKeys(next);
}

/**
 * Total warnings in a `{ file: { rule: count } }` map.
 * @param {Counts} counts
 */
export function total(counts) {
  return Object.values(counts).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
    0
  );
}

/**
 * @param {Counts} counts
 * @returns {Counts}
 */
function sortKeys(counts) {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((file) => [
        file,
        Object.fromEntries(
          Object.keys(counts[file])
            .sort()
            .map((rule) => [rule, counts[file][rule]])
        ),
      ])
  );
}
