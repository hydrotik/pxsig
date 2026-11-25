/**
 * Rule L (layer integrity), run by `pnpm ui:check` beside ds-reach.mjs (ui-tools.mjs `checkAll`,
 * part 3). The theme layer, src/styles/theme-layer.css.ts, holds every dashboard rule that changes
 * how a design-system element looks, and the declared exceptions on the dashboard's own markup;
 * src/styles/theme-layer.json declares each one. The two say the same thing:
 *   - every export of the sheet has exactly one entry (by `export`) and every entry an export, and
 *     the export carries its entry's `// <id> <name>` comment;
 *   - an entry's `properties` are the export's keys, selectors flattened (`&:hover.borderColor`), so
 *     a rule cannot grow without its declaration changing; a global entry's export is its selector
 *     and its keys are the globalStyle's;
 *   - `decision` is an integer (`seeAlso`, when present, a list of them); `crops` name crop sets'
 *     items (`<set>/<item>`), and may be empty only with `noCrop` saying why;
 *   - each `baselines` id is a committed entry under .pxsig/baselines/ (`<section>/<id>@<theme>`),
 *     and the list may be empty only with `noBaseline` saying why;
 *   - each `target.where` file exists under src/ and uses the export.
 * Plain data and functions over source text: the check needs no build.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { balanced, LAYER_FILE, uncomment } from './ds-reach.mjs';

/** The layer's declarations, under src/. */
export const LAYER_JSON = 'styles/theme-layer.json';

const FIELDS = [
  'id',
  'name',
  'export',
  'target',
  'properties',
  'changes',
  'reason',
  'decision',
  'crops',
  'baselines',
  'a11y',
];

/** The top-level `[key, value]` pairs of an object literal's source (`a: 1, 'b': x, c`). */
export function entriesOf(/** @type {string} */ body) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  /** @type {[string, string][]} */
  const out = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = /^(?:'([^']*)'|"([^"]*)"|([\w$-]+))\s*(?::\s*([\s\S]*))?$/.exec(p);
    if (!m) out.push([p, '']);
    else out.push([m[1] ?? m[2] ?? m[3], (m[4] ?? m[3] ?? '').trim()]);
  }
  return out;
}

/** An object literal's keys, `selectors` and `@` blocks flattened to `<selector>.<key>`. */
export function flatKeys(/** @type {string} */ body) {
  /** @type {string[]} */
  const keys = [];
  for (const [k, v] of entriesOf(body)) {
    if ((k === 'selectors' || k.startsWith('@')) && v.startsWith('{'))
      for (const [sel, inner] of entriesOf(v.slice(1, -1))) {
        if (!inner.startsWith('{')) keys.push(`${sel}.${inner}`);
        else for (const [key] of entriesOf(inner.slice(1, -1))) keys.push(`${sel}.${key}`);
      }
    else keys.push(k);
  }
  return keys;
}

/**
 * The layer sheet's exports: name → its comment's id and name, and its keys (`null`: neither a
 * plain `style({...})` nor a selector with its globalStyle, so it cannot be read).
 */
