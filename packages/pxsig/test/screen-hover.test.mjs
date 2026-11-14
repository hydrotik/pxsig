// dashboard-check/capture.mjs: a click, then a scroll that brings other content under the pointer.
// The browser re-hovers that content on a timer of its own, so the capture showed the hover only
// sometimes (inspector--header-6's region row); the pointer now leaves for the corner, so it never
// shows. A real Chromium; skipped without one.
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

// A dialog-like panel: a button at its top, a heading lower down, and rows that turn red on hover.
const rows = Array.from({ length: 40 }, (_, i) => `<button class="row">row ${i}</button>`).join('');
const html = `<!doctype html><style>
  body{margin:0;background:#fff} #panel{position:absolute;left:100px;top:100px;width:300px;height:400px;overflow:auto}
  button{display:block;width:100%;height:40px;border:0;background:#fff}
  .row:hover{background:#f00}
  #pointer{position:absolute;left:600px;top:100px;width:40px;height:40px;background:#888}
</style><div id="pointer"></div><div id="panel"><button>Start</button>${rows}<h2>Lower</h2>${rows}</div>
<script>
  // Where the pointer last moved to: blue at the corner, red anywhere else.
  addEventListener('mousemove', (e) => {
    document.getElementById('pointer').style.background =
      e.clientX === 0 && e.clientY === 0 ? '#00f' : '#f00';
  });
</script>`;

test(
  'a click then a scroll: nothing the scroll brings under the pointer shows as hovered',
  { skip: skipUnless(pw, "Playwright's Chromium is not installed") },
  async (t) => {
    const browser = await /** @type {NonNullable<typeof pw>} */ (pw).chromium.launch();
    t.after(() => browser.close());
    const shot = join(tempDir('screen-hover', t), 'shot.png');
    const r = await capture(browser, {
      url: `data:text/html,${encodeURIComponent(html)}`,
      screen: /** @type {any} */ ({
        actions: [
          { click: { role: 'button', name: 'Start', exact: true } },
          { scroll: { role: 'heading', name: 'Lower', exact: true } },
        ],
        wait: { role: 'heading', name: 'Lower', exact: true },
      }),
      shot,
      axe: '',
    });
    assert.equal(r.rendered, true, r.reason ?? '');
    const img = PNG.sync.read(readFileSync(shot));
    const at = (/** @type {number} */ x, /** @type {number} */ y) => [
      ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
    ];
    assert.deepEqual(at(620, 120), [0, 0, 255], 'the pointer left for the corner after the scroll');
    let red = 0;
    for (let y = 100; y < 500; y++)
      for (let x = 100; x < 400; x++) if (at(x, y).join() === '255,0,0') red++;
    assert.equal(red, 0, 'no row is hovered');
  }
);
