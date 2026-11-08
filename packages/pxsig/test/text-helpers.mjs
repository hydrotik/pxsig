/**
 * text-helpers.mjs — a stand-in Storybook whose stories are HTML given by the test (the text
 * capture's pins and capture tests), and the one-entry render they share.
 */
import { createServer } from 'node:http';
import { renderStories } from '../src/lib/capture.mjs';
/** @import { RenderResult } from '../src/types.js' */

/**
 * A stand-in Storybook: `/iframe.html?id=<id>` is `stories[id]` inside `#storybook-root`, on a page
 * whose preview says that story finished rendering.
 * @param {Record<string, string>} stories story id → the root's inner HTML
 * @param {string} [head] more markup for every page's head (styles)
 */
export async function standIn(stories, head = '') {
  /** @param {string} id */
  const page = (id) => `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#fff;color:#111;font:16px/20px sans-serif}#storybook-root{display:inline-block;padding:8px}</style>${head}</head>
<body class="sb-show-main"><div id="storybook-root">${stories[id] ?? ''}</div>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(id)}, phase: 'finished' } };</script></body></html>`;
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
