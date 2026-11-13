/**
 * tools/report.mjs — pxsig_gate_report: a gate report for one entry (lib/gate-report.mjs), for
 * when the gate got it wrong. It writes the text, the composite image (or the image-free summary)
 * and report.json to the store's git-ignored reports/gate-report/<id>/, and answers the text, the
 * folder (store-relative) and the link that opens the issue form with the fields filled.
 *
 * It never posts, and opens no network connection: a GitHub issue is public and cannot be fully
 * removed, so the person reviews the images and posts it themselves. `pxsig report <id>` runs this
 * tool in-process. No answer holds an absolute path, a user name or (by default) the story id.
 */
import { gateReport, GateReportError, writeGateReport } from '../lib/gate-report.mjs';
import { relPath } from '../lib/paths.mjs';
import { engineDiff } from '../lib/rejections/packet.mjs';
import { ctxOf, ID_RE, PROJECT } from './context.mjs';

/** Said with every report: what the person decides, and that nothing was posted. */
export const ASK_FIRST =
  'Nothing was posted. The report goes in a public GitHub issue on hydrotik/pxsig: anyone can see it, and it cannot be fully removed. Ask the person before anything is posted: they check that the images show nothing confidential, open the link and post it themselves.';

/** @typedef {{ project?: string, id: string, full?: boolean, keepId?: boolean, noImage?: boolean }} GateReportArgs */

export const reportTools = /** @type {const} */ ([
  {
    name: 'pxsig_gate_report',
    description:
      "Prepares a gate report for one entry, for an issue on hydrotik/pxsig when the gate got it wrong (a change flagged when nothing changed, or one it missed). Writes the text, one image (baseline | render | diff, cropped to the changed regions; `full`: the whole capture) or with `noImage` the changed regions and their average colors instead, to the store's reports/gate-report/<id>/, and returns the text, the folder (relative to the store) and the link to the prefilled issue form. The story id is replaced with entry-1 unless `keepId`. Never posts anything: the issue is public and cannot be fully removed, so ask the person before anything is posted; the person checks the images and posts it.",
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        id: { type: 'string', description: 'The entry id.' },
        full: { type: 'boolean', default: false, description: 'The full capture, not the crop.' },
        keepId: {
          type: 'boolean',
          default: false,
          description: 'Keep the story id (default: replaced with entry-1).',
        },
        noImage: {
          type: 'boolean',
          default: false,
          description: 'No image: the changed regions and their average colors instead.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    /** @param {GateReportArgs} args */
    async run({ project, id, full = false, keepId = false, noImage = false }) {
      if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`bad id: ${id}`);
      const C = ctxOf(project);
      try {
        const r = await gateReport(C.P, id, {
          full: !!full,
          keepId: !!keepId,
          noImage: !!noImage,
          diff: engineDiff(C.P.rustBin),
        });
        const w = writeGateReport(C.P, id, r);
        return {
          project: C.P.name,
          id,
          store: relPath(C.root, C.P.store.root),
          folder: w.folder,
          files: w.files,
          image: r.image ? `${w.folder}image.png` : null,
          url: r.url,
          trimmed: r.trimmed,
          text: r.text,
          note: ASK_FIRST,
        };
      } catch (e) {
        if (e instanceof GateReportError) throw new Error(e.message);
        throw e;
      }
    },
  },
]);
