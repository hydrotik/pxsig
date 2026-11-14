/**
 * dashboard-check/gallery.mjs — what `pxsig dashboard check` writes for people to read
 * (dashboard-check.mjs): summary.md and the index.html gallery.
 */
import { SETTLE_MS } from './capture.mjs';
/** @import { DashboardCheckReport, ScreenResult } from '../types/t4.js' */

export const esc = (/** @type {string | number | null | undefined} */ s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      // `c` is one of the five characters the pattern matches.
      /** @type {Record<string, string>} */ ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );

/**
 * summary.md: the counts, then every screen that failed, breaks a region rule, or has axe
 * violations, layout or alignment findings.
 * @param {DashboardCheckReport} report
 */
export function summaryMarkdown(report) {
  const s = report.summary;
  const mode = report.strict ? ' (strict)' : ' (advisory)';
  const lines = [
    `## pxsig dashboard check — ${s.failed ? `${s.failed} of ${s.screens} screens failed` : `${s.rendered} of ${s.screens} screens rendered`}`,
    '',
    `Adapter build: \`${report.build}\` · contract ${report.contract.adapter} (this pxsig: ${report.contract.current}) · themes ${report.themes.join(', ')}`,
    `Reference: ${report.reference.used ? `\`${report.reference.dir}\`` : `not shown (${report.reference.note})`}`,
    '',
    '| Screens | Rendered | Failed | Breaking a region rule | With axe violations | With layout findings | With alignment findings |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| ${s.screens} | ${s.rendered} | ${s.failed} | ${s.withFidelity} | ${s.withAxe}${mode} | ${s.withLayout}${mode} | ${s.withAlignment ?? 0}${mode} |`,
  ];
  const bad = report.screens.filter((x) => !x.rendered);
  if (bad.length)
    lines.push(
      '',
      '### Failed',
      '',
      ...bad.map((x) => `- \`${x.feature}\` #${x.index + 1} (${x.theme}): ${x.reason}`)
    );
  const broke = report.screens.filter((x) => x.fidelity.length);
  if (broke.length)
    lines.push(
      '',
      '### Region rules',
      '',
      'Rules an adapter may not change (docs/ui/build-adapter.md, "Region rules"). Each one fails the check.',
      '',
      ...broke.flatMap((x) => [
        `- \`${x.feature}\` #${x.index + 1} (${x.theme}):`,
        ...x.fidelity.map((f) => `  - ${f.rule}: ${f.text}`),
      ])
    );
  const moving = report.screens.filter((x) => x.settled === false);
  if (moving.length)
    lines.push(
      '',
      '### Still moving',
      '',
      `The layout had not held still after ${SETTLE_MS / 1000} s; these screenshots were taken anyway.`,
      '',
      ...moving.map((x) => `- \`${x.feature}\` #${x.index + 1} (${x.theme})`)
    );
  const retried = report.screens.filter((x) => x.retried);
  if (retried.length)
    lines.push(
      '',
      '### Retried',
      '',
      'The page load failed with a Windows socket error (ERR_NO_BUFFER_SPACE) and was retried once.',
      '',
      ...retried.map((x) => `- \`${x.feature}\` #${x.index + 1} (${x.theme})`)
    );
  const ax = report.screens.filter((x) => x.axe.length);
  if (ax.length)
    lines.push(
      '',
      '### Accessibility',
      '',
      ...ax.map(
        (x) =>
          `- \`${x.feature}\` #${x.index + 1} (${x.theme}): ${x.axe.map((v) => `${v.id} (${v.impact ?? 'n/a'}, ${v.count})`).join(', ')}`
      )
    );
  if (report.compare) {
    const changed = report.screens.filter((x) => x.compare?.status === 'changed');
    const added = report.screens.filter((x) => x.compare?.status === 'new');
    lines.push(
      '',
      '### Compared with the earlier check',
      '',
      `\`${report.compare.dir}\` (pxsig ${report.compare.pxsig}, build \`${report.compare.build}\`): ${changed.length} changed, ${added.length} new, ${report.compare.removed.length} gone. Advisory.`,
      ...(changed.length
        ? [
            '',
            ...changed.map(
              (x) =>
                `- changed: \`${x.feature}\` #${x.index + 1} (${x.theme}): ${x.compare?.reasons.join('; ')}`
            ),
          ]
        : []),
      ...(added.length
        ? ['', ...added.map((x) => `- new: \`${x.feature}\` #${x.index + 1} (${x.theme})`)]
        : []),
      ...(report.compare.removed.length
        ? ['', ...report.compare.removed.map((k) => `- gone: \`${k}\``)]
        : [])
    );
  }
  const lay = report.screens.filter((x) => x.layout.length);
  if (lay.length)
    lines.push(
      '',
      '### Layout',
      '',
      ...lay.flatMap((x) => [
        `- \`${x.feature}\` #${x.index + 1} (${x.theme}):`,
        ...x.layout.map((f) => `  - ${f.rule}: ${f.text}`),
      ])
    );
  const aligned = report.screens.filter((x) => x.alignment?.length);
  if (aligned.length)
    lines.push(
      '',
      '### Alignment',
      '',
      "Measured from the screenshot: a dot or icon centred on its label's capitals (within 0.5 px), and small components on whole pixels. Each names its cause.",
      '',
      ...aligned.flatMap((x) => [
        `- \`${x.feature}\` #${x.index + 1} (${x.theme}):`,
        ...x.alignment.map((f) => `  - ${f.rule}: ${f.text}`),
      ])
    );
  return `${lines.join('\n')}\n`;
}

