/**
 * sarif.mjs — new accessibility violations as SARIF 2.1.0 (`--sarif <file>` on `check` and `a11y`,
 * docs/cli.md#pxsig-a11y---component-text---new---sarif-file---limit-50), for tools that read it
 * (GitHub code scanning, IDE viewers). Additive output only: nothing reads it back, and it changes
 * no exit code.
 *
 * One result per entry and rule that is not on the entry's accepted list (`a11y.json`), located at
 * the entry's story file, with the entry id as the logical location. Rules carry axe's help text and
 * its documentation link. With `masks`, also the masks findings (crates/pxsig-cli/src/batch/masks.rs),
 * one per entry: an error (`pxsig/mask-limit`) where masks cover over half the capture together or
 * the story root, which no approval clears; a warning (`pxsig/masks-changed`) where they differ from
 * the baseline's; a warning (`pxsig/large-mask`) where they cover over a quarter of it together.
 */
import { writeAtomic } from './files.mjs';
import { blockedReasons, LARGE_SHARE, maskChange } from './mask-words.mjs';
/** @import { A11yResult, CheckRow, ManifestEntry, SarifLog, SarifResult, SarifRule } from '../types.js' */

/** @type {Record<string, string>} */
const LEVEL = { critical: 'error', serious: 'error', moderate: 'warning', minor: 'note' };
/** @param {string} id */
const helpUri = (id) => `https://dequeuniversity.com/rules/axe/latest/${encodeURIComponent(id)}`;

/**
 * A masks rule.
 * @param {string} id
 * @param {string} text
 */
const maskRule = (id, text) => ({
  id,
  shortDescription: { text },
  helpUri: 'https://github.com/hydrotik/pxsig/blob/main/docs/configuration.md#masks',
  properties: { tags: ['visual', 'pxsig'] },
});
const MASK_LIMIT = maskRule(
  'pxsig/mask-limit',
  'Masks cover more than 50% of the capture, or the story root: no approval passes the entry'
);
const MASKS_CHANGED = maskRule('pxsig/masks-changed', 'The masks differ from the baseline’s');
const LARGE_MASK = maskRule('pxsig/large-mask', 'Masks cover more than 25% of the capture');

/** `masks`: also the masks findings (`check --sarif`; `pxsig a11y --sarif` stays a11y only). */
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
  /**
   * @param {CheckRow} r
   * @param {SarifRule} rule
   * @param {'error' | 'warning'} level
   * @param {string} text
   * @param {{ coverage?: number, masks?: CheckRow['masksChanged'] }} props
   */
  const mask = (r, rule, level, text, props) => {
    rules.set(rule.id, rule);
    results.push({
      ruleId: rule.id,
      level,
      message: { text: `${r.id}: ${text}` },
      locations: locations(r),
      properties: { entry: r.id, mode: r.mode ?? null, ...props },
    });
  };
  for (const r of masks ? rows : []) {
    const coverage = r.masksCoverage ?? 0;
    if (r.masksBlocked)
      mask(r, MASK_LIMIT, 'error', `${blockedReasons(r).join('; ')}: no approval passes it`, {
        coverage,
      });
    if (r.masksChanged)
      mask(r, MASKS_CHANGED, 'warning', maskChange(r.masksChanged), { masks: r.masksChanged });
    if (!r.masksBlocked && coverage > LARGE_SHARE)
      mask(
        r,
        LARGE_MASK,
        'warning',
        `masks cover ${Math.round(coverage * 100)}% of the capture, which hides most changes under them`,
        { coverage }
      );
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
