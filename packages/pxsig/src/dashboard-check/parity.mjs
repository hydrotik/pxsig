/**
 * dashboard-check/parity.mjs — source parity: a contract component as the adapter draws it, beside
 * the design system's own story it maps to, both rendered in one browser (the same flags, viewport,
 * frozen motion, theme), compared element by element.
 *
 * What is compared, on the component's root and every element under it (matched by position in
 * the tree; an `svg` counts as one element):
 *   box model  box-sizing, display, alignment, gap, the four paddings and border widths, and the
 *              box relative to the root's (x, y, width, height)
 *   font       family, size, weight, style, line height, letter spacing, text transform, and
 *              whether the face is loaded
 *   rendered   each dot or icon's offset from its label's capitals, from the screenshot
 *              (alignment.mjs), on both sides
 * Colour is not: how a tone shows is the region rules' (fidelity.mjs). Computed lengths match within
 * LENGTH_TOLERANCE, boxes and rendered measures within GEOMETRY_TOLERANCE, the rest exactly.
 *
 * The pairs come from the adapter's conformance.json: per component an optional `parity` list of
 * `{ story, args?, props?, children?, expect? }`, and at the top `parity: { storyRoot, globals }`
 * (docs/ui/build-adapter.md, "Source parity"). A difference listed in `expect`, with its reason,
 * is reported as expected. A pair that does not render is a failure, never a pass.
 *
 * Both sides are static folders served through Playwright routes (no server): a built Storybook
 * and the parity page (packages/dashboard/test/harness/parity) built with the adapter. Nothing is
 * written but `outDir`'s report.json, summary.md and the screenshots.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { PNG } from 'pngjs';
import { alignmentTargets, EDGE_TOLERANCE, GRAPHIC_MAX, inkOffsets, SMALL } from './alignment.mjs';
import { screenContext, settle } from './capture.mjs';
import { storybookSentinel } from '../lib/capture/page.mjs';
/** @import { Browser, Page } from 'playwright' */
/** @import { ParityConformance, ParityDifference, ParityPair, ParityResult, ParitySide, ParityTree } from '../types/parity.js' */

export const LENGTH_TOLERANCE = 0.01;
export const GEOMETRY_TOLERANCE = 0.5;
export const STORY_ORIGIN = 'http://storybook.parity.test';
export const ADAPTER_ORIGIN = 'http://adapter.parity.test';
/** Storybook's own layouts (centred, padded) set aside, so a story's root sits where its decorators put it. */
export const STORYBOOK_RESET =
  'body.sb-main-centered,body.sb-main-padded,body.sb-main-fullscreen{display:block!important;padding:0!important;margin:0!important;min-height:0!important}#storybook-root{display:block!important;padding:0!important;margin:0!important}';
const LOAD_MS = 15_000;

/**
 * The pairs a conformance file declares, checked: each names a story (a Storybook id) and the
 * contract component it maps to; `expect` entries need a property and a reason.
 * @param {ParityConformance} conformance
 * @returns {{ pairs: ParityPair[], problems: string[] }}
 */
export function parityPairs(conformance) {
  /** @type {ParityPair[]} */
  const pairs = [];
  /** @type {string[]} */
  const problems = [];
  for (const [component, entry] of Object.entries(conformance.components ?? {}))
    (entry.parity ?? []).forEach((p, i) => {
      const at = `${component}.parity[${i}]`;
      if (typeof p.story !== 'string' || !/^[a-z0-9-]+--[a-z0-9-]+$/.test(p.story))
        problems.push(`${at}: story must be a Storybook story id`);
      else if ((p.expect ?? []).some((e) => !e?.property || !e?.reason))
        problems.push(`${at}: each expect entry needs a property and a reason`);
      else pairs.push({ component, ...p });
    });
  return { pairs, problems };
}

/**
 * Storybook's `args` URL value: `key:value;key:!true`. Values Storybook's URL parser keeps only
 * (letters, digits, space, `_` and `-`, or a number); anything else is refused here, not silently
 * dropped there.
 * @param {Record<string, string | number | boolean>} args
 */