/**
 * index.html: each screen on the adapter beside the reference, grouped by feature.
 * @param {DashboardCheckReport} report
 */
export function galleryHtml(report) {
  /** @type {Map<string, ScreenResult[]>} */
  const groups = new Map();
  for (const x of report.screens) groups.set(x.feature, [...(groups.get(x.feature) ?? []), x]);
  const img = (/** @type {string | null} */ src, /** @type {string} */ alt) =>
    src
      ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`
      : `<p class="none">${esc(alt)}</p>`;
  const compared = (/** @type {ScreenResult} */ x) =>
    !x.compare
      ? ''
      : x.compare.status === 'changed'
        ? ` · <strong>changed</strong> (SSIM ${esc(x.compare.ssim)}, ${esc(x.compare.changedCellsPct)}% cells)`
        : ` · ${esc(x.compare.status)}`;
  const sections = [...groups.values()].map((xs) => {
    const f = xs[0];
    const cells = xs
      .map(
        (
          x
        ) => `<figure class="${x.rendered ? 'ok' : 'bad'}${x.fidelity.length ? ' broke' : ''}${x.compare?.status === 'changed' ? ' changed' : ''}">
  <figcaption>#${x.index + 1} · ${esc(x.theme)} · ${esc(x.scenario)} · ${x.rendered ? 'rendered' : esc(x.reason)}${x.axe.length ? ` · axe: ${esc(x.axe.map((v) => `${v.id} (${v.count})`).join(', '))}` : ''}${x.fallbacks?.length ? ` · fallbacks: ${esc(x.fallbacks.join(', '))}` : ''}${x.fidelity.length ? ` · <strong>region rules: ${x.fidelity.length}</strong>` : ''}${x.layout.length ? ` · layout: ${x.layout.length}` : ''}${x.alignment?.length ? ` · alignment: ${x.alignment.length}` : ''}${compared(x)}</figcaption>${x.fidelity.length ? `\n  <details open><summary>Region rules broken</summary><ul>${x.fidelity.map((f) => `<li>${esc(f.rule)}: ${esc(f.text)}</li>`).join('')}</ul></details>` : ''}${x.layout.length ? `\n  <details><summary>Layout findings</summary><ul>${x.layout.map((f) => `<li>${esc(f.rule)}: ${esc(f.text)}</li>`).join('')}</ul></details>` : ''}${x.alignment?.length ? `\n  <details><summary>Alignment findings</summary><ul>${x.alignment.map((f) => `<li>${esc(f.rule)}: ${esc(f.text)}</li>`).join('')}</ul></details>` : ''}
  <div class="pair">${img(x.shot, x.rendered ? 'adapter' : 'not rendered')}${report.reference.used ? img(x.referenceShot, 'reference not rendered') : ''}${x.compare?.status === 'changed' ? `${img(x.compare.earlier, 'earlier')}${img(x.compare.diff, 'no diff image')}` : ''}</div>
</figure>`
      )
      .join('\n');
    return `<section><h2>${esc(f.title)} <code>${esc(f.feature)}</code></h2><p>${esc(f.purpose)}</p><p class="meta">Components: ${esc(f.components.join(', '))}</p>\n${cells}</section>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>pxsig dashboard check</title>
<style>
:root{color-scheme:light dark;font:14px/1.45 system-ui,sans-serif}body{margin:0 auto;padding:1rem;max-inline-size:120rem}
h1{font-size:1.25rem}h2{font-size:1rem;margin-block:2rem .25rem}p{margin-block:.25rem;max-inline-size:80ch}.meta{opacity:.7}
figure{margin:1rem 0;padding:.5rem;border:1px solid color-mix(in srgb,currentColor 20%,transparent)}figure.bad,figure.broke{border-color:#c62828}
figcaption{font-size:.85rem;margin-block-end:.5rem}details{font-size:.85rem;margin-block-end:.5rem}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:.5rem}
body.only-changed figure:not(.changed),body.only-changed section:not(:has(figure.changed)){display:none}
.pair img{inline-size:100%;block-size:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent)}.none{opacity:.7}
</style></head><body>
<h1>pxsig dashboard check</h1>
<p>${esc(report.summary.rendered)} of ${esc(report.summary.screens)} screens rendered · ${esc(report.summary.failed)} failed · ${esc(report.summary.withFidelity)} breaking a region rule · ${esc(report.summary.withAxe)} with axe violations · ${esc(report.summary.withLayout)} with layout findings · ${esc(report.summary.withAlignment ?? 0)} with alignment findings${report.strict ? ' (strict)' : ' (advisory)'}.</p>
<p>Left: the adapter build <code>${esc(report.build)}</code>. ${report.reference.used ? 'Right: the prebuilt reference dashboard.' : `No reference column: ${esc(report.reference.note)}.`}</p>
${
  report.compare
    ? `<p>Compared with <code>${esc(report.compare.dir)}</code> (pxsig ${esc(report.compare.pxsig)}): ${esc(report.compare.changed)} changed${report.compare.removed.length ? `, ${esc(report.compare.removed.length)} gone` : ''}. A changed screen shows the earlier screenshot and the changed pixels after its own. <label><input type="checkbox" onchange="document.body.classList.toggle('only-changed', this.checked)"> Changed screens only</label></p>`
    : ''
}
${sections.join('\n')}
</body></html>
`;
}
