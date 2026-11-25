/**
 * No dashboard style changes how a design-system element looks, outside the reference adapter too
 * (ui-tools.mjs `checkAll`, part 3; the adapter folder has its own, stricter rule: adapter-css.mjs).
 * Three rules over the dashboard's source text (everything under src/ but src/ui/):
 *   R (reach)   a contract component's `className` is a dashboard class (`s.X`, a template or a
 *               conditional of those) whose `style({...})` sets layout glue only (GLUE), and its
 *               inline `style` sets glue only. A className the check cannot read is a finding too.
 *   G (global)  a `globalStyle` selector reaches no design-system hook: no `ds-` class, no
 *               `[role=…]`, no `[data-*]` attribute but the dashboard's own (OWN_ATTRS), and no
 *               class that a contract component carries.
 *   F (focus)   a `:focus` / `:focus-visible` rule draws one of the shared focus lines
 *               (FOCUS_FRAGMENTS, styles/base.css.ts) and nothing else.
 * The theme layer (styles/theme-layer.css.ts) is where such a rule may live: its exports pass R, and
 * its global and focus rules pass G and F, each declared in styles/theme-layer.json
 * (ui-tools/theme-layer.mjs, rule L).
 * Each finding has a stable id. Findings that predate the check are listed in ds-reach-pending.json,
 * each with what it waits on; a finding not listed fails, and so does a listed one that is gone, so
 * the list only shrinks. Plain data and functions over source text: the check needs no build.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GLUE, objectKeys } from './adapter-css.mjs';

/**
 * The `data-*` attributes only the dashboard sets, on its own markup; any other (`data-tone`,
 * `data-control`, `data-state`, …) is also a design-system hook, so a selector may use it only right
 * after a dashboard class that no contract component carries (`${glyph}[data-tone="success"]`).
 */
export const OWN_ATTRS = new Set([
  'data-active',
  'data-collapse',
  'data-column',
  'data-compact',
  'data-file-cell',
  'data-file-probe',
  'data-grabbing',
  'data-kind',
  'data-own-keys',
  'data-pixelated',
  'data-region',
  'data-status',
  'data-tile',
  'data-top-bar',
  'data-volatile',
]);

/** The theme layer's stylesheet, under src/ (its declarations: ui-tools/theme-layer.mjs). */
export const LAYER_FILE = 'styles/theme-layer.css.ts';

/** The shared focus lines a focus rule may draw (styles/base.css.ts). */
export const FOCUS_FRAGMENTS = new Set(['focusOutline', 'insetFocusOutline', 'twoToneFocus']);

/**
 * Every file under `dir` (relative, `/`-separated) matching `re`, skipping `skip` folders.
 * @param {string} dir
 * @param {RegExp} re
 * @param {string[]} [skip]
 * @param {string} [base]
 * @returns {string[]}
 */
function walk(dir, re, skip = [], base = dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (!skip.includes(rel)) out.push(...walk(full, re, skip, base));
    } else if (re.test(e.name)) out.push(rel);
  }
  return out;
}

/** The text between the bracket at `open` and its match (exclusive), skipping strings. */
export function balanced(/** @type {string} */ text, /** @type {number} */ open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  /** @type {string[]} */
  const stack = [];
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c in pairs) stack.push(pairs[/** @type {'('} */ (c)]);
    else if (c === stack[stack.length - 1] && stack.pop() !== undefined && !stack.length)
      return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/** Source text without its comments (a comment's apostrophe would open a string). */