export function argsParam(args) {
  return Object.entries(args)
    .map(([k, v]) => {
      if (typeof v === 'boolean') return `${k}:!${v}`;
      if (!/^[A-Za-z0-9 _-]*$/.test(String(v)) && !/^-?\d+(\.\d+)?$/.test(String(v)))
        throw new Error(`parity args ${k}: "${v}" holds characters Storybook's URL args drop`);
      return `${k}:${v}`;
    })
    .join(';');
}

/**
 * The URL of a story in the built Storybook, with its args and the theme's globals.
 * @param {ParityPair} pair
 * @param {string} globals `key:value` pairs for the theme (conformance `parity.globals[theme]`)
 */
export const storyUrl = (pair, globals) =>
  `${STORY_ORIGIN}/iframe.html?id=${encodeURIComponent(pair.story)}&viewMode=story${pair.args ? `&args=${encodeURIComponent(argsParam(pair.args))}` : ''}${globals ? `&globals=${encodeURIComponent(globals)}` : ''}`;

/**
 * The component's tree under `selector`: per element its path (`root/0/1`), tag, text, box
 * relative to the root, and the compared styles. Null when nothing matches. Self-contained: runs
 * in the page.
 * @param {string} selector
 * @returns {ParityTree | null}
 */
export function parityTree(selector) {
  const root = document.querySelector(selector);
  if (!root) return null;
  const PROPS = [
    'box-sizing',
    'display',
    'align-items',
    'justify-content',
    'row-gap',
    'column-gap',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'text-transform',
  ];
  const rb = root.getBoundingClientRect();
  const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  /** @type {ParityTree['nodes']} */
  const nodes = [];
  /** @param {Element} el @param {string} path */
  const walk = (el, path) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim()
      .slice(0, 32);
    nodes.push({
      path,
      tag: el.tagName.toLowerCase(),
      text: own,
      box: [r2(r.left - rb.left), r2(r.top - rb.top), r2(r.width), r2(r.height)],
      css: Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)])),
      loaded: document.fonts.check(
        `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      ),
    });
    if (el instanceof SVGSVGElement) return;
    [...el.children].forEach((c, i) => walk(c, `${path}/${i}`));
  };
  walk(root, 'root');
  return {
    text: (root.textContent ?? '').trim().replace(/\s+/g, ' '),
    at: [r2(rb.left), r2(rb.top)],
    nodes,
  };
}

/** @param {string} v */
const px = (v) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : null);

/**
 * Every difference between the story's tree and the adapter's: structure first (a node one side
 * has and the other does not), then per node each style, the box, the font, then the rendered
 * offsets. `expect` marks the ones the adapter makes on purpose.
 * @param {ParitySide} story
 * @param {ParitySide} adapter
 * @param {ParityPair['expect']} [expect]
 * @returns {ParityDifference[]}
 */
export function compareSides(story, adapter, expect = []) {
  /** @type {ParityDifference[]} */
  const out = [];
  /** @param {string} element @param {string} property @param {unknown} s @param {unknown} a */
  const add = (element, property, s, a) => {
    const why = expect.find(
      (e) => e.property === property && (e.element == null || e.element === element)
    );
    out.push({
      element,
      property,
      story: String(s),
      adapter: String(a),
      ...(why ? { expected: why.reason } : {}),
    });
  };
  const sNodes = new Map(story.tree.nodes.map((n) => [n.path, n]));
  const aNodes = new Map(adapter.tree.nodes.map((n) => [n.path, n]));
  for (const [path, s] of sNodes) {
    const a = aNodes.get(path);
    const name = `${path} <${s.tag}>`;
    if (!a) {
      add(name, 'element', s.tag, 'none');
      continue;
    }
    if (a.tag !== s.tag) {
      add(name, 'element', s.tag, a.tag);
      continue;
    }
    for (const [prop, sv] of Object.entries(s.css)) {
      const av = a.css[prop];
      const sn = px(sv);
      const an = px(av ?? '');
      const same = sn != null && an != null ? Math.abs(sn - an) <= LENGTH_TOLERANCE : sv === av;
      if (!same) add(name, prop, sv, av);
    }
    ['x', 'y', 'width', 'height'].forEach((k, i) => {
      if (Math.abs(s.box[i] - a.box[i]) > GEOMETRY_TOLERANCE) add(name, k, s.box[i], a.box[i]);
    });
    if (s.loaded !== a.loaded) add(name, 'font loaded', s.loaded, a.loaded);
  }
  for (const [path, a] of aNodes)
    if (!sNodes.has(path)) add(`${path} <${a.tag}>`, 'element', 'none', a.tag);
  if (story.tree.text.toLowerCase() !== adapter.tree.text.toLowerCase())
    add('root', 'text', story.tree.text, adapter.tree.text);
  story.offsets.forEach((so, i) => {
    const ao = adapter.offsets[i];
    if (ao && Math.abs(so.offset - ao.offset) > GEOMETRY_TOLERANCE)
      add(`${so.name} ${so.graphic}`, 'capitals to graphic', `${so.offset}px`, `${ao.offset}px`);
  });
  return out;
}

/**
 * Serve `dir` at `origin` to `page`, and refuse every other request (nothing leaves the machine).
 * @param {Page} page
 * @param {Record<string, string>} folders origin → folder
 */
async function serveFolders(page, folders) {
  await page.route('**', (route) => {
    const url = new URL(route.request().url());
    const dir = folders[url.origin];
    if (!dir) return route.abort();
    const file = normalize(join(dir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(normalize(dir) + sep) || !existsSync(file))
      return route.fulfill({ status: 404 });
    return route.fulfill({ path: file });
  });
}

/**
 * One side of a pair: load it, wait for its root, fonts and stillness, take the screenshot, read
 * the tree and the rendered offsets. Throws (the pair fails) when it does not render.
 * @param {Page} page
 * @param {{ url: string, selector: string, shot: string, story?: string | null, css?: string }} o
 * @returns {Promise<ParitySide>}
 */
async function side(page, { url, selector, shot, story = null, css = '' }) {
  const errors = /** @type {string[]} */ ([]);
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
  await page.goto(url, { waitUntil: 'load' });
  if (css) await page.addStyleTag({ content: css });
  try {
    await page.waitForSelector(selector, { state: 'attached', timeout: LOAD_MS });
  } catch {
    const why = story ? await page.evaluate(storybookSentinel, story).catch(() => null) : null;
    throw new Error(why ?? errors[0] ?? `nothing matches ${selector}`);
  }
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
  await page.screenshot({ path: shot });
  const tree = await page.evaluate(parityTree, selector);
  if (!tree) throw new Error(`nothing matches ${selector}`);
  const targets = await page.evaluate(alignmentTargets, {
    max: 12,
    graphicMax: GRAPHIC_MAX,
    small: SMALL,
    edgeTolerance: EDGE_TOLERANCE,
    within: selector,
  });
  const offsets = inkOffsets(PNG.sync.read(readFileSync(shot)), targets).map((m) => ({
    name: m.pair.name,
    graphic: m.pair.graphic,
    offset: Math.round(m.offset * 100) / 100,
  }));
  return { tree, offsets };
}

/**
 * Every pair in every theme. Never throws for a pair: its result says it did not render.
 * @param {Browser} browser
 * @param {{ conformance: ParityConformance, storybook: string, adapter: string, entry?: string, outDir: string, themes?: ('dark' | 'light')[], log?: (s: string) => void }} o
 *   storybook: a built Storybook folder; adapter: the parity page's build, `entry` its HTML in it
 * @returns {Promise<{ results: ParityResult[], problems: string[] }>}
 */
export async function runParity(
  browser,
  {
    conformance,
    storybook,
    adapter,
    entry = 'index.html',
    outDir,
    themes = ['dark', 'light'],
    log = () => {},
  }
) {
  const { pairs, problems } = parityPairs(conformance);
  const cfg = conformance.parity ?? {};
  const storyRoot = cfg.storyRoot ?? '#storybook-root > *';
  /** @type {ParityResult[]} */
  const results = [];
  mkdirSync(join(outDir, 'shots'), { recursive: true });
  for (const pair of pairs)
    for (const theme of themes) {
      const name = `${pair.component}--${pair.story}@${theme}`;
      const base = { component: pair.component, story: pair.story, theme };
      const context = await screenContext(browser, theme);
      try {
        await context.addInitScript(
          (spec) => {
            /** @type {Window & { __pxsigParity?: unknown }} */ (window).__pxsigParity = spec;
          },
          { component: pair.component, props: pair.props ?? {}, children: pair.children }
        );
        const page = await context.newPage();
        await serveFolders(page, { [STORY_ORIGIN]: storybook, [ADAPTER_ORIGIN]: adapter });
        const s = await side(page, {
          url: storyUrl(pair, cfg.globals?.[theme] ?? ''),
          selector: pair.storyRoot ?? storyRoot,
          shot: join(outDir, 'shots', `${name}.story.png`),
          story: pair.story,
          css: STORYBOOK_RESET,
        });
        const page2 = await context.newPage();
        await serveFolders(page2, { [STORY_ORIGIN]: storybook, [ADAPTER_ORIGIN]: adapter });
        const a = await side(page2, {
          url: `${ADAPTER_ORIGIN}/${entry}?theme=${theme}`,
          selector: '[data-parity-frame] > *',
          shot: join(outDir, 'shots', `${name}.adapter.png`),
        });
        const differences = compareSides(s, a, pair.expect);
        log(`[parity] ${name}: ${differences.filter((d) => !d.expected).length} difference(s)`);
        results.push({
          ...base,
          rendered: true,
          reason: null,
          differences,
          measured: { story: s, adapter: a },
        });
      } catch (e) {
        const reason = String(/** @type {Error} */ (e).message ?? e).split('\n')[0];
        log(`[parity] ${name}: did not render: ${reason}`);
        results.push({ ...base, rendered: false, reason, differences: [], measured: null });
      } finally {
        await context.close().catch(() => {});
      }
    }
  return { results, problems };
}

/**
 * summary.md: the counts, then each pair's differences (unexpected first), and the pairs that did
 * not render.
 * @param {ParityResult[]} results
 * @param {string[]} problems
 */
export function paritySummary(results, problems) {
  const bad = results.filter((r) => !r.rendered);
  const differing = results.filter((r) => r.differences.some((d) => !d.expected));
  const expected = results.reduce((n, r) => n + r.differences.filter((d) => d.expected).length, 0);
  const lines = [
    `## Source parity — ${differing.length + bad.length ? `${differing.length} of ${results.length} differ, ${bad.length} did not render` : `${results.length} pairs match`}`,
    '',
    'Each contract component beside the design-system story it maps to, rendered in one browser: box model, font and rendered alignment (not colour).',
    ...(expected ? ['', `${expected} expected difference(s), listed with their reasons.`] : []),
    ...problems.map((p) => `- conformance: ${p}`),
  ];
  for (const r of bad)
    lines.push(
      '',
      `### ${r.component} · \`${r.story}\` (${r.theme})`,
      '',
      `Did not render: ${r.reason}`
    );
  for (const r of results.filter((x) => x.differences.length)) {
    lines.push(
      '',
      `### ${r.component} · \`${r.story}\` (${r.theme})`,
      '',
      '| Element | Property | Story | Adapter | |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const d of [...r.differences].sort((a, b) => Number(!!a.expected) - Number(!!b.expected)))
      lines.push(
        `| \`${d.element}\` | ${d.property} | \`${d.story}\` | \`${d.adapter}\` | ${d.expected ? `expected: ${d.expected}` : '**differs**'} |`
      );
  }
  return `${lines.join('\n')}\n`;
}