export function readLayer(/** @type {string} */ text) {
  /** @type {Map<string, { id: string | null, name: string | null, keys: string[] | null }>} */
  const out = new Map();
  const code = uncomment(text);
  for (const m of code.matchAll(/^export const (\w+)\s*=\s*/gm)) {
    const rest = code.slice((m.index ?? 0) + m[0].length);
    /** @type {string[] | null} */
    let keys = null;
    if (rest.startsWith('style({')) keys = flatKeys(balanced(rest, rest.indexOf('{')));
    else if (/^['"`]/.test(rest)) {
      const call = new RegExp(`globalStyle\\(\\s*${m[1]}\\s*,\\s*`).exec(code);
      const at = (call?.index ?? 0) + (call?.[0].length ?? 0);
      if (call && code[at] === '{') keys = flatKeys(balanced(code, at));
    }
    // Its comment: the `// <id> <name>` line that opens the comment block right above it.
    const mark = new RegExp(
      `^// (L\\d+) ([\\w-]+)\\b.*\\n(?://.*\\n)*export const ${m[1]}\\b`,
      'm'
    ).exec(text);
    out.set(m[1], { id: mark?.[1] ?? null, name: mark?.[2] ?? null, keys });
  }
  return out;
}

/**
 * Rule L's problems for the dashboard source folder `src` (empty: the layer and its declarations
 * agree). `baselines` is the store's baselines folder. No layer at all is no problem.
 * @param {string} src
 * @param {string} baselines
 */
export function themeLayerProblems(src, baselines) {
  const sheetFile = path.join(src, LAYER_FILE);
  const jsonFile = path.join(src, LAYER_JSON);
  if (!existsSync(sheetFile) && !existsSync(jsonFile)) return [];
  if (!existsSync(sheetFile)) return [`${LAYER_JSON} has no ${LAYER_FILE}`];
  if (!existsSync(jsonFile)) return [`${LAYER_FILE} has no ${LAYER_JSON}`];
  const sheet = readLayer(readFileSync(sheetFile, 'utf8'));
  /** @type {{ version?: unknown, entries?: Record<string, unknown>[] }} */
  let doc;
  try {
    doc = /** @type {typeof doc} */ (JSON.parse(readFileSync(jsonFile, 'utf8')));
  } catch (e) {
    return [`${LAYER_JSON}: ${/** @type {Error} */ (e).message}`];
  }
  /** @type {string[]} */
  const problems = [];
  if (doc.version !== 1) problems.push(`${LAYER_JSON}: version must be 1`);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  const ids = new Set();
  for (const e of entries) {
    const who = `${LAYER_JSON} ${typeof e.id === 'string' ? e.id : '(no id)'}`;
    for (const f of FIELDS) if (!(f in e)) problems.push(`${who}: no "${f}"`);
    const id = String(e.id);
    if (!/^L\d+$/.test(id)) problems.push(`${who}: the id is L<n>`);
    if (ids.has(id)) problems.push(`${who}: the id is used twice`);
    ids.add(id);
    const exp = String(e.export);
    seen.set(exp, (seen.get(exp) ?? 0) + 1);
    const x = sheet.get(exp);
    if (!x) {
      problems.push(`${who}: ${LAYER_FILE} has no export ${exp}`);
      continue;
    }
    if (x.id !== id || x.name !== e.name)
      problems.push(`${who}: ${exp} is not under the comment // ${id} ${String(e.name)}`);
    const props = Array.isArray(e.properties) ? e.properties.map(String) : [];
    if (x.keys === null) problems.push(`${who}: ${exp} cannot be read`);
    else if (JSON.stringify([...x.keys].sort()) !== JSON.stringify([...props].sort()))
      problems.push(
        `${who}: "properties" are [${props.join(', ')}], ${exp} sets [${x.keys.join(', ')}]`
      );
    if (!Number.isInteger(e.decision)) problems.push(`${who}: "decision" is an integer`);
    if ('seeAlso' in e && !(Array.isArray(e.seeAlso) && e.seeAlso.every(Number.isInteger)))
      problems.push(`${who}: "seeAlso" is a list of decisions`);
    for (const [list, none, ok] of /** @type {const} */ ([
      ['crops', 'noCrop', (/** @type {string} */ c) => /^[\w.-]+\/[\w.-]+$/.test(c)],
      [
        'baselines',
        'noBaseline',
        (/** @type {string} */ b) =>
          /^[\w.-]+\/[\w.@-]+$/.test(b) && existsSync(path.join(baselines, `${b}.psig`)),
      ],
    ])) {
      const v = e[list];
      if (!Array.isArray(v)) continue;
      if (!v.length && !(typeof e[none] === 'string' && e[none]))
        problems.push(`${who}: "${list}" is empty without "${none}" saying why`);
      for (const item of v)
        if (!ok(String(item)))
          problems.push(
            `${who}: ${list === 'crops' ? 'crop' : 'baseline'} ${item} ${list === 'crops' ? 'is not <set>/<item>' : 'is not a committed baseline'}`
          );
    }
    const target = /** @type {{ component?: unknown, where?: unknown }} */ (e.target ?? {});
    if (typeof target.component !== 'string' || !target.component)
      problems.push(`${who}: "target.component" names what it styles`);
    const where = Array.isArray(target.where) ? target.where.map(String) : [];
    if (!where.length) problems.push(`${who}: "target.where" lists the files that use ${exp}`);
    for (const f of where) {
      const file = path.join(src, f);
      if (!existsSync(file)) problems.push(`${who}: ${f} does not exist`);
      else if (!new RegExp(`\\b${exp}\\b`).test(uncomment(readFileSync(file, 'utf8'))))
        problems.push(`${who}: ${f} does not use ${exp}`);
    }
  }
  for (const [exp, n] of seen) if (n > 1) problems.push(`${LAYER_JSON}: ${exp} has ${n} entries`);
  for (const exp of sheet.keys())
    if (!seen.has(exp)) problems.push(`${LAYER_FILE}: ${exp} has no entry in ${LAYER_JSON}`);
  return problems;
}
