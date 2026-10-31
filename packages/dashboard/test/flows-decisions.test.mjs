/**
 * The dashboard's decisions in a real browser, against a mocked server (see flows-helpers.mjs): a
 * render error's re-check, the inspector's approvals (Approve story only with `approvals.byStory`;
 * Reject and Approve in the same place in every state), the dashboard link, a decision without it,
 * and the Storybook panel's small window. Nothing here can write a baseline: every /__pxsig/
 * request is answered by page.route. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, browser, skip, base, open } from './flows-helpers.mjs';

setupFlows();

/** The data with `approvals.byStory` on: the inspector offers Approve story. */
const withByStory = (/** @type {Parameters<typeof data>[0]} */ o) => ({
  ...data(o),
  approvals: { byStory: true },
});

test('a render error card offers a re-check of that entry', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-button--broken';
  const d = data({
    rows: [
      row('ui-button--ok'),
      row(id, { pass: false, metrics: null, error: 'locator.click: Timeout 5000ms exceeded' }),
    ],
    entries: [
      entry('ui-button--ok'),
      entry(id, [{ code: 'render-error', severity: 'error', reason: 'timeout' }]),
    ],
  });
  const { page, posts } = await open(d, {
    hash: '#tab=stories',
    answers: { check: { ok: true, queued: [id] } },
  });
  try {
    const card = page.getByRole('group', { name: id });
    await card.waitFor();
    await card.getByRole('button', { name: 'Re-check' }).click();
    await card.getByRole('button', { name: /Checking/ }).waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'check')?.body, { project: 'demo', ids: [id] });
  } finally {
    await page.close();
  }
});

test("with approvals.byStory, the inspector approves a story's entries together, and re-checks one entry", async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = withByStory({
    rows: [
      row(story, changed),
      row(`${story}@light`, { ...changed, mode: 'light' }),
      row('ui-button--ok'),
    ],
    entries: [
      entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }]),
      entry(`${story}@light`, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }]),
      entry('ui-button--ok'),
    ],
  });
  const { page, posts } = await open(d, {
    hash: `#inspect=${story}`,
    answers: {
      'approve-story': {
        ok: true,
        story,
        batch: 'b1',
        approved: [story, `${story}@light`],
        skipped: [],
      },
      check: { ok: true, queued: [story] },
    },
  });
  try {
    const button = page.getByRole('button', { name: 'Approve story · 2 entries' });
    await button.waitFor();
    await button.click();
    await page.getByText(`Approved 2 entries of ${story}.`).waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'approve-story')?.body, {
      project: 'demo',
      story,
    });
    await page.getByRole('button', { name: 'Re-check' }).click();
    await page.getByText('Queued 1 entry').waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'check')?.body, {
      project: 'demo',
      ids: [story],
    });
    assert.equal(
      posts.filter((p) => p.name === 'approve').length,
      0,
      'no single approvals were sent'
    );
  } finally {
    await page.close();
  }
});

test('Reject and Approve keep their place whatever else the review group shows', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
  const a11y = { violations: [{ id: 'color-contrast', impact: 'serious' }], new: 2, baseline: [] };
  /** Each state the group can be in, as the data that puts the inspector on `story` in it. */
  const states = {
    fresh: data({ rows: [row(story, changed)], entries: [entry(story, issue)] }),
    'story siblings, byStory off': data({
      rows: [row(story, changed), row(`${story}@light`, { ...changed, mode: 'light' })],
      entries: [entry(story, issue), entry(`${story}@light`, issue)],
    }),
    'story siblings, Approve story shown': withByStory({
      rows: [row(story, changed), row(`${story}@light`, { ...changed, mode: 'light' })],
      entries: [entry(story, issue), entry(`${story}@light`, issue)],
    }),
    'after a decision (Undo shown)': {
      ...data({ rows: [row(story, changed)], entries: [entry(story, issue)] }),
      review: { [story]: { state: 'rejected', at: '2026-10-24T10:00:00.000Z' } },
    },
    'new a11y violations (the note shown)': data({
      rows: [row(story, { ...changed, a11y })],
      entries: [entry(story, issue)],
    }),
  };
  /** @type {Record<string, { approve: unknown, reject: unknown }>} */
  const boxes = {};
  for (const [name, d] of Object.entries(states)) {
    const { page } = await open(d, { hash: `#inspect=${story}` });
    try {
      // The header's: the first in the dialog (the a11y section below has its own Reject).
      const button = (/** @type {string} */ label) =>
        page.getByRole('dialog').getByRole('button', { name: label, exact: true }).first();
      await button('Approve').waitFor();
      const box = async (/** @type {string} */ label) => {
        const b = await button(label).boundingBox();
        return b && [b.x, b.y, b.width, b.height].map(Math.round);
      };
      boxes[name] = { approve: await box('Approve'), reject: await box('Reject') };
      if (name === 'story siblings, byStory off')
        assert.equal(
          await page.getByRole('button', { name: /Approve story/ }).count(),
          0,
          'no Approve story without approvals.byStory'
        );
      if (name === 'story siblings, Approve story shown')
        await page.getByRole('button', { name: 'Approve story · 2 entries' }).waitFor();
    } finally {
      await page.close();
    }
  }
  const [first, ...rest] = Object.entries(boxes);
  for (const [name, b] of rest) assert.deepEqual(b, first[1], `${name} vs ${first[0]}`);
});

// --- the dashboard link ----------------------------------------------------------------------------

