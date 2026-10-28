/**
 * sarif.mjs — new accessibility violations as SARIF 2.1.0 (`--sarif <file>` on `check` and `a11y`,
 * decision 96), for tools that read it (GitHub code scanning, IDE viewers). Additive output only:
 * nothing reads it back, and it changes no exit code.
 *
 * One result per entry and rule that is not on the entry's accepted list (`a11y.json`), located at
 * the entry's story file, with the entry id as the logical location. Rules carry axe's help text and
 * its documentation link.
 */
import { writeAtomic } from './files.mjs';
/** @import { A11yResult, CheckRow, ManifestEntry, SarifLog, SarifResult, SarifRule } from '../types.js' */

/** @type {Record<string, string>} */
const LEVEL = { critical: 'error', serious: 'error', moderate: 'warning', minor: 'note' };
/** @param {string} id */
const helpUri = (id) => `https://dequeuniversity.com/rules/axe/latest/${encodeURIComponent(id)}`;

/** @typedef {{ entries?: Map<string, Pick<ManifestEntry, 'importPath'>>, version?: string | null }} SarifOptions */

/**
 * The new violations of `rows` (check.json rows), as a SARIF log. `entries`: manifest stories by id.
 * @param {CheckRow[]} rows
 * @param {SarifOptions} [opts]
 * @returns {SarifLog}
 */
export function sarifLog(rows, { entries = new Map(), version = null } = {}) {
  /** @type {Map<string, SarifRule>} */
  const rules = new Map();
  /** @type {SarifResult[]} */
  const results = [];
  for (const r of rows) {
    const vs = r.a11y?.violations;
    // A missing count compares as `undefined > 0`, false: no new violations.
    if (!vs?.length || !(/** @type {number} */ (r.a11y?.new) > 0)) continue;
    // `vs` came from it, so it is there.
    const known = /** @type {A11yResult} */ (r.a11y).baseline ?? [];
    for (const v of vs) {
      const id = v.id ?? v;
      if (known.includes(id)) continue;
      if (!rules.has(id))
        rules.set(id, {
          id,
          shortDescription: { text: v.help ?? id },
          helpUri: helpUri(id),
          properties: { tags: ['accessibility', 'axe'] },
        });
      const e = entries.get(r.id);
      results.push({
        ruleId: id,
        // No impact looks up `LEVEL[undefined]`: undefined, so a warning.
        level: LEVEL[/** @type {string} */ (v.impact)] ?? 'warning',
        message: {
          text: `${r.id}: ${v.help ?? id}${v.nodes ? ` (${v.nodes} element${v.nodes === 1 ? '' : 's'}${v.targets?.length ? `: ${v.targets.join(', ')}` : ''})` : ''}`,
        },
        locations: [
          {
            ...(e?.importPath
              ? { physicalLocation: { artifactLocation: { uri: e.importPath } } }
              : {}),
            logicalLocations: [{ name: r.id, kind: 'module' }],
          },
        ],
        properties: { entry: r.id, mode: r.mode ?? null, impact: v.impact ?? null },
      });
    }
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'pxsig',
            ...(version ? { version } : {}),
            informationUri: 'https://github.com/hydrotik/pxsig',
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
}

/**
 * Write the log; returns the number of results.
 * @param {string} path
 * @param {CheckRow[]} rows
 * @param {SarifOptions} [opts]
 */
export function writeSarif(path, rows, opts) {
  const log = sarifLog(rows, opts);
  writeAtomic(path, `${JSON.stringify(log, null, 2)}\n`);
  return log.runs[0].results.length;
}
