/**
 * The links of the sections folded into Diagnostics (`#react`, `#react-renders`, `#scenarios`,
 * `#calibration`, `#performance`) open the part they name when the hash changes on an open page,
 * as they do on a load: `#react` to `#react-renders` switches React to Renders. In a real browser
 * against a mocked server (see flows-helpers.mjs); skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenarioData } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const CAN = { allowed: true, folder: 'demo', command: 'pnpm exec pxsig serve --link' };

/**
 * @param {import('playwright').Page} page
 * @param {string} hash
 */
const goTo = (page, hash) => page.evaluate((h) => (location.hash = h), hash);

test('an old Diagnostics link entered on an open page opens its part', async (t) => {
  if (skip) return t.skip(skip);
  // React and Performance both: the links switch between them and between React's parts.
  const d = scenarioData('react');
  d.bench = scenarioData('clean').bench;
  assert.ok(d.bench, 'the clean scenario has benchmark data');
  const { page, errors } = await open(d, { hash: '#react', approving: CAN });
  try {
    const compiler = page.getByRole('heading', { name: 'React Compiler' });
    const renders = page.getByRole('heading', { name: 'Renders per Entry' });
    const bench = page.getByRole('heading', { name: 'Batch Check by Thread Count' });
    await compiler.waitFor();
    for (const [hash, shown] of [
      ['#react-renders', renders],
      ['#react', compiler],
      ['#performance', bench],
      ['#react-renders', renders],
    ]) {
      await goTo(page, /** @type {string} */ (hash));
      await shown.waitFor({ timeout: 3000 });
    }
    assert.equal(await compiler.count(), 0, 'one part at a time');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
