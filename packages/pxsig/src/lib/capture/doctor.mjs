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
import { resolve } from 'node:path';
import { readJson } from '../files.mjs';
import { readHeader } from '../psig.mjs';
import { ATTRIBUTE } from './masks.mjs';
/** @import { Project } from '../../types.js' */
/** @import { Block } from '../../types/t6.js' */
/** @import { Mask } from './masks.mjs' */

/** The layer of a config mask, in the words `pxsig config` uses. */
export const MASK_LAYERS = { workspace: 'workspace defaults', project: 'project config' };

/**
 * The masks in force for a project, and the baselines that record masks.
 * @param {Project} P
 */
export function maskFindings(P) {
  // The committed manifest (pxsig's own file): every entry's baseline path, workspace-relative.
  const m = /** @type {{ stories?: { sig?: string }[] } | null} */ (
    readJson(P.manifestPath(), null)
  );
  let baselines = 0;
  let recorded = 0;
  for (const e of m?.stories ?? []) {
    if (!e.sig?.endsWith('.psig')) continue;
    const h = readHeader(resolve(P.workspaceRoot, e.sig));
    if (!h) continue;
    baselines++;
    if (h.masks?.masks?.length) recorded++;
  }
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
