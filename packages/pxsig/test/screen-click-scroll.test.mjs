// dashboard-check/capture.mjs: a click on a target that is not enabled yet. Playwright retries
// such a click, and its later attempts scroll the target into view with block end, center, then
// start; in a dialog that clips its overflow, `start` moved the whole dialog up, depending on when
// the target became enabled (inspector--header-3: Reject waits for the entry's images). The click
// now waits for the target to be enabled and the layout to hold still, so nothing scrolls. A real
// Chromium; skipped without one.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { capture } from '../src/dashboard-check/capture.mjs';
import { tempDir } from './fixture.mjs';
import { skipUnless } from './strict.mjs';

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

// A dialog that clips its overflow: a blue band at its top, a button below it that is enabled
// `ms` after load, and more content than the dialog shows.
const html = (/** @type {number} */ ms) => `<!doctype html><style>
  body{margin:0;background:#fff} #dialog{position:absolute;left:0;top:0;width:400px;height:300px;overflow:hidden}
  #band{height:40px;background:#00f} button{display:block;height:40px;width:200px} #more{height:900px;background:#eee}
</style><div id="dialog"><div id="band"></div><button id="go" disabled>Go</button><div id="more"></div></div>
<script>setTimeout(() => document.getElementById('go').removeAttribute('disabled'), ${ms});</script>`;

test(
  'a click on a target enabled late scrolls nothing',
  { skip: skipUnless(pw, "Playwright's Chromium is not installed") },
  async (t) => {
    const browser = await /** @type {NonNullable<typeof pw>} */ (pw).chromium.launch();
    t.after(() => browser.close());
    const dir = tempDir('screen-click-scroll', t);
    // Enabled at once, and inside each of Playwright's later retry windows (0, 20, 100, 100, 500 ms
    // apart), where the attempt that first passes scrolls with block end, center or start.
    for (const ms of [0, 60, 150, 180, 400, 800]) {
      const shot = join(dir, `${ms}.png`);
      const r = await capture(browser, {
        url: `data:text/html,${encodeURIComponent(html(ms))}`,
        screen: /** @type {any} */ ({
          actions: [{ click: { role: 'button', name: 'Go', exact: true } }],
          wait: { role: 'button', name: 'Go', exact: true },
        }),
        shot,
        axe: '',
      });
      assert.equal(r.rendered, true, r.reason ?? '');
      const img = PNG.sync.read(readFileSync(shot));
      const at = (/** @type {number} */ x, /** @type {number} */ y) => [
        ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
      ];
      assert.deepEqual(
        at(200, 2),
        [0, 0, 255],
        `enabled after ${ms} ms: the dialog did not scroll`
      );
    }
  }
);
