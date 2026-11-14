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
 * With `drift` (check.json's `summary.drift`), one note for the run (`pxsig/drift`): how many
 * entries pass while their render differs from the baseline (lib/drift.mjs).
 */
import { writeAtomic } from './files.mjs';
import { blockedFixes, blockedReasons, LARGE_SHARE, maskChange } from './mask-words.mjs';
/** @import { A11yResult, CheckRow, DriftSummary, ManifestEntry, SarifLog, SarifResult, SarifRule } from '../types.js' */
import { driftLine } from './drift.mjs';

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

/** The drift note: one per run, never per entry. */
const DRIFT = {
  id: 'pxsig/drift',
  shortDescription: { text: 'Entries pass while their render differs from the baseline' },
  helpUri: 'https://github.com/hydrotik/pxsig/blob/main/docs/integrity.md#drift',
  properties: { tags: ['visual', 'pxsig'] },
};

/** `masks`: also the masks findings (`check --sarif`; `pxsig a11y --sarif` stays a11y only). `drift`: the drift note. */
/** @typedef {{ entries?: Map<string, Pick<ManifestEntry, 'importPath'>>, version?: string | null, masks?: boolean, drift?: DriftSummary | null }} SarifOptions */

/**
 * The new violations of `rows` (check.json rows), as a SARIF log. `entries`: manifest stories by id.
 * @param {CheckRow[]} rows
 * @param {SarifOptions} [opts]
 * @returns {SarifLog}
 */
export function sarifLog(
  rows,
  { entries = new Map(), version = null, masks = false, drift = null } = {}
) {
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
      mask(
        r,
        MASK_LIMIT,
        'error',
        `${blockedReasons(r).join('; ')}: no approval passes it; ${blockedFixes(r).join('; ')}`,
        {
          coverage,
        }
      );
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
  const line = driftLine(drift);
  if (drift && line) {
    rules.set(DRIFT.id, DRIFT);
    const { warnAt, ...counts } = drift;
    results.push({
      ruleId: DRIFT.id,
      level: 'note',
      message: { text: line.replace(/^drift: /, '').replace(/ → .*$/, '') },
      locations: [{ logicalLocations: [{ name: 'check', kind: 'module' }] }],
      properties: { ...counts, warnAt },
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
 * What `check --sarif` says it wrote: the new a11y violations, then the masks findings, each
 * counted once per entry as the log has them (a large mask is an entry whose masks together cover
 * over a quarter of the capture, never a mask on its own).
 * @param {SarifLog} log
 * @param {string} file
 */
export function sarifWrote(log, file) {
  const results = log.runs[0].results;
  /** @param {string} id */
  const count = (id) => results.filter((r) => r.ruleId === id).length;
  const masks = /** @type {[number, string][]} */ ([
    [count(MASK_LIMIT.id), 'over the mask limits'],
    [count(MASKS_CHANGED.id), 'with masks changed'],
    [count(LARGE_MASK.id), 'with large masks'],
  ]).filter(([n]) => n > 0);
  const drift = count(DRIFT.id);
  const a11y = results.length - drift - masks.reduce((a, [n]) => a + n, 0);
  const said = masks.map(([n, what]) => `${n} ${n === 1 ? 'entry' : 'entries'} ${what}`);
  if (drift) said.push('the drift note');
  return `[check] wrote ${[`${a11y} new a11y violations`, ...said].join(', ')} to ${file} (SARIF)`;
}

/**
 * Write a log made with `sarifLog`.
 * @param {string} path
 * @param {SarifLog} log
 */
export function writeSarifLog(path, log) {
  writeAtomic(path, `${JSON.stringify(log, null, 2)}\n`);
}

/**
 * Write the log; returns the number of results.
 * @param {string} path
 * @param {CheckRow[]} rows
 * @param {SarifOptions} [opts]
 */
export function writeSarif(path, rows, opts) {
  const log = sarifLog(rows, opts);
  writeSarifLog(path, log);
  return log.runs[0].results.length;
}