export const uncomment = (/** @type {string} */ text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/**
 * The dashboard's classes: export name → the keys its `style(...)` sets (`null`: not a plain
 * style, so it cannot be read), plus every globalStyle and focus rule, from each `.css.ts` file.
 */
export function readSheets(/** @type {string} */ src) {
  /** @type {Map<string, { file: string, keys: string[] | null, body: string, layer: boolean }>} */
  const classes = new Map();
  /** @type {{ file: string, selector: string }[]} */
  const globals = [];
  /** @type {{ file: string, where: string, body: string }[]} */
  const focus = [];
  for (const file of walk(src, /\.css\.ts$/, ['ui'])) {
    const layer = file === LAYER_FILE;
    const text = uncomment(readFileSync(path.join(src, file), 'utf8'));
    for (const m of text.matchAll(/export const (\w+)\s*=\s*(\w+)\(/g)) {
      const at = (m.index ?? 0) + m[0].length - 1;
      const body = balanced(text, at).trim();
      const literal = m[2] === 'style' && body.startsWith('{');
      classes.set(m[1], {
        file,
        keys: literal ? objectKeys(body.slice(1, -1)) : null,
        body,
        layer,
      });
    }
    for (const m of text.matchAll(/globalStyle\(\s*/g)) {
      const args = balanced(text, (m.index ?? 0) + m[0].length - 1);
      const sel = /^\s*(`[^`]*`|'[^']*'|"[^"]*"|[\w.]+)/.exec(args)?.[1] ?? args;
      if (layer) continue;
      globals.push({ file, selector: sel.replace(/^[`'"]|[`'"]$/g, '') });
      if (/:focus/.test(sel)) focus.push({ file, where: sel, body: args.slice(sel.length) });
    }
    for (const m of text.matchAll(/['"]([^'"\n]*:focus[^'"\n]*)['"]\s*:\s*/g)) {
      if (layer) break;
      const start = (m.index ?? 0) + m[0].length;
      const body =
        text[start] === '{'
          ? `{${balanced(text, start)}}`
          : (/^[\w.]+/.exec(text.slice(start))?.[0] ?? '');
      focus.push({ file, where: m[1], body });
    }
  }
  return { classes, globals, focus };
}

/** Each `<Name …>` tag of a contract component imported from `@ui` in `text`, with its attributes. */
export function contractTags(/** @type {string} */ text, /** @type {Set<string>} */ contract) {
  /** @type {Set<string>} */
  const fromUi = new Set();
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@ui['"]/g))
    for (const n of m[1].split(',')) {
      const [from, as = from] = n
        .replace(/^\s*type\s+/, '')
        .trim()
        .split(/\s+as\s+/);
      if (contract.has(from)) fromUi.add(as);
    }
  // A contract component passed on under another name: `Title: 'h2' | typeof DialogTitle` (a
  // prop's type) or `const Title = embedded ? 'h2' : DialogTitle`.
  for (const m of text.matchAll(
    /\b(\w+)\??\s*(?::[^;\n]*?typeof|=[^;\n]*?[?:|]\s*)\s*(\w+)\s*[;,)}\n]/g
  ))
    if (fromUi.has(m[2])) fromUi.add(m[1]);
  /** @type {{ name: string, attrs: string }[]} */
  const out = [];
  for (const m of text.matchAll(/<([A-Z]\w*)\b/g)) {
    if (!fromUi.has(m[1])) continue;
    let i = (m.index ?? 0) + m[0].length;
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && text[i - 1] !== '=') break;
    }
    out.push({ name: m[1], attrs: text.slice((m.index ?? 0) + m[0].length, i) });
  }
  return out;
}

/** The value of the tag's own `attr={…}` (not one inside a prop's JSX), or null. */
const attrValue = (/** @type {string} */ attrs, /** @type {string} */ attr) => {
  let depth = 0;
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && attrs.startsWith(`${attr}={`, i) && /\s/.test(attrs[i - 1] ?? ' '))
      return balanced(attrs, i + attr.length + 1);
  }
  return null;
};

