/**
 * dashboard-check/gallery.mjs — what `pxsig dashboard check` writes for people to read
 * (dashboard-check.mjs): summary.md and the index.html gallery.
 */
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
 * summary.md: the counts, then every screen that failed or has axe violations.
 * @param {DashboardCheckReport} report
 */
export function summaryMarkdown(report) {
  const s = report.summary;
  const lines = [
    `## pxsig dashboard check — ${s.failed ? `${s.failed} of ${s.screens} screens failed` : `${s.rendered} of ${s.screens} screens rendered`}`,
    '',
    `Adapter build: \`${report.build}\` · contract ${report.contract.adapter} (this pxsig: ${report.contract.current}) · themes ${report.themes.join(', ')}`,
    `Reference: ${report.reference.used ? `\`${report.reference.dir}\`` : `not shown (${report.reference.note})`}`,
    '',
    '| Screens | Rendered | Failed | With axe violations |',
    '| --- | --- | --- | --- |',
    `| ${s.screens} | ${s.rendered} | ${s.failed} | ${s.withAxe}${report.strict ? ' (strict)' : ' (advisory)'} |`,
  ];
  const bad = report.screens.filter((x) => !x.rendered);
  if (bad.length)
    lines.push(
      '',
      '### Failed',
      '',
      ...bad.map((x) => `- \`${x.feature}\` #${x.index + 1} (${x.theme}): ${x.reason}`)
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
  const sections = [...groups.values()].map((xs) => {
    const f = xs[0];
    const cells = xs
      .map(
        (x) => `<figure class="${x.rendered ? 'ok' : 'bad'}">
  <figcaption>#${x.index + 1} · ${esc(x.theme)} · ${esc(x.scenario)} · ${x.rendered ? 'rendered' : esc(x.reason)}${x.axe.length ? ` · axe: ${esc(x.axe.map((v) => `${v.id} (${v.count})`).join(', '))}` : ''}${x.fallbacks?.length ? ` · fallbacks: ${esc(x.fallbacks.join(', '))}` : ''}</figcaption>
  <div class="pair">${img(x.shot, x.rendered ? 'adapter' : 'not rendered')}${report.reference.used ? img(x.referenceShot, 'reference not rendered') : ''}</div>
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
figure{margin:1rem 0;padding:.5rem;border:1px solid color-mix(in srgb,currentColor 20%,transparent)}figure.bad{border-color:#c62828}
figcaption{font-size:.85rem;margin-block-end:.5rem}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:.5rem}
.pair img{inline-size:100%;block-size:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent)}.none{opacity:.7}
</style></head><body>
<h1>pxsig dashboard check</h1>
<p>${esc(report.summary.rendered)} of ${esc(report.summary.screens)} screens rendered · ${esc(report.summary.failed)} failed · ${esc(report.summary.withAxe)} with axe violations${report.strict ? ' (strict)' : ' (advisory)'}.</p>
<p>Left: the adapter build <code>${esc(report.build)}</code>. ${report.reference.used ? 'Right: the prebuilt reference dashboard.' : `No reference column: ${esc(report.reference.note)}.`}</p>
${sections.join('\n')}
</body></html>
`;
}
