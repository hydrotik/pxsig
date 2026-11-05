/**
 * renders.mjs — the render-counting step of examples-test.mjs (single-package): with
 * `react.renders` on, the same baselines still pass (the hook changes no pixel), every row counts
 * React's commits in the static build, and `--no-react` turns the counting off again.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, pxsig, tail } from './shared.mjs';
import { checkJson } from './steps.mjs';

/**
 * @param {string} dir
 * @param {string} p
 */
export function rendersSteps(dir, p) {
  const file = join(dir, 'pxsig.config.json');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(before), react: { renders: true } }, null, 2));
  try {
    let r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
    const on = checkJson(dir, p);
    expect(
      r.status === 0 && on.rows.every((x) => x.pass),
      `renders on: the same baselines pass (${on.rows.filter((x) => x.pass).length}/${on.rows.length})${r.status ? tail(r) : ''}`
    );
    const counted = on.rows.filter(
      (x) =>
        x.renders?.v === 1 &&
        x.renders.build === 'production' &&
        String(x.renders.react).startsWith('19.') &&
        x.renders.mount.commits >= 1 &&
        (x.renders.mount.rendered ?? 0) >= 1 &&
        x.renders.settled
    );
    expect(
      counted.length === on.rows.length && on.summary.renderAlerts === 0,
      `renders on: every row counts React's commits, none still rendering (${counted.length}/${on.rows.length}, ${on.summary.renderAlerts} alerts)`
    );
    r = pxsig(['check', '--full', '--project', p, '--retries', '0', '--no-react'], dir);
    const off = checkJson(dir, p);
    expect(
      r.status === 0 &&
        off.rows.every((x) => !('renders' in x)) &&
        !('renderAlerts' in off.summary),
      `--no-react: no row counts renders${r.status ? tail(r) : ''}`
    );
  } finally {
    writeFileSync(file, before);
  }
}
