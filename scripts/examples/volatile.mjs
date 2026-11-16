/**
 * volatile.mjs — the masks step of examples-test.mjs (single-package): the Badge gains a value that
 * differs on every render, marked `data-volatile`. The first check fails exactly the Badge entries as
 * "masks changed" (nothing approves itself); the engine's `baseline` refuses those entries without
 * `--allow-masks`, and names them; once approved, renders whose value differs pass, identical to
 * their baselines (the mask covers all of the value); a
 * `capture.ignore` mask over the whole component fails each entry, no baseline is written from it
 * even with `--allow-masks`, and the output, summary.md and SARIF (an error) say so; a value that
 * paints past its box fails each entry as content outside its box.
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
  // The value's box holds all of its text: four monospace digits and the Badge's letter-spacing.
  // A fixed `width: 4ch` did not (each digit is 1ch plus the letter-spacing), so the last digit
  // painted 3px past the box, outside the mask, and some values tripped the gate (2026-11-14).
  writeFileSync(badge, valued(source));
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
  // Mask audit 11: the engine's `baseline` no longer writes a masks change unnamed.
  const refused = baselineAll(dir, p);
  expect(
    refused.summary.failed === badges.length &&
      refused.errors.every((e) =>
        /masks changed \(1 added: \[data-volatile="build time"\]\)/.test(e)
      ),
    `masks: without --allow-masks the ${badges.length} Badge baselines are refused and named (${refused.summary.failed})`
  );
  const allowed = baselineAll(dir, p, { allowMasks: true });
  expect(
    allowed.summary.failed === 0 && allowed.masksChanged?.length === badges.length,
    `masks: with --allow-masks they are written, each named (${allowed.masksChanged?.length ?? 0})`
  );
  r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
  rows = checkJson(dir, p).rows;
  expect(
    r.status === 0 && rows.every((x) => x.pass),
    `masks: approved once, renders with another value pass (${rows.filter((x) => x.pass).length}/${rows.length})${r.status ? tail(r) : ''}`
  );
  // Passing is not enough: a value that paints past its mask passes or fails by which value it
  // is. With the mask over all of it, the render is the baseline's, byte for byte.
  const leaks = rows.filter((x) => x.id.startsWith('components-badge--') && x.differs !== false);
  expect(
    leaks.length === 0,
    `masks: another value renders identical to its baseline, nothing painted outside the mask (${badges.length - leaks.length}/${badges.length})${leaks.map((x) => `\n    ${x.id}: differs ${x.differs}`).join('')}`
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
      ? /** @type {{ runs: { results: { ruleId: string, level: string }[] }[] }} */ (
          JSON.parse(readFileSync(sarif, 'utf8'))
        )
      : null;
    const limit = log?.runs[0].results.filter(
      (x) => x.ruleId === 'pxsig/mask-limit' && x.level === 'error'
    );
    const blocked = rows.filter((x) => x.masksBlocked);
    // Decision 2: a mask over the whole component fails the entry, and no approval passes it.
    expect(
      r.status === 1 &&
        blocked.length === rows.length &&
        blocked.every(
          (x) =>
            !x.pass &&
            x.masksChanged?.added.includes('#storybook-root > *') &&
            (x.reasons ?? []).some((y) =>
              /^masks cover \d+(\.\d)?% of the capture, over 50%$/.test(y)
            )
        ) &&
        /\[check\] mask: .*no approval passes it/.test(r.stderr) &&
        summary.includes('on masks no approval passes until they are smaller') &&
        limit?.length === blocked.length,
      `masks: a mask over the whole component fails every entry, in the output, summary.md and SARIF (${blocked.length}/${rows.length}, coverage ${[...new Set(rows.map((x) => x.masksCoverage))].join(', ')}, ${limit?.length ?? 0} errors)${r.status === 1 ? '' : tail(r)}`
    );
    const none = baselineAll(dir, p, { allowMasks: true });
    expect(
      none.summary.failed === rows.length &&
        none.errors.every((e) => e.includes('no approval writes this baseline')),
      `masks: no baseline is written from them, --allow-masks or not (${none.summary.failed} refused)`
    );
    writeFileSync(file, before);
    // The flake's own case, kept: a box 4ch wide under the letter-spacing. Its last digit paints
    // past the box, so the entry fails as content outside the box, whatever the value, and no
    // approval passes it.
    writeFileSync(badge, valued(source, "width: '4ch', "));
    build();
    r = pxsig(['check', '--full', '--project', p, '--retries', '0'], dir);
    rows = checkJson(dir, p).rows;
    const leaking = rows.filter(
      (x) =>
        x.masksBlocked &&
        (x.reasons ?? []).some((y) =>
          y.startsWith('mask content outside its box: span[data-volatile="build time"]: ')
        )
    );
    expect(
      r.status === 1 &&
        leaking.length === badges.length &&
        leaking.every((x) => x.id.startsWith('components-badge--')),
      `masks: a value painting past its box fails each Badge entry as content outside its box (${leaking.length}/${badges.length})${r.status === 1 ? '' : tail(r)}`
    );
  } finally {
    writeFileSync(file, before);
    writeFileSync(badge, source);
  }
}

/**
 * The Badge with a value that differs on every render, marked `data-volatile`.
 * @param {string} source the Badge's source
 * @param {string} [style] more of the value's style, before the rest
 */
const valued = (source, style = '') =>
  source.replace(
    '{children}',
    `{children}
      <span data-volatile="build time" style={{ ${style}display: 'inline-block', marginLeft: 4 }}>
        {String(Date.now() % 10000).padStart(4, '0')}
      </span>`
  );
