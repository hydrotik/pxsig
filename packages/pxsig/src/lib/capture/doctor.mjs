/**
 * lib/capture/doctor.mjs — what `pxsig doctor` says about masks (masks.mjs). Information only,
 * never the exit:
 *
 *   attribute  every `[data-volatile]` element is masked wherever it renders; a component sets it,
 *              so it is not listed here (each render's record names the ones that applied)
 *   config     each `capture.ignore` / `capture.addIgnore` selector with its layer, as
 *              `pxsig config` names it
 *   baselines  how many of the manifest's baselines record masks (a header `masks`)
 *
 * Story masks (`parameters.pxsig.ignore`) are per story: the render's record has them too.
 */
import { baselineFacts } from '../baseline-facts.mjs';
import { ATTRIBUTE } from './masks.mjs';
/** @import { Project } from '../../types.js' */
/** @import { SigFacts } from '../integrity/sig-read.mjs' */
/** @import { Block } from '../../types/t6.js' */
/** @import { Mask } from './masks.mjs' */

/** The layer of a config mask, in the words `pxsig config` uses. */
export const MASK_LAYERS = { workspace: 'workspace defaults', project: 'project config' };

/**
 * The masks in force for a project, and the baselines that record masks.
 * @param {Project} P
 * @param {SigFacts[]} [facts] the manifest's baselines (baseline-facts.mjs)
 */
export function maskFindings(P, facts = baselineFacts(P)) {
  const baselines = facts.length;
  const recorded = facts.filter((f) => f.masks).length;
  return {
    attribute: `[${ATTRIBUTE}]`,
    note: 'masked wherever it renders: a component sets it, so it is not listed per project',
    config: P.masks.map((x) => ({
      selector: x.selector,
      source: x.source,
      layer: MASK_LAYERS[/** @type {'workspace' | 'project'} */ (x.source)],
    })),
    baselines,
    recorded,
  };
}

/**
 * The config masks as a heading and a table (`pxsig config`, `pxsig doctor`); none without any.
 * @param {Mask[]} masks
 * @returns {Block[]}
 */
export const maskTable = (masks) =>
  masks.length
    ? [
        { h: 'Masks', sub: `besides every [${ATTRIBUTE}] element and the stories’ own` },
        {
          table: {
            cols: [
              { key: 'selector', label: 'Selector' },
              { key: 'from', label: 'Set by' },
            ],
            rows: masks.map((x) => ({
              selector: x.selector,
              from: MASK_LAYERS[/** @type {'workspace' | 'project'} */ (x.source)],
            })),
          },
        },
      ]
    : [];

/**
 * The doctor's Masks line.
 * @param {ReturnType<typeof maskFindings>} f
 */
export function maskLine(f) {
  const n = f.config.length;
  return [
    `${f.attribute} wherever it renders`,
    `${n} ${n === 1 ? 'selector' : 'selectors'} from config`,
    `${f.recorded} of ${f.baselines} baselines record masks`,
  ].join(' · ');
}
