/**
 * Report to pxsig, in a real browser against a mocked server (flows-helpers.mjs): the dialog runs
 * the self-check first and asks for the report only after it; it says the issue is public; nothing
 * reaches the clipboard until a copy button is pressed, and then exactly the text or the one PNG
 * the preview shows; Image-free and Keep story ID change the preview; Open issue is the prefilled
 * form in a new tab; A and R decide nothing while it is open; Esc closes it and leaves the
 * inspector open. A read-only page (no dashboard link) prepares a report too.
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleGateReport } from '../../pxsig/src/dashboard-check/gate-report.mjs';
import { sampleImages } from '../../pxsig/src/dashboard-check/server.mjs';
import { gateFacts } from '../fixtures/gate-report.mjs';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const story = 'ui-button--primary';
const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const one = () => data({ rows: [row(story, changed)], entries: [entry(story, issue)] });
const PUBLIC =
  "This goes in a public GitHub issue on hydrotik/pxsig. Anyone can see it, and it can't be fully removed. Copy it only if the images show nothing confidential.";

/** Records every clipboard write (the page's own clipboard is not read). */
const recordClipboard = () => {
  const w = /** @type {Window & { copies?: unknown[] }} */ (window);
  w.copies = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (/** @type {string} */ s) => void w.copies?.push({ text: s }),
      write: async (/** @type {ClipboardItem[]} */ items) =>
        void w.copies?.push({ types: items.flatMap((i) => [...i.types]) }),
    },
  });
};

/**
 * The server's two report routes: the self-check held until `release()`, then the report for the
 * options asked. `order` lists the requests as they came.
 */
function reportRoutes() {
  /** @type {string[]} */
  const order = [];
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((ok) => (release = () => ok(undefined)));
  const images = sampleImages();
  /** @param {import('playwright').Page} page */
  const routes = async (page) => {
    await page.route('**/__pxsig/gate-report/self-check', async (route) => {
      order.push('self-check');
      await held;
      return route.fulfill({ json: { state: 'differs', reasons: ['ssim 0.8 < min 0.99'] } });
    });
    await page.route('**/__pxsig/gate-report?*', (route) => {
      const q = new URL(route.request().url()).searchParams;
      order.push(`report ${q.toString()}`);
      const on = (/** @type {string} */ k) => q.get(k) === '1';
      const facts = gateFacts({ full: on('full'), keepId: on('keepId'), noImage: on('noImage') });
      return route.fulfill({
        json: sampleGateReport(/** @type {never} */ (facts), images),
      });
    });
  };
  return { order, release: () => release(), routes };
}

/** @param {import('playwright').Page} page */
const copies = (page) =>
  page.evaluate(() => /** @type {Window & { copies: unknown[] }} */ (window).copies);

test('self-check first, the public statement, nothing copied before a copy button, exact copies', async (t) => {
  if (skip) return t.skip(skip);
  const r = reportRoutes();
  const { page, posts, errors } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    approving: { allowed: true, folder: 'demo', command: 'pnpm exec pxsig serve --link' },
    init: recordClipboard,
    routes: r.routes,
  });
  try {
    await page.getByRole('button', { name: 'Report to pxsig', exact: true }).click();
    await page.getByText('Re-rendering this entry on this machine…').waitFor();
    const copyText = page.getByRole('button', { name: 'Copy text', exact: true });
    assert.equal(await copyText.isDisabled(), true, 'nothing to copy before the self-check');
    await new Promise((ok) => setTimeout(ok, 300));
    assert.deepEqual(r.order, ['self-check'], 'no report is asked for until the self-check ends');
    r.release();
    await page.getByText('Re-rendered on this machine: still fails the gate.').waitFor();
    assert.ok(await page.getByText(PUBLIC).isVisible(), 'the public statement');
    const img = page.getByRole('img', { name: 'Baseline, render and diff side by side' });
    await img.waitFor();
    assert.deepEqual(r.order, ['self-check', 'report project=demo&id=ui-button--primary']);
    assert.match(String(await img.getAttribute('src')), /^data:image\/png;base64,/);
    const text = await page.getByRole('textbox', { name: 'Text' }).inputValue();
    assert.match(text, /### Entry and mode\n\nentry-1 · mode dark/);
    assert.ok(!text.includes(story), 'the story id is replaced');
    assert.deepEqual(await copies(page), [], 'nothing copied yet');

    // A and R decide nothing while the dialog is open.
    await page.keyboard.press('a');
    await page.keyboard.press('r');
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(!posts.some((p) => p.name === 'approve' || p.name === 'reject'));

    await copyText.click();
    await page.getByText('Text copied.').waitFor();
    assert.deepEqual(await copies(page), [{ text }], 'exactly the text shown');
    await page.getByRole('button', { name: 'Copy image', exact: true }).click();
    await page.getByText('Image copied: one PNG.').waitFor();
    assert.deepEqual((await copies(page))[1], { types: ['image/png'] }, 'one PNG');

    const issueLink = page.getByRole('link', { name: 'Open issue' });
    assert.match(
      String(await issueLink.getAttribute('href')),
      /^https:\/\/github\.com\/hydrotik\/pxsig\/issues\/new\?template=gate\.yml&/
    );
    assert.equal(await issueLink.getAttribute('target'), '_blank');

    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Report to pxsig' }).waitFor({ state: 'detached' });
    assert.ok(await page.getByRole('dialog').isVisible(), 'the inspector stays open');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('options change the preview: Image-free shows no image; Keep story ID keeps it', async (t) => {
  if (skip) return t.skip(skip);
  const r = reportRoutes();
  r.release();
  const { page } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    init: recordClipboard,
    routes: r.routes,
  });
  try {
    await page.getByRole('button', { name: 'Report to pxsig', exact: true }).click();
    await page.getByRole('img', { name: 'Baseline, render and diff side by side' }).waitFor();
    await page
      .getByRole('switch', { name: 'No image: the changed regions and their average colors only' })
      .click();
    await page.getByText('No image. The text lists each changed region').waitFor();
    assert.equal(
      await page.getByRole('img', { name: 'Baseline, render and diff side by side' }).count(),
      0
    );
    assert.match(
      await page.getByRole('textbox', { name: 'Text' }).inputValue(),
      /baseline #5d7dc8 → render #9aa6c4/
    );
    assert.equal(
      await page.getByRole('button', { name: 'Copy image', exact: true }).isDisabled(),
      true
    );
    await page.getByRole('switch', { name: 'Keep the story ID instead of entry-1' }).click();
    await page.waitForFunction(
      (id) => document.querySelector('textarea')?.value.includes(id),
      story
    );
    assert.ok(r.order.includes('report project=demo&id=ui-button--primary&keepId=1&noImage=1'));
    assert.deepEqual(await copies(page), [], 'options copy nothing');
  } finally {
    await page.close();
  }
});

test('read only (no dashboard link): a report is prepared all the same', async (t) => {
  if (skip) return t.skip(skip);
  const r = reportRoutes();
  r.release();
  const { page } = await open(one(), {
    hash: `#inspect=${story}`,
    images: true,
    approving: { allowed: false, folder: 'demo', command: 'pnpm exec pxsig serve --link' },
    routes: r.routes,
  });
  try {
    await page.getByRole('button', { name: 'Report to pxsig', exact: true }).click();
    await page.getByRole('img', { name: 'Baseline, render and diff side by side' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Copy text', exact: true }).isDisabled(),
      false
    );
  } finally {
    await page.close();
  }
});
