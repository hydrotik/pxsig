/**
 * lib/rejections/markdown.mjs — rejection.md: a rejection packet's facts (rejection.json) for a
 * person and an assistant. Facts first, then the goal, the reason, what changed and where (the
 * crops), the text labels, the structure against its lock where one is configured, the checks
 * since, and always the re-check command (the spike's wording D).
 *
 * Paths are packet-relative (crops, images), workspace-relative (the baseline file) or
 * store-relative: never absolute. A reason is the reviewer's own text: it appears only inside a
 * fenced `text` block whose fence is longer than any run of backticks in it, so it can never
 * become Markdown or HTML. Every other value that goes into a table cell is escaped.
 */
import { lead } from '../rejections.mjs';
import { GOAL, NEVER_APPROVE, NO_REASON, recheck, viaLabel } from './prompt.mjs';
/** @import { PacketFacts } from '../../types/rejections.js' */

/**
 * A fenced `text` block of one line, safe whatever the line holds.
 * @param {string} text
 * @param {string} [indent]
 */
export function fenced(text, indent = '') {
  const run = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, run + 1));
  return [`${indent}${fence}text`, `${indent}${text}`, `${indent}${fence}`];
}

/**
 * A table cell: one line, `\\`, `|` and `<` escaped (no HTML), `—` when empty.
 * @param {string | number | null | undefined} v
 */
export const cell = (v) =>
  v == null || v === ''
    ? '—'
    : String(v)
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\\|<]/g, (c) => `\\${c}`);

/** @param {number | null | undefined} v */
const pct = (v) => (v == null ? '—' : `${Number(v.toFixed(2))}%`);

/**
 * @param {PacketFacts} f
 * @returns {string[]}
 */
function head(f) {
  return [
    `# Rejected: ${f.id}`,
    '',
    `- Project: ${cell(f.project)} · Story: ${cell(f.story)} · Mode: ${cell(f.mode)} · State: ${cell(f.state)}`,
    `- Rejected: ${f.at} through ${viaLabel(f.via)} · Decision: ${f.ref}`,
    `- Goal: ${GOAL[f.kind]}.`,
    '',
    '## Reason',
    '',
    ...fenced(f.note ?? NO_REASON),
    '',
    ...earlier(f),
  ];
}

/**
 * The reasons before the leading one, newest first, each in its own fence.
 * @param {PacketFacts} f
 */
function earlier(f) {
  const first = f.notes.length ? lead(f.notes) : null;
  const shown = f.notes.filter((n) => n !== first);
  if (!shown.length) return [];
  return [
    'Earlier reasons, newest first:',
    '',
    ...shown.flatMap((n) => [
      `- ${n.at}, through ${viaLabel(n.via)}:`,
      '',
      ...fenced(n.note ?? NO_REASON, '  '),
      '',
    ]),
  ];
}

/** @param {PacketFacts} f */
function visual(f) {
  const out = [];
  const m = f.metrics;
  if (m)
    out.push(
      '## What changed',
      '',
      '| SSIM | Changed cells | Changed pixels | Max delta | Regions | Gate |',
      '| --- | --- | --- | --- | --- | --- |',
      `| ${cell(m.ssim)} | ${pct(m.changedCellsPct)} | ${m.changedPx} | ${m.maxDelta} | ${m.regions} | ${cell(m.gate.join('; '))} |`,
      ''
    );
  if (!f.images.baseline)
    out.push('No baseline image: the entry is new, or its baseline has no image section.', '');
  if (f.regions.length) {
    out.push(
      '## Changed regions (full-size pixels, largest first)',
      '',
      '| # | x, y | w × h | Changed px | Crops |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const c of f.regions)
      out.push(
        `| ${c.n} | ${c.x}, ${c.y} | ${c.w} × ${c.h} | ${c.px} | ${
          c.files
            ? `${c.files.baseline} · ${c.files.current} · ${c.files.diff} (${c.scale}×)`
            : `region ${c.n} too large to crop: see current.png`
        } |`
      );
    out.push(
      '',
      'Each crop is padded around its changed areas, which are listed in rejection.json (`regions[].areas`).',
      ''
    );
  } else if (f.images.baseline)
    out.push('No changed pixels between baseline.png and current.png.', '');
  if (f.text.length)
    out.push(
      '## Text',
      '',
      ...f.text.map((l) => `- ${cell(l)}`),
      '',
      'Labels only. The gate and the decision are unchanged.',
      ''
    );
  const images = [
    f.images.baseline && `baseline.png (from ${f.baseline})`,
    f.images.current,
    f.images.mask,
  ].filter(Boolean);
  if (images.length) out.push('## Images', '', images.join(' · '), '');
  return out;
}

/** @param {PacketFacts} f */
function a11y(f) {
  const v = f.violations ?? [];
  const out = ['## New violations', ''];
  if (!v.length) out.push('None in the latest check.', '');
  else {
    out.push('| Rule | Impact | Nodes | Targets | Help |', '| --- | --- | --- | --- | --- |');
    for (const x of v)
      out.push(
        `| ${cell(x.id)} | ${cell(x.impact)} | ${x.nodes ?? '—'} | ${cell((x.targets ?? []).join(', '))} | ${cell(x.help)} |`
      );
    out.push('');
  }
  if (f.images.current) out.push('## Images', '', f.images.current, '');
  return out;
}

/** @param {PacketFacts} f */
function checks(f) {
  const out = ['## Checks since the rejection', ''];
  if (!f.checks.length) return [...out, 'None yet.', ''];
  out.push(
    f.kind === 'visual' ? '| At | Result | SSIM |' : '| At | Result | New violations |',
    '| --- | --- | --- |'
  );
  for (const c of f.checks)
    out.push(
      `| ${c.at} | ${c.pass ? 'pass' : 'still differs'} | ${cell(f.kind === 'visual' ? c.ssim : c.new)} |`
    );
  return [...out, ''];
}

/**
 * rejection.md for a packet's facts.
 * @param {PacketFacts} f
 */
export function rejectionMarkdown(f) {
  const pass =
    f.kind === 'visual'
      ? 'A pass closes this rejection. A render that still differs refreshes current.png and the crops'
      : 'A check with no new violations closes this rejection. One that still has them refreshes this packet';
  return `${[
    ...head(f),
    ...(f.kind === 'visual' ? visual(f) : a11y(f)),
    ...(f.structure ? ['## Structure', '', `Against its lock: ${cell(f.structure)}`, ''] : []),
    ...checks(f),
    '## After the fix',
    '',
    `Run \`${recheck(f.id)}\` (MCP: \`pxsig_check\` with \`ids\`). ${pass}, and the entry waits for the reviewer again. ${NEVER_APPROVE}`,
  ].join('\n')}\n`;
}