test('without the dashboard link the inspector says Read only up front, and the buttons stay, disabled', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const command = 'pnpm exec pxsig serve --link';
  const where = { cwd: '/work/demo', command };
  const ro = await open(d, { hash: `#inspect=${story}`, approving: { allowed: false, ...where } });
  try {
    // The top bar's Read only badge needs a live event stream, which page.route cannot hold open;
    // `pxsig dashboard check` renders it (shell.top-bar's readOnly and canApprove screens).
    const approve = ro.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor();
    assert.equal(await approve.isDisabled(), true);
    assert.match(String(await approve.getAttribute('title')), /^Read only/);
    await ro.page.getByText(`cd "/work/demo" && ${command}`).first().waitFor();
    await ro.page
      .getByText(/within two minutes; it works once/)
      .first()
      .waitFor();
    assert.equal(ro.posts.length, 0, 'nothing was sent');
  } finally {
    await ro.page.close();
  }
  const ok = await open(d, { hash: `#inspect=${story}`, approving: { allowed: true, ...where } });
  try {
    const approve = ok.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor();
    assert.equal(await approve.isDisabled(), false);
    assert.equal(await ok.page.getByText(/^Read only/).count(), 0);
  } finally {
    await ok.page.close();
  }
});

test('the dashboard link: its ticket is traded once and leaves the address bar', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const { page, posts } = await open(d, { hash: `#inspect=${story}&ticket=${'a'.repeat(64)}` });
  try {
    await page.getByRole('button', { name: 'Approve' }).first().waitFor();
    await page.waitForFunction(() => !location.hash.includes('ticket'));
    assert.deepEqual(
      posts.filter((p) => p.name === 'session').map((p) => p.body),
      [{ ticket: 'a'.repeat(64) }]
    );
    assert.ok(page.url().includes(`inspect=${story}`), 'the rest of the address stays');
    // The link pasted into this tab, which is already on the dashboard: only the fragment changes.
    const traded = page.waitForRequest(
      (r) => r.url().endsWith('/__pxsig/session') && r.postDataJSON()?.ticket === 'b'.repeat(64)
    );
    await page.evaluate(
      (t) => (location.hash = `inspect=ui-button--primary&ticket=${t}`),
      'b'.repeat(64)
    );
    await traded;
    await page.waitForFunction(() => !location.hash.includes('ticket'));
    assert.deepEqual(
      posts.filter((p) => p.name === 'session').map((p) => p.body.ticket.slice(0, 1)),
      ['a', 'b']
    );
  } finally {
    await page.close();
  }
});

test('a decision without the dashboard link says how to get it, under the header', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const { page } = await open(d, {
    hash: `#inspect=${story}`,
    answers: {
      approve: {
        status: 403,
        json: { error: 'approving here needs the dashboard link', code: 'needs-dashboard-link' },
      },
    },
  });
  try {
    let alerted = null;
    page.on('dialog', (dl) => ((alerted = dl.message()), dl.dismiss()));
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page
      .getByText(/^Read only: approving needs the dashboard link\. Run pxsig serve --link/)
      .waitFor();
    assert.equal(alerted, null, 'no alert: the line under the header says it');
  } finally {
    await page.close();
  }
});

test('the Storybook panel decides through a small window of the server, which closes when done', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const posts = [];
  // What the framed page asked the server and what it was answered: on Windows this test once
  // timed out with the Approve button never shown (a hang, not a slow runner: it passes in ~1 s
  // there). If it happens again, the failure says which request was left unanswered.
  const asked = [];
  const pageErrors = [];
  context.on('weberror', (e) => pageErrors.push(String(e.error().message).split('\n')[0]));
  await context.route('**/__pxsig/**', async (route) => {
    const req = route.request();
    const name = new URL(req.url()).pathname.replace('/__pxsig/', '');
    asked.push(`${req.method()} ${name}`);
    if (name === 'events')
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'retry: 60000\nevent: hello\ndata: {}\n\n',
      });
    if (name === 'data') return route.fulfill({ json: d });
    if (name === 'projects')
      return route.fulfill({
        json: { projects: [{ name: 'demo', root: '.', entries: 1, integrity: null }] },
      });
    if (req.method() === 'POST') {
      posts.push({ name, body: req.postDataJSON(), from: req.frame().url() });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await context.route('**/p/demo/**', (route) => route.fulfill({ status: 404, body: '' }));
  // Storybook, on another site (localhost, another port: as the addon frames it), framing the inspector.
  const storybook = createServer((req, res) =>
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        `<!doctype html><iframe id="panel" style="width:1200px;height:800px" src="${base}/report/?embed=1&story=${story}"></iframe>`
      )
  );
  await new Promise((ok) => storybook.listen(0, '127.0.0.1', ok));
  const host = await context.newPage();
  try {
    await host.goto(`http://localhost:${storybook.address().port}/`);
    const panel = host.frameLocator('#panel');
    try {
      await panel.getByRole('button', { name: 'Approve', exact: true }).waitFor();
    } catch (e) {
      const frame = host.frames().find((f) => f !== host.mainFrame());
      const text = await frame
        ?.evaluate(() => document.body?.innerText.slice(0, 200) ?? '')
        .catch((err) => `(unreadable: ${String(err)})`);
      throw new Error(
        `${String(e)}\nframe: ${frame?.url() ?? '(none)'}\nframe text: ${JSON.stringify(text)}\n` +
          `routed: ${asked.join(', ') || '(none)'}\npage errors: ${pageErrors.join(' | ') || '(none)'}`,
        { cause: e }
      );
    }
    const opened = context.waitForEvent('page');
    await panel.getByRole('button', { name: 'Approve', exact: true }).click();
    const win = await opened;
    assert.match(win.url(), /\/report\/\?decide=1$/);
    await win.waitForEvent('close');
    const decision = posts.find((p) => p.name === 'approve');
    assert.deepEqual(decision?.body, { project: 'demo', id: story });
    assert.match(decision.from, /\?decide=1$/, 'posted by the small window, not by the frame');
  } finally {
    await context.close();
    storybook.close();
  }
});
