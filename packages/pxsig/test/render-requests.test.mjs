/**
 * render-requests.test.mjs — a render whose Storybook preview never starts names the requests that
 * failed (lib/capture/render.mjs): a story module that never loaded says so in the entry's error,
 * where it used to read only "the Storybook preview did not start". Real Chromium; skipped without.
 *
 *   node --test packages/pxsig/test/render-requests.test.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { renderOn } from './text-helpers.mjs';

test(
  'the Storybook preview did not start: the entry names the request that failed',
  { skip: needs },
  async (t) => {
    // The preview's module is on a port Chromium refuses (9), so its request fails and the preview
    // object is never set.
    const server = createServer((req, res) => {
      res.setHeader('connection', 'close');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<!doctype html><div id="storybook-root"></div><script type="module" src="http://127.0.0.1:9/assets/iframe.js"></script>'
      );
    });
    await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
    const pw = await import('playwright');
    const browser = await pw.chromium.launch();
    t.after(async () => {
      await browser.close();
      server.close();
    });
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const [r] = await renderOn(
      browser,
      `http://127.0.0.1:${port}`,
      [{ id: 'a--b' }],
      tempDir('render-req', t)
    );
    assert.match(
      r.error ?? '',
      /^storybook-error: the Storybook preview did not start \(request failed: \/assets\/iframe\.js net::ERR_[A-Z_]+\)$/
    );
  }
);
