/**
 * The reference adapter maps props only (ui-tools.mjs `checkAll`, part 3): the design system is
 * the canon, so the adapter draws nothing of its own over it. It may not
 *   - declare styles: no file imports vanilla-extract (no `style`, `globalStyle`, recipes, …);
 *   - load a stylesheet that is not the design system's: a CSS import is a design-system entry or
 *     one of the adapter's `.css.ts` files, and those import only the design system;
 *   - draw a `<style>` element;
 *   - set an inline style other than layout glue: a `style` object holds only the properties that
 *     place or size a component in the dashboard's layout (GLUE), never colour, type, borders,
 *     shadows, spacing inside it, opacity or radius.
 * A stylesheet the design system cannot replace yet is listed in EXCEPTIONS with what it waits on;
 * an exception whose file is gone is a problem too, so the list only shrinks.
 * Plain data and functions over the adapter's source text: the check needs no build.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The properties an inline style may set: where a component sits and how big it is. */
export const GLUE = new Set([
  'position',
  'inset',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
  'zIndex',
  'inlineSize',
  'blockSize',
  'minInlineSize',
  'maxInlineSize',
  'minBlockSize',
  'maxBlockSize',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'justifySelf',
  'order',
  'gap',
  'rowGap',
  'columnGap',
  'gridArea',
  'gridColumn',
  'gridRow',
  'containerType',
  'containerName',
]);

/** The reference adapter's own stylesheets, each until the design system ships what it draws. */
export const EXCEPTIONS = {
  'reset.css.ts':
    "the design system's reset and body type for its own elements, until its scoped base stylesheet can replace it without restyling the dashboard's markup inside them",
  'slider.css.ts':
    "the slider on one line, until the design system's inline Slider marks its label and value disabled with its track",
  'heatmap.css.ts':
    "the heatmap's tiles, until the design system's Heatmap tile text keeps its label and figure apart for the tile's accessible name",
  'tones.css.ts':
    'the top-bar count that asks for action, a neutral wash with digits in the primary colour (pxsig\'s own look), until the pinned design system has CountBadge\'s emphasis="subtle" for the adapter to select by prop',
};

/** A specifier that is the design system's own (an entry of its packages). */
const DS = /^@hydrotik\/(design-system|tokens|theme-provider)(\/|$)/;

/** The keys of an object literal's source (`a: 1, b, ...c`), at its top level. */
export function objectKeys(/** @type {string} */ body) {
  /** @type {string[]} */
  const keys = [];
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith('...')) keys.push(p);
    else keys.push((/^['"]?([\w-]+)['"]?\s*(?::|$)/.exec(p)?.[1] ?? p).trim());
  }
  return keys;
}

/** Each inline style object in a source file: `style={{ … }}` and `style: { … }`. */
export function inlineStyles(/** @type {string} */ text) {
  /** @type {string[]} */
  const out = [];
  for (const m of text.matchAll(/\bstyle\s*(?:=\s*\{\s*|:\s*)\{/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const from = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    out.push(text.slice(from, i - 1));
  }
  // A style passed as anything but an object literal cannot be read: report it.
  for (const m of text.matchAll(/\bstyle\s*=\s*\{(?!\s*\{)\s*([^}]*)\}/g)) out.push(`...${m[1]}`);
  return out;
}

/** The import specifiers of a source file, with their line's clause (`''` for a bare import). */
function imports(/** @type {string} */ text) {
  return [
    ...text.matchAll(/^\s*import\s+(?:type\s+)?([^'";]*?)\s*(?:from\s+)?['"]([^'"]+)['"]/gm),
  ].map((m) => ({ clause: m[1], spec: m[2] }));
}

/**
 * What in the adapter folder `dir` styles the design system, as problems (empty: prop mapping
 * only). Paths in the messages are relative to `root`.
 * @param {string} dir
 * @param {string} [root]
 * @param {Record<string, string>} [exceptions] file name → what it waits on
 */
export function adapterCssProblems(dir, root = dir, exceptions = EXCEPTIONS) {
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(dir)) return problems;
  /** @type {Record<string, string>} */
  const except = exceptions;
  const who = (/** @type {string} */ f) =>
    path.relative(root, path.join(dir, f)).split(path.sep).join('/');
  const files = readdirSync(dir).filter((f) => /\.(tsx?|mjs)$/.test(f) && !f.endsWith('.d.ts'));
  for (const f of Object.keys(except))
    if (!files.includes(f))
      problems.push(
        `${who(f)} is listed in EXCEPTIONS (ui-tools/adapter-css.mjs) but is gone: remove it`
      );
  for (const f of files) {
    if (except[f]) continue;
    const text = readFileSync(path.join(dir, f), 'utf8');
    const isSheet = f.endsWith('.css.ts');
    for (const { spec } of imports(text)) {
      if (spec.startsWith('@vanilla-extract/'))
        problems.push(
          `${who(f)}: imports ${spec}; the reference adapter declares no styles of its own (the design system draws every component)`
        );
      else if (isSheet && !DS.test(spec))
        problems.push(
          `${who(f)}: imports ${spec}; an adapter stylesheet only applies the design system's own (it imports only @hydrotik/*)`
        );
      else if (
        spec.endsWith('.css') &&
        !DS.test(spec) &&
        !files.includes(`${path.basename(spec)}.ts`)
      )
        problems.push(`${who(f)}: loads the stylesheet ${spec}, which is not the design system's`);
    }
    if (/<style[\s>]/.test(text))
      problems.push(`${who(f)}: draws a <style> element; the design system's stylesheets style it`);
    for (const body of inlineStyles(text))
      for (const key of objectKeys(body))
        if (!GLUE.has(key))
          problems.push(
            `${who(f)}: an inline style sets ${key}; inline styles hold layout glue only (${[...GLUE].slice(0, 4).join(', ')}, … in ui-tools/adapter-css.mjs)`
          );
  }
  return problems;
}
