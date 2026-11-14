/**
 * dashboard-check/gate-report.mjs — the Report to pxsig answer of `pxsig dashboard check`'s server
 * and the flows tests: a sample report's facts (the dashboard's fixtures/gate-report.mjs) made into
 * the text, the issue link and the composite with the gate report's own code
 * (lib/gate-report/), from the sample images.
 */
import { PNG } from 'pngjs';
import { composite } from '../lib/gate-report/image.mjs';
import { gateText, issueUrl } from '../lib/gate-report/text.mjs';
/** @import { GateFacts } from '../lib/gate-report.mjs' */
/** @import { SampleImages } from '../types/t4.js' */

/**
 * `GET /__pxsig/gate-report`'s answer for sample facts.
 * @param {GateFacts} facts
 * @param {SampleImages} images
 */
export function sampleGateReport(facts, images) {
  const { url, trimmed } = issueUrl(facts);
  let image = null;
  if (facts.image) {
    const baseline = PNG.sync.read(images.baseline);
    const current = PNG.sync.read(images.render);
    const mask = new PNG({ width: baseline.width, height: baseline.height });
    for (let i = 0; i < baseline.data.length; i += 4)
      if (
        baseline.data[i] !== current.data[i] ||
        baseline.data[i + 1] !== current.data[i + 1] ||
        baseline.data[i + 2] !== current.data[i + 2]
      )
        mask.data[i + 3] = 255;
    const { png } = composite({ baseline, current, mask }, facts.image.box, facts.image.scale);
    image = `data:image/png;base64,${png.toString('base64')}`;
  }
  return { text: gateText(facts), url, trimmed, facts, image };
}
