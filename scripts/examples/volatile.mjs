/**
 * volatile.mjs — the masks step of examples-test.mjs (single-package): the Badge gains a value that
 * differs on every render, marked `data-volatile`. The first check fails exactly the Badge entries as
 * "masks changed" (nothing approves itself); once approved, renders whose value differs pass; a
 * `capture.ignore` mask over most of a capture is a warning in the output, summary.md and SARIF.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, projectStore, pxsig, tail } from './shared.mjs';
import { baselineAll, checkJson } from './steps.mjs';

/**
 * @param {string} dir
 * @param {string} p
 * @param {() => void} build rebuilds the example's Storybook
 */
export function volatileSteps(dir, p, build) {
  const b = baselineAll(dir, p);
  expect(
    b.summary.failed === 0,
    `masks: baselines re-taken before the change (${b.summary.stories})`
  );
  const badge = join(dir, 'src/Badge/Badge.jsx');
  const source = readFileSync(badge, 'utf8');
  writeFileSync(
    badge,
    source.replace(
      '{children}',
      `{children}
      <span data-volatile="build time" style={{ display: 'inline-block', width: '4ch', marginLeft: 4 }}>
        {String(Date.now() % 10000).padStart(4, '0')}
      </span>`
    )
  );
  build();
  let r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
  let rows = checkJson(dir, p).rows;
  const badges = rows.filter((x) => x.id.startsWith('components-badge--'));
  const changed = rows.filter((x) => (x.reasons ?? []).includes('masks changed: 1 added'));
  expect(
    r.status === 1 &&
      badges.length > 0 &&
      changed.length === badges.length &&
      changed.every((x) => !x.pass && x.id.startsWith('components-badge--')) &&
      badges.every(
        (x) =>
          x.masks?.length === 1 &&
          x.masks[0].source === 'attribute' &&
          x.masks[0].reason === 'build time'
      ),
    `masks: data-volatile fails exactly the ${badges.length} Badge entries as masks changed (${changed.length})${r.status === 1 ? '' : tail(r)}`
  );
  baselineAll(dir, p);
  r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
  rows = checkJson(dir, p).rows;
  expect(
    r.status === 0 && rows.every((x) => x.pass),
    `masks: approved once, renders with another value pass (${rows.filter((x) => x.pass).length}/${rows.length})${r.status ? tail(r) : ''}`
  );
  const file = join(dir, 'pxsig.config.json');
  const before = readFileSync(file, 'utf8');
  // The example's own config (pxsig.config.json).
  const cfg = /** @type {{ capture?: Record<string, unknown> }} */ (JSON.parse(before));
  writeFileSync(
    file,
    JSON.stringify(
      { ...cfg, capture: { ...cfg.capture, ignore: ['#storybook-root > *'] } },
      null,
      2
    )
  );
  try {
    const sarif = join(dir, 'masks.sarif');
    r = pxsig(['check', '--full', '--project', p, '--retries', '0', '--sarif', sarif], dir);
    rows = checkJson(dir, p).rows;
    const summary = readFileSync(
      join(dir, ...projectStore(dir, p), 'reports', 'summary.md'),
      'utf8'
    );
    // The SARIF log the check just wrote: the keys read.
    const log = existsSync(sarif)
      ? /** @type {{ runs: { results: { ruleId: string }[] }[] }} */ (
          JSON.parse(readFileSync(sarif, 'utf8'))
        )
      : null;
    const warned = log?.runs[0].results.filter((x) => x.ruleId === 'pxsig/large-mask');
    const large = rows.filter((x) => x.masksLarge?.length);
    expect(
      r.status === 1 &&
        large.length > 0 &&
        large.every((x) => x.masksChanged?.added.includes('#storybook-root > *')) &&
        /\[check\] mask: /.test(r.stderr) &&
        summary.includes('a mask over 25% of the capture') &&
        warned?.length === large.reduce((n, x) => n + (x.masksLarge?.length ?? 0), 0),
      `masks: a mask over most of a capture warns in the output, summary.md and SARIF (${warned?.length ?? 0} results)${r.status === 1 ? '' : tail(r)}`
    );
  } finally {
    writeFileSync(file, before);
    writeFileSync(badge, source);
  }
}
