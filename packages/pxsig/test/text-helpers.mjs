/**
 * text-helpers.mjs — a stand-in Storybook whose stories are HTML given by the test (the text
 * capture's pins and capture tests), and the one-entry render they share.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { renderStories } from '../src/lib/capture.mjs';
import { FAMILY, fontFace, fontGate } from './test-font.mjs';
/** @import { RenderResult } from '../src/types.js' */

/**
 * A stand-in Storybook: `/iframe.html?id=<id>` is `stories[id]` inside `#storybook-root`, on a page
 * whose preview says that story finished rendering. `font`: the text is in the test font
 * (test-font.mjs), never one the operating system picks, and the story finishes only once that
 * face has loaded (else Storybook's error display says it did not).
 * @param {Record<string, string>} stories story id → the root's inner HTML
 * @param {string} [head] more markup for every page's head (styles)
 * @param {{ font?: boolean }} [opts]
 */
export async function standIn(stories, head = '', { font = false } = {}) {
  const face = font ? fontFace() : '';
  /** @param {string} id */
  const page = (id) => `<!doctype html><html><head><meta charset="utf-8">
<style>${face}body{margin:0;background:#fff;color:#111;font:16px/20px ${font ? FAMILY : 'sans-serif'}}#storybook-root{display:inline-block;padding:8px}</style>${head}</head>
<body class="sb-show-main"><div id="storybook-root">${stories[id] ?? ''}</div>${font ? '<pre id="error-message"></pre>' : ''}
${font ? fontGate(id) : `<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(id)}, phase: 'finished' } };</script>`}</body></html>`;
  const server = createServer((req, res) => {
    res.setHeader('connection', 'close');
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname === '/iframe.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page(u.searchParams.get('id') ?? ''));
    }
    res.writeHead(404).end();
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
  return {
    url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`,
    close: () => server.close(),
  };
}

/**
 * Render entries on the stand-in, as `pxsig check` renders them, with `config` as the project's.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {import('../src/types/t4.js').RenderEntry[]} entries
 * @param {string} dir
 * @param {Record<string, unknown>} [config]
 * @returns {Promise<RenderResult[]>}
 */
export async function renderOn(browser, url, entries, dir, config = {}) {
  const { results } = await renderStories(browser, entries, dir, {
    baseUrl: url,
    viewport: [400, 300],
    settleMs: 0,
    project: /** @type {never} */ ({ config }),
  });
  return results;
}

/**
 * A stand-in Storybook with one story whose markup the test sets (`html.body`), its text in the
 * test font; `html.face` replaces that font's @font-face rule (another face under the same name).
 * @param {{ id: string, title: string, name: string, importPath: string }} story
 * @param {{ body: string, face?: string }} html
 */
export async function storybook(story, html) {
  const FACE = fontFace();
  const server = createServer((req, res) => {
    res.setHeader('connection', 'close');
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname === '/index.json')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          v: 5,
          entries: {
            [story.id]: {
              type: 'story',
              id: story.id,
              title: story.title,
              name: story.name,
              importPath: `./${story.importPath}`,
              tags: [],
            },
          },
        })
      );
    if (u.pathname === '/iframe.html')
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        // In the test font (test-font.mjs): a verdict compared across checks never hangs on the
        // font the OS gives `sans-serif`; the story finishes once that face has loaded.
        `<!doctype html><html><head><meta charset="utf-8"><style>${html.face ?? FACE}body{margin:0;background:#fff;color:#111;font:16px/20px ${FAMILY}}#storybook-root{display:inline-block;padding:8px}</style></head>
<body class="sb-show-main"><div id="storybook-root">${html.body}</div><pre id="error-message"></pre>
${fontGate(story.id)}</body></html>`
      );
    res.writeHead(404).end();
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
  return {
    url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`,
    close: () => server.close(),
  };
}

/**
 * How two PNGs differ, for a failed byte-for-byte comparison: their sizes when those differ (the
 * layout moved: a font, a width), else how many pixels differ (the same layout drawn differently:
 * antialiasing, a raster path). Empty when the files are the same.
 * @param {string} a
 * @param {string} b
 */
export function howDiffer(a, b) {
  const [x, y] = [readFileSync(a), readFileSync(b)];
  if (x.equals(y)) return '';
  const [p, q] = [PNG.sync.read(x), PNG.sync.read(y)];
  if (p.width !== q.width || p.height !== q.height)
    return `${p.width}x${p.height} and ${q.width}x${q.height}`;
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4)
    if (p.data.readUInt32BE(i) !== q.data.readUInt32BE(i)) n++;
  return `${p.width}x${p.height}, ${n} pixels differ`;
}
