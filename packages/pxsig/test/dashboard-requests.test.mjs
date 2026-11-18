/**
 * dashboard-requests.test.mjs — `pxsig dashboard check`'s screens and the requests their pages make
 * (dashboard-check/requests.mjs). A page's state comes from requests it makes once; one that never
 * reaches the server leaves the page without that state, so the screen is taken again once when the
 * error is Windows' ERR_NO_BUFFER_SPACE, and a screen that still fails names the requests.
 * Real Chromium; skipped without one.
 *
 *   node --test packages/pxsig/test/dashboard-requests.test.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { capture, NO_BUFFER_SPACE } from '../src/dashboard-check/capture.mjs';
import { failedWith, saidFailed, watchRequests } from '../src/dashboard-check/requests.mjs';
import { tempDir } from './fixture.mjs';
import { skipUnless } from './strict.mjs';
/** @import { FailedRequest } from '../src/dashboard-check/requests.mjs' */

const require = createRequire(import.meta.url);
const pw = await (async () => {
  try {
    const lib = require('playwright');
    const b = await lib.chromium.launch();
    await b.close();
    return lib;
  } catch {
    return null;
  }
})();
const skip = skipUnless(pw, "Playwright's Chromium is not installed");

/** A request as Playwright's `requestfailed` gives it. */
const request = (
  /** @type {string} */ url,
  /** @type {string} */ errorText,
  /** @type {boolean} */ navigation = false
) => ({
  url: () => url,
  failure: () => ({ errorText }),
  isNavigationRequest: () => navigation,
});

test('watchRequests notes the path and the error, never the host; the page load and a dropped request are not noted', () => {
  /** @type {((r: unknown) => void)[]} */
  const on = [];
  /** @type {FailedRequest[]} */
  const failed = [];
  watchRequests(
    /** @type {any} */ ({
      on: (/** @type {string} */ _e, /** @type {(r: unknown) => void} */ f) => on.push(f),
    }),
    failed
  );
  on[0](request('http://127.0.0.1:5123/__pxsig/status?x=1', 'net::ERR_NO_BUFFER_SPACE'));
  on[0](request('http://127.0.0.1:5123/__pxsig/events', 'net::ERR_ABORTED'));
  on[0](request('http://127.0.0.1:5123/report/', 'net::ERR_NO_BUFFER_SPACE', true));
  assert.deepEqual(failed, [{ path: '/__pxsig/status', why: 'net::ERR_NO_BUFFER_SPACE' }]);
  assert.equal(failedWith(failed, NO_BUFFER_SPACE), true);
  assert.equal(failedWith(failed, 'ERR_CONNECTION_RESET'), false);
  assert.equal(saidFailed([]), '');
  assert.equal(
    saidFailed([...failed, ...failed, ...failed, ...failed]),
    ' (request failed: /__pxsig/status net::ERR_NO_BUFFER_SPACE, /__pxsig/status net::ERR_NO_BUFFER_SPACE, /__pxsig/status net::ERR_NO_BUFFER_SPACE, 1 more)'
  );
});

/**
 * A server whose page shows `Can approve` only once its status request answers; `refuse` points
 * that request at a port nothing listens on. Counts the page loads.
 * @param {{ refuse?: boolean }} [opts]
 */
async function server({ refuse = false } = {}) {
  let loads = 0;
  const s = createServer((req, res) => {
    if (req.url === '/__pxsig/status') return res.end('{}');
    loads++;
    const status = refuse ? 'http://127.0.0.1:9/__pxsig/status' : '/__pxsig/status';
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><p>Live</p><script>
      fetch(${JSON.stringify(status)}).then(() => document.body.append(Object.assign(document.createElement('p'), { textContent: 'Can approve' })), () => {});
    </script>`);
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => s.listen(0, '127.0.0.1', ok)));
  const port = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
  return { url: `http://127.0.0.1:${port}/`, loads: () => loads, close: () => s.close() };
}

const screen = /** @type {any} */ ({ wait: { text: 'Can approve', exact: true } });

test(
  'a request that fails with ERR_NO_BUFFER_SPACE: the screen is taken again once, and says so',
  { skip },
  async (t) => {
    const browser = await /** @type {NonNullable<typeof pw>} */ (pw).chromium.launch();
    const srv = await server();
    t.after(async () => (srv.close(), await browser.close()));
    // Chromium cannot be made to run out of socket buffers here: the first page's status request
    // fails (the route aborts it, so its answer never reaches the page), and the check is told the
    // error Windows gives.
    let first = true;
    const lossy = /** @type {any} */ ({
      newContext: async (/** @type {any} */ o) => {
        const context = await browser.newContext(o);
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          const page = await newPage();
          if (first) {
            first = false;
            await page.route('**/__pxsig/status', (r) => r.abort('connectionfailed'));
            const on = page.on.bind(page);
            page.on = /** @type {any} */ (
              (/** @type {string} */ ev, /** @type {(r: any) => void} */ f) =>
                on(/** @type {any} */ (ev), (/** @type {any} */ r) =>
                  f(ev === 'requestfailed' ? request(r.url(), 'net::ERR_NO_BUFFER_SPACE') : r)
                )
            );
          }
          return page;
        };
        return context;
      },
    });
    const r = await capture(lossy, {
      url: srv.url,
      screen,
      shot: join(tempDir('req-a', t), 's.png'),
      axe: '',
    });
    assert.equal(r.rendered, true, r.reason ?? '');
    assert.equal(r.retried, NO_BUFFER_SPACE);
    assert.equal(srv.loads(), 2, 'the page was loaded again');
  }
);

test(
  'any other failed request is not retried, and the screen that fails names it',
  { skip },
  async (t) => {
    const browser = await /** @type {NonNullable<typeof pw>} */ (pw).chromium.launch();
    const srv = await server({ refuse: true });
    t.after(async () => (srv.close(), await browser.close()));
    const r = await capture(browser, {
      url: srv.url,
      screen,
      shot: join(tempDir('req-b', t), 's.png'),
      axe: '',
    });
    assert.equal(r.rendered, false);
    assert.equal(r.retried, undefined);
    assert.equal(srv.loads(), 1);
    assert.match(
      r.reason ?? '',
      /^landmark missing: text "Can approve" \(request failed: \/__pxsig\/status net::ERR_[A-Z_]+\)$/
    );
  }
);
