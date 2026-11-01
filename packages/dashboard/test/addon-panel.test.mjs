/**
 * The Storybook addon's panel (packages/storybook-addon/manager.mjs) in a real browser, on a
 * stubbed Storybook manager (test/harness-addon), against a pxsig server mocked in the page
 * (`page.route`): every request is answered or refused inside the browser, so nothing reaches a
 * server on this machine. Here rather than in the addon's package because this package already
 * builds with Vite and React for its browser tests. Skips when no Chromium is available
 * (PXSIG_CHROMIUM names an executable to use instead).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));
const harness = path.join(here, 'harness-addon');
const STORY = 'ui-button--primary';
/** The mocked pxsig server, and the default port the addon also tries (always refused here). */
const SERVER = 'http://pxsig.test';
const DEFAULT = 'http://127.0.0.1:6070';

// Playwright's Browser, once launched (its types are not this package's).
let browser = null;
let skip = false;
/** @type {string | null} */
let out = null;
let app = '';
let html = '';

before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch(
      process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
    );
  } catch (e) {
    skip = noChromium(e);
    return;
  }
  const { build, version } = await import('vite');
  const stub = path.join(harness, 'storybook-stub.mjs');
  out = mkdtempSync(path.join(tmpdir(), 'pxsig-addon-'));
  await build({
    configFile: false,
    root: harness,
    logLevel: 'silent',
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        'storybook/manager-api': stub,
        'storybook/internal/components': stub,
        'storybook/theming': stub,
      },
    },
    build: {
      outDir: out,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: {
          format: 'iife',
          ...(Number(version.split('.')[0]) >= 8 ? {} : { inlineDynamicImports: true }),
          entryFileNames: 'app.js',
        },
      },
    },
  });
  app = readFileSync(path.join(out, 'app.js'), 'utf8');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>panel</title></head><body><div id="root"></div><script src="app.js"></script></body></html>`;
});
after(async () => {
  await browser?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

const status = (/** @type {Record<string, unknown>} */ extra = {}) => ({
  workspaceId: 'ws-a',
  running: false,
  stories: {
    [STORY]: {
      status: 'changed',
      project: 'ui',
      entries: [{ id: `${STORY}@dark`, mode: 'dark', state: 'changed', ssim: 0.91 }],
    },
  },
  integrity: {},
  ...extra,
});
const snapshot = {
  format: 'pxsig-snapshot',
  version: 1,
  generatedAt: '2026-10-27T20:00:00.000Z',
  commit: 'e8b417d1b2fd',
  shallow: false,
  uncommitted: false,
  projects: {
    ui: {
      stories: {
        [STORY]: {
          entries: [
            {
              id: `${STORY}@dark`,
              mode: 'dark',
              state: null,
              baseline: true,
              approved: {
                at: '2026-10-25T02:03:15.421Z',
                event: 'approved',
                pr: 137,
                commit: 'a2041a6',
                kind: 'colour',
                reason: 'border',
              },
              env: { browser: 'chromium 145', os: 'linux x64', container: 'pxsig:0.7.1-pw1.58.2' },
              a11y: [],
            },
          ],
          history: [],
        },
      },
    },
  },
};

/**
 * Open the panel at `origin` (its hostname decides live or snapshot mode), with the preset's
 * `window.__PXSIG__`. `server`: the mocked server's status answer, or null for none.
 * @param {{ origin: string, story?: string, server?: object | null, snap?: object | null, pinned?: string[] }} o
 */
async function open({ origin, story = STORY, server = null, snap = null, pinned = [SERVER] }) {
  const page = await browser.newPage();
  /** @type {{ method: string, url: string, body: string | null }[]} */
  const requests = [];
  await page.addInitScript((servers) => {
    /** @type {{ __PXSIG__?: unknown }} */ (window).__PXSIG__ = { servers, workspaceId: 'ws-a' };
  }, pinned);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    requests.push({ method: req.method(), url: req.url(), body: req.postData() });
    if (url.origin === new URL(origin).origin) {
      if (url.pathname.endsWith('/app.js'))
        return route.fulfill({ contentType: 'text/javascript', body: app });
      if (url.pathname.endsWith('/pxsig-snapshot.json'))
        return snap
          ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(snap) })
          : route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (url.origin === SERVER && server) {
      if (url.pathname === '/__pxsig/status')
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(server) });
      if (url.pathname === '/__pxsig/events')
        return route.fulfill({
          contentType: 'text/event-stream',
          body: 'event: hello\ndata: {}\n\n',
        });
      if (url.pathname === '/__pxsig/check') return route.fulfill({ status: 202, body: '{}' });
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>inspector</title>',
      });
    }
    // Anything else, the default port included, is refused in the browser.
    return route.abort();
  });
  await page.goto(`${origin}/?story=${encodeURIComponent(story)}&theme=dark`);
  return { page, requests };
}

test("live: the story's result, the actions, the embedded inspector and the sidebar dot", async (t) => {
  if (skip) return t.skip(skip);
  const { page, requests } = await open({ origin: 'http://127.0.0.1:9', server: status() });
  await page.getByText('pxsig: changed').waitFor();
  assert.ok(await page.getByText('dark changed').isVisible());
  for (const name of ['Check story', 'Check all', 'Open dashboard'])
    assert.ok(await page.getByRole('button', { name }).isEnabled(), name);
  const src = await page.getByTitle('pxsig inspector').getAttribute('src');
  assert.equal(src, `${SERVER}/report/?embed=1&story=${STORY}&theme=dark`);
  const dots = await page.evaluate(
    () => /** @type {{ __statuses?: unknown }} */ (window).__statuses
  );
  assert.deepEqual(dots, [
    {
      storyId: STORY,
      typeId: 'pxsig',
      value: 'status-value:warning',
      title: 'pxsig: changed',
      description: 'dark: changed · ssim 0.91',
    },
  ]);
  await Promise.all([
    page.waitForRequest(`${SERVER}/__pxsig/check`),
    page.getByRole('button', { name: 'Check story' }).click(),
  ]);
  const post = requests.find((r) => r.url === `${SERVER}/__pxsig/check`);
  assert.equal(post?.method, 'POST');
  assert.deepEqual(JSON.parse(post?.body ?? '{}'), { story: STORY });
  await page.close();
});

test('live: while a check runs, the actions wait', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open({ origin: 'http://127.0.0.1:9', server: status({ running: true }) });
  await page.getByText('Checking…').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Check story' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Check all' }).isDisabled(), true);
  await page.close();
});

test("live: no server, or another workspace's, and the panel says how to start one", async (t) => {
  if (skip) return t.skip(skip);
  for (const server of [null, status({ workspaceId: 'ws-b' })]) {
    const { page } = await open({ origin: 'http://127.0.0.1:9', server });
    await page.getByText('The pxsig server is not running.').waitFor();
    assert.ok(await page.getByText('npx pxsig serve --watch').isVisible());
    assert.equal(await page.getByTitle('pxsig inspector').count(), 0);
    await page.close();
  }
});

test('deployed: the read-only snapshot, and no request to any pxsig server', async (t) => {
  if (skip) return t.skip(skip);
  const { page, requests } = await open({
    origin: 'http://storybook.example',
    server: status(),
    snap: snapshot,
  });
  await page.getByText('pxsig · read-only · built from e8b417d1b2fd, 2026-10-27').waitFor();
  assert.ok(await page.getByRole('cell', { name: '#137' }).isVisible());
  assert.ok(await page.getByText('Nothing logged.').isVisible());
  const other = await open({
    origin: 'http://storybook.example',
    story: 'ui-card--default',
    snap: snapshot,
  });
  await other.page.getByText('No visual baseline for this story.').waitFor();
  for (const { url } of [...requests, ...other.requests])
    assert.ok(!url.startsWith(SERVER) && !url.startsWith(DEFAULT), url);
  await page.close();
  await other.page.close();
});

test('deployed without a snapshot: the panel says it makes no connection', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open({ origin: 'http://storybook.example' });
  await page.getByText('pxsig: not connected on this Storybook').waitFor();
  assert.ok(
    await page
      .getByText(/served from storybook\.example, so the panel makes no connection/)
      .isVisible()
  );
  await page.close();
});