/** The class names a className expression uses (`s.X`), or null when it is anything else. */
export function classRefs(/** @type {string} */ expr, /** @type {Set<string>} */ sheets) {
  const refs = [...expr.matchAll(/\b(\w+)\.(\w+)\b/g)].filter((m) => sheets.has(m[1]));
  let rest = expr;
  for (const m of refs) rest = rest.replace(m[0], ' ');
  // Conditions (`busy ? … : …`, `a && …`) and literals may stay; a call or a bare value may not.
  rest = rest
    .replace(/[\w.!]+\s*(\?|&&)/g, ' ')
    .replace(/\bundefined\b|\bnull\b|'[^']*'|"[^"]*"/g, ' ')
    .replace(/[`${}:?()\s]/g, '');
  return rest ? null : refs.map((m) => m[2]);
}

/** Every finding, as `{ id, text }`, for the dashboard source folder `src`. */
export function dsReachFindings(/** @type {string} */ src, /** @type {Set<string>} */ contract) {
  const { classes, globals, focus } = readSheets(src);
  /** @type {Map<string, string>} */
  const found = new Map();
  /** @type {Set<string>} */
  const onContract = new Set();
  for (const file of walk(src, /\.tsx$/, ['ui'])) {
    const text = readFileSync(path.join(src, file), 'utf8');
    const sheets = new Set(
      [...text.matchAll(/import \* as (\w+) from '[^']*\.css'/g)].map((m) => m[1])
    );
    for (const { name, attrs } of contractTags(text, contract)) {
      const cls = attrValue(attrs, 'className');
      if (cls !== null) {
        const refs = classRefs(cls, sheets);
        if (!refs)
          found.set(
            `R:${file}:${name}:className`,
            `${file}: ${name}'s className {${cls.trim()}} cannot be read`
          );
        for (const x of refs ?? []) {
          onContract.add(x);
          const c = classes.get(x);
          const bad = !c
            ? ['(not found)']
            : c.layer
              ? []
              : c.keys === null
                ? ['(not a plain style)']
                : c.keys.filter((k) => !GLUE.has(k));
          if (bad.length)
            found.set(
              `R:${file}:${name}:${x}`,
              `${file}: ${name} takes ${x}, which sets ${bad.join(', ')}`
            );
        }
      }
      const inline = attrValue(attrs, 'style');
      if (inline !== null) {
        const body = inline.trim().startsWith('{') ? inline.trim().slice(1, -1) : `...${inline}`;
        const bad = objectKeys(body).filter((k) => !GLUE.has(k));
        if (bad.length)
          found.set(
            `R:${file}:${name}:style`,
            `${file}: ${name}'s inline style sets ${bad.join(', ')}`
          );
      }
    }
  }
  for (const { file, selector } of globals) {
    const hooks = [
      ...(/\.ds-|ds-\w/.test(selector) ? ['a ds- class'] : []),
      ...(/\[role[~|^$*]?=/.test(selector) ? ['a role'] : []),
      ...[...selector.matchAll(/(?:\$\{(\w+)\})?\[(data-[\w-]+)/g)]
        .filter(
          (m) => !OWN_ATTRS.has(m[2]) && !(m[1] && classes.has(m[1]) && !onContract.has(m[1]))
        )
        .map((m) => m[2]),
      ...[...selector.matchAll(/\$\{(\w+)\}/g)]
        .map((m) => m[1])
        .filter((x) => onContract.has(x))
        .map((x) => `${x} (on a contract component)`),
    ];
    if (hooks.length)
      found.set(
        `G:${file}:${selector}`,
        `${file}: globalStyle ${selector} reaches ${[...new Set(hooks)].join(', ')}`
      );
  }
  for (const { file, where, body } of focus) {
    const b = body.replace(/^[\s,]+|[\s,)]+$/g, '');
    const plain = /^[\w.]+$/.test(b)
      ? b.split('.').pop()
      : /^\{\s*\.\.\.([\w.]+)\s*,?\s*\}$/.exec(b)?.[1]?.split('.').pop();
    if (!plain || !FOCUS_FRAGMENTS.has(plain))
      found.set(
        `F:${file}:${where}`,
        `${file}: the focus rule ${where} is not one of ${[...FOCUS_FRAGMENTS].join(', ')}`
      );
  }
  return [...found].map(([id, text]) => ({ id, text }));
}

/**
 * The check's problems: each finding not in `pending` (id → what it waits on), and each pending id
 * no longer found.
 */
export function dsReachProblems(
  /** @type {string} */ src,
  /** @type {Set<string>} */ contract,
  /** @type {Record<string, string>} */ pending
) {
  const findings = dsReachFindings(src, contract);
  const ids = new Set(findings.map((f) => f.id));
  return [
    ...findings
      .filter((f) => !(f.id in pending))
      .map(
        (f) =>
          `${f.text}: a dashboard style changes a design-system element (ui-tools/ds-reach.mjs)`
      ),
    ...Object.keys(pending)
      .filter((id) => !ids.has(id))
      .map(
        (id) => `${id} is listed in ui-tools/ds-reach-pending.json but no longer found: remove it`
      ),
  ];
}
