/**
 * issue-templates.test.mjs — the issue forms in .github/ISSUE_TEMPLATE/, parsed (the YAML subset
 * they use: maps, lists, block and quoted scalars, inline lists) and held to what GitHub's issue
 * forms need: a name, a description and a body of known field types, each input with a unique `id`
 * and a label, dropdowns with options. "The gate got it wrong" (gate.yml) has a field for every
 * field the gate report fills from the link (lib/gate-report/text.mjs `fields`), a direction, an
 * images field, and the required public-posting checkbox; config.yml turns blank issues off and
 * links to private vulnerability reporting.
 *
 *   node --test scripts/issue-templates.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fields } from '../packages/pxsig/src/lib/gate-report/text.mjs';

const dir = fileURLToPath(new URL('../.github/ISSUE_TEMPLATE/', import.meta.url));

/** @typedef {string | boolean | number | null | YamlValue[] | { [k: string]: YamlValue }} YamlValue */

/**
 * @param {string} s
 * @returns {YamlValue}
 */
function scalar(s) {
  const v = s.trim();
  if (v === '') return null;
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replaceAll("''", "'");
  if (/^".*"$/.test(v)) return /** @type {string} */ (JSON.parse(v));
  if (/^\[.*\]$/.test(v))
    return v
      .slice(1, -1)
      .split(',')
      .map((x) => scalar(x))
      .filter((x) => x !== null);
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/**
 * The YAML subset the forms use, parsed by indentation. Throws on a line it cannot place.
 * @param {string} text
 * @returns {YamlValue}
 */
export function parseYaml(text) {
  const lines = text
    .split('\n')
    .map((raw, n) => ({ raw, n: n + 1, ind: raw.length - raw.trimStart().length }))
    .filter((l) => l.raw.trim() && !l.raw.trim().startsWith('#'));
  let i = 0;
  /**
   * A block scalar's lines (`|` keeps line breaks, `>` folds them), indented past `ind`.
   * @param {number} ind
   * @param {string} style
   */
  const block = (ind, style) => {
    const body = [];
    const start = text.split('\n');
    // Re-read raw lines (blank ones count inside a block) from the current line's number.
    let k = lines[i - 1].n;
    while (
      k < start.length &&
      (start[k].trim() === '' || start[k].length - start[k].trimStart().length > ind)
    )
      body.push(start[k++]);
    while (i < lines.length && lines[i].n <= k) i++;
    const pad = Math.min(
      ...body.filter((b) => b.trim()).map((b) => b.length - b.trimStart().length)
    );
    const out = body
      .map((b) => b.slice(pad))
      .join('\n')
      .replace(/\n+$/, '');
    return style.startsWith('>') ? out.replace(/\n(?!\n)/g, ' ') : out;
  };
  /**
   * @param {number} ind
   * @returns {YamlValue}
   */
  const node = (ind) => {
    if (lines[i].raw.trimStart().startsWith('- ')) {
      /** @type {YamlValue[]} */
      const list = [];
      while (
        i < lines.length &&
        lines[i].ind === ind &&
        lines[i].raw.trimStart().startsWith('- ')
      ) {
        const l = lines[i];
        const rest = l.raw.trimStart().slice(2);
        if (/^[\w-]+:(\s|$)/.test(rest)) {
          // A map item: its first key on the dash's line, the rest indented under it.
          lines[i] = { raw: `${' '.repeat(ind + 2)}${rest}`, n: l.n, ind: ind + 2 };
          list.push(node(ind + 2));
        } else {
          i++;
          list.push(scalar(rest));
        }
      }
      return list;
    }
    /** @type {{ [k: string]: YamlValue }} */
    const map = {};
    while (i < lines.length && lines[i].ind === ind) {
      const l = lines[i];
      const m = l.raw.trim().match(/^([\w-]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`line ${l.n}: not a key: ${l.raw.trim()}`);
      i++;
      const [, key, value = ''] = m;
      if (/^[|>]-?$/.test(value)) map[key] = block(ind, value);
      else if (value !== '') map[key] = scalar(value);
      else if (i < lines.length && lines[i].ind > ind) map[key] = node(lines[i].ind);
      else map[key] = null;
    }
    if (i < lines.length && lines[i].ind > ind)
      throw new Error(`line ${lines[i].n}: unexpected indentation`);
    return map;
  };
  const out = node(0);
  if (i < lines.length) throw new Error(`line ${lines[i].n}: not parsed`);
  return out;
}

/** @param {string} f */
const form = (f) =>
  /** @type {{ [k: string]: any }} */ (parseYaml(readFileSync(join(dir, f), 'utf8')));

const TYPES = new Set(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes']);

test('the parser reads what the forms use', () => {
  assert.deepEqual(
    parseYaml(
      "a: 1\nb: 'x: y'\nc: [p, q]\nd:\n  - type: t\n    e: |\n      one\n      two\n  - plain\nf: >-\n  folded\n  line\n"
    ),
    { a: 1, b: 'x: y', c: ['p', 'q'], d: [{ type: 't', e: 'one\ntwo' }, 'plain'], f: 'folded line' }
  );
  assert.throws(() => parseYaml('a: 1\n   b: 2\n'), /unexpected indentation|not parsed/);
});

test('every issue form: name, description, a body of known fields with unique ids', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'config.yml');
  assert.deepEqual(files.sort(), ['bug.yml', 'docs.yml', 'feature.yml', 'gate.yml']);
  for (const f of files) {
    const y = form(f);
    assert.equal(typeof y.name, 'string', `${f}: name`);
    assert.equal(typeof y.description, 'string', `${f}: description`);
    assert.ok(Array.isArray(y.body) && y.body.length, `${f}: body`);
    const ids = new Set();
    for (const b of y.body) {
      assert.ok(TYPES.has(b.type), `${f}: type ${b.type}`);
      if (b.type === 'markdown') {
        assert.equal(typeof b.attributes?.value, 'string', `${f}: markdown value`);
        continue;
      }
      assert.match(String(b.id), /^[a-z][a-z0-9_-]*$/, `${f}: id`);
      assert.ok(!ids.has(b.id), `${f}: id ${b.id} once`);
      ids.add(b.id);
      assert.equal(typeof b.attributes?.label, 'string', `${f}: ${b.id} label`);
      if (b.type === 'dropdown' || b.type === 'checkboxes')
        assert.ok(b.attributes.options?.length, `${f}: ${b.id} options`);
    }
    assert.ok(
      [...ids].some(() => true),
      `${f}: at least one field`
    );
  }
});

test('gate.yml: every field the report fills, the direction, the images and the public checkbox', () => {
  const y = form('gate.yml');
  /** @type {Map<string, { [k: string]: any }>} */
  const byId = new Map(
    y.body
      .filter((/** @type {{ id?: string }} */ b) => b.id)
      .map((/** @type {{ id: string }} */ b) => [b.id, b])
  );
  const sample = fields(
    /** @type {Parameters<typeof fields>[0]} */ (
      /** @type {unknown} */ ({
        metrics: {},
        pixels: { width: 1, height: 1, changed: 0, maxDelta: 0, regions: 0 },
        regions: [],
        reasons: [],
        environment: { render: null, baseline: null, match: 'unknown' },
        entry: 'entry-1',
      })
    )
  );
  for (const k of Object.keys(sample))
    assert.ok(byId.has(k), `gate.yml has a field "${k}" for the link`);
  assert.equal(byId.get('direction')?.type, 'dropdown');
  assert.ok(
    byId
      .get('direction')
      ?.attributes.options.some((/** @type {string} */ o) => o.startsWith('False positive'))
  );
  assert.ok(
    byId
      .get('direction')
      ?.attributes.options.some((/** @type {string} */ o) => o.startsWith('False negative'))
  );
  assert.equal(byId.get('images')?.type, 'textarea');
  const confirm = byId.get('confirm');
  assert.equal(confirm?.type, 'checkboxes');
  assert.deepEqual(confirm?.attributes.options, [
    {
      label: "These images contain nothing confidential, and I'm fine posting them publicly.",
      required: true,
    },
  ]);
});

test('config.yml: no blank issues; private vulnerability reporting and the docs', () => {
  const y = form('config.yml');
  assert.equal(y.blank_issues_enabled, false);
  const urls = y.contact_links.map((/** @type {{ url: string }} */ l) => l.url);
  const at = urls.map((/** @type {string} */ u) => {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  });
  assert.ok(at.includes('https://github.com/hydrotik/pxsig/security/advisories/new'));
  assert.ok(at.includes('https://github.com/hydrotik/pxsig/tree/main/docs'));
  for (const l of y.contact_links) assert.ok(l.name && l.about, 'name and about');
});
