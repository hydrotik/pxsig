/**
 * lib/gate-report/text.mjs — the gate report's words: the text in the shape of the issue form
 * `.github/ISSUE_TEMPLATE/gate.yml` (one `###` section per field, in its order), and the URL that
 * opens that form with the fields filled (`?template=gate.yml&<field id>=…`).
 *
 * Built from the report's facts only (lib/gate-report.mjs): numbers, the gate's own reason lines,
 * classes of environment. No path, user name or host name is ever among them.
 */
/** @import { GateFacts } from '../gate-report.mjs' */

/** Where the form is. pxsig never opens it: the person does, in a browser. */
export const ISSUE_BASE = 'https://github.com/hydrotik/pxsig/issues/new';
/** The longest URL handed out: browsers and GitHub refuse much longer ones. */
export const MAX_URL = 8000;
/** Said at the end of a field cut to fit the URL. */
export const TRIMMED = '… (trimmed to fit the link: the copied text has all of it)';

/** @param {unknown} v */
const num = (v) =>
  typeof v === 'number'
    ? String(Math.round(v * 10000) / 10000)
    : v == null
      ? 'off'
      : typeof v === 'string' || typeof v === 'boolean'
        ? String(v)
        : JSON.stringify(v);

/**
 * `key value · key value` for an object's plain values; nested objects are left out.
 * @param {Record<string, unknown> | null | undefined} o
 */
const pairs = (o) =>
  Object.entries(o ?? {})
    .filter(([, v]) => v === null || typeof v !== 'object')
    .map(([k, v]) => `${k} ${num(v)}`)
    .join(' · ');

/**
 * Each field of the form, by its id, as the report fills it.
 * @param {GateFacts} f
 * @returns {Record<'version' | 'entry' | 'gate' | 'metrics' | 'reasons' | 'regions' | 'environment', string>}
 */
export function fields(f) {
  const m = f.metrics ?? {};
  const pix = f.pixels;
  const metrics = [
    `verdict: ${f.verdict === 'fails' ? 'fails the gate' : 'passes the gate'}`,
    pairs(m),
    f.color ? `color: ${pairs(f.color)}` : 'color: did not run',
    f.detail ? `detail: ${pairs(f.detail)}` : null,
    `pixels: ${pix.changed} changed of ${pix.width}×${pix.height} · max delta ${pix.maxDelta} · ${pix.regions} ${pix.regions === 1 ? 'region' : 'regions'}`,
  ].filter((x) => x != null && x !== '');
  const more = pix.regions - f.regions.length;
  const regions = f.regions.map(
    (r, i) =>
      `${i + 1}. x ${r.x}, y ${r.y} · ${r.w}×${r.h} · ${r.px} px` +
      (r.baseline ? ` · baseline ${r.baseline} → render ${r.render}` : '')
  );
  if (more > 0) regions.push(`… and ${more} smaller ${more === 1 ? 'region' : 'regions'}`);
  const env = f.environment;
  return {
    version: `pxsig ${f.pxsig} · engine ${f.engine ?? 'unknown'}`,
    entry: [f.entry, f.mode ? `mode ${f.mode}` : null, f.state ? `state ${f.state}` : null]
      .filter(Boolean)
      .join(' · '),
    gate: JSON.stringify(f.gate ?? null, null, 2),
    metrics: metrics.join('\n'),
    reasons: f.reasons.length ? f.reasons.map((r) => `- ${r}`).join('\n') : 'None: it passed.',
    regions: regions.length ? regions.join('\n') : 'None: the images are the same pixel for pixel.',
    environment: [
      `render: ${env.render ?? 'unknown'}`,
      `baseline: ${env.baseline ?? 'unknown'}`,
      `environments ${env.match}`,
    ].join(' · '),
  };
}

/**
 * What the Images section says: how the composite was made, or that there is none.
 * @param {GateFacts} f
 */
export function imageLine(f) {
  const i = f.image;
  if (!i) return 'None: an image-free report. The average colors are under Changed regions.';
  const what =
    i.crop === 'full'
      ? 'the full capture'
      : `cropped to the changed regions with a ${i.margin} px margin${i.scale > 1 ? `, at ${i.scale}×` : ''}`;
  return `One PNG, ${i.width}×${i.height}: baseline | render | diff, ${what}. Pasted below.`;
}

/**
 * The report's text: the form's sections, in its order, ready to paste.
 * @param {GateFacts} f
 */
export function gateText(f) {
  const v = fields(f);
  /** @param {string} s */
  const block = (s, lang = 'text') => `\`\`\`${lang}\n${s}\n\`\`\``;
  return `${[
    '### pxsig version and engine build',
    v.version,
    '### Entry and mode',
    v.entry,
    '### Gate settings',
    block(v.gate, 'json'),
    '### Metrics',
    block(v.metrics),
    '### Reasons',
    block(v.reasons),
    '### Changed regions',
    block(v.regions),
    '### Environment class',
    v.environment,
    '### Images',
    imageLine(f),
  ].join('\n\n')}\n`;
}

/**
 * The form's link with the fields filled, within MAX_URL: the longest field is cut (whole lines
 * first) and ends with TRIMMED until the link fits. Answers the link and the fields that were cut.
 * @param {GateFacts} f
 * @param {{ max?: number }} [opts]
 * @returns {{ url: string, trimmed: string[] }}
 */
export function issueUrl(f, { max = MAX_URL } = {}) {
  /** @type {Record<string, string>} */
  const v = { ...fields(f) };
  /** @type {Set<string>} */
  const trimmed = new Set();
  const build = () =>
    `${ISSUE_BASE}?${new URLSearchParams({ template: 'gate.yml', ...v }).toString()}`;
  let url = build();
  while (url.length > max) {
    const [k, s] = Object.entries(v).sort((a, b) => b[1].length - a[1].length)[0];
    const body = s.endsWith(TRIMMED) ? s.slice(0, -TRIMMED.length).trimEnd() : s;
    const lines = body.split('\n');
    const cut =
      lines.length > 1
        ? lines.slice(0, Math.ceil(lines.length / 2) - (lines.length === 2 ? 1 : 0)).join('\n')
        : body.slice(0, Math.floor(body.length / 2));
    v[k] = `${cut}\n${TRIMMED}`;
    trimmed.add(k);
    if (!cut.length && v[k].length >= s.length) break;
    url = build();
  }
  return { url, trimmed: [...trimmed] };
}
