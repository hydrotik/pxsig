/**
 * sarif.mjs — new accessibility violations as SARIF 2.1.0 (`--sarif <file>` on `check` and `a11y`,
 * docs/cli.md#pxsig-a11y---component-text---new---sarif-file---limit-50), for tools that read it
 * (GitHub code scanning, IDE viewers). Additive output only: nothing reads it back, and it changes
 * no exit code.
 *
 * One result per entry and rule that is not on the entry's accepted list (`a11y.json`), located at
 * the entry's story file, with the entry id as the logical location. Rules carry axe's help text and
 * its documentation link. With `masks`, also one warning (`pxsig/large-mask`) per mask over a quarter
 * of an entry's capture (`masksLarge`, lib/capture/masks.mjs): such a mask lets most changes pass.
 */
import { writeAtomic } from './files.mjs';
/** @import { A11yResult, CheckRow, ManifestEntry, SarifLog, SarifResult, SarifRule } from '../types.js' */

/** @type {Record<string, string>} */
const LEVEL = { critical: 'error', serious: 'error', moderate: 'warning', minor: 'note' };
/** @param {string} id */
const helpUri = (id) => `https://dequeuniversity.com/rules/axe/latest/${encodeURIComponent(id)}`;

/** The large-mask rule: a mask over this share of the capture. */
const LARGE_MASK = {
  id: 'pxsig/large-mask',
  shortDescription: { text: 'A mask covers more than 25% of the capture' },
  helpUri: 'https://github.com/hydrotik/pxsig/blob/main/docs/configuration.md#masks',
  properties: { tags: ['visual', 'pxsig'] },
};

/** `masks`: also the large-mask warnings (`check --sarif`; `pxsig a11y --sarif` stays a11y only). */
/** @typedef {{ entries?: Map<string, Pick<ManifestEntry, 'importPath'>>, version?: string | null, masks?: boolean }} SarifOptions */

/**
 * The new violations of `rows` (check.json rows), as a SARIF log. `entries`: manifest stories by id.
 * @param {CheckRow[]} rows
 * @param {SarifOptions} [opts]
 * @returns {SarifLog}
 */
export function sarifLog(rows, { entries = new Map(), version = null, masks = false } = {}) {
  /** @type {Map<string, SarifRule>} */
  const rules = new Map();
  /** @type {SarifResult[]} */
  const results = [];
  /** @param {CheckRow} r */
  const locations = (r) => {
    const e = entries.get(r.id);
    return [
      {
        ...(e?.importPath ? { physicalLocation: { artifactLocation: { uri: e.importPath } } } : {}),
        logicalLocations: [{ name: r.id, kind: 'module' }],
      },
    ];
  };
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
      results.push({
        ruleId: id,
        // No impact looks up `LEVEL[undefined]`: undefined, so a warning.
        level: LEVEL[/** @type {string} */ (v.impact)] ?? 'warning',
        message: {
          text: `${r.id}: ${v.help ?? id}${v.nodes ? ` (${v.nodes} element${v.nodes === 1 ? '' : 's'}${v.targets?.length ? `: ${v.targets.join(', ')}` : ''})` : ''}`,
        },
        locations: locations(r),
        properties: { entry: r.id, mode: r.mode ?? null, impact: v.impact ?? null },
      });
    }
  }
  for (const r of masks ? rows : [])
    for (const m of r.masksLarge ?? []) {
      rules.set(LARGE_MASK.id, LARGE_MASK);
      results.push({
        ruleId: LARGE_MASK.id,
        level: 'warning',
        message: {
          text: `${r.id}: ${m.selector} (${m.source}) masks ${Math.round(m.area * 100)}% of the capture, which hides most changes under it`,
        },
        locations: locations(r),
        properties: {
          entry: r.id,
          mode: r.mode ?? null,
          selector: m.selector,
          source: m.source,
          area: m.area,
        },
      });
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
