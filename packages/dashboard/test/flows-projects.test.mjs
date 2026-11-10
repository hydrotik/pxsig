/**
 * A server with several projects, in a real browser against a mocked server (flows-helpers.mjs):
 * a bare `/report/` opens on the first project (pxsig.workspace.json's order), shows the project
 * picker and names the project in the URL, with the hash kept; its writes name that project. A URL
 * that names a project keeps it; one project keeps its URL as it was. The mocked `/__pxsig/data`
 * refuses a request without a project, as the server does. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

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

/** @param {string} name @param {string} label */
const project = (name, label) => ({
  name,
  label,
  root: `packages/${name}`,
  entries: 2,
  integrity: null,
});

/**
 * Two projects, `demo` first; every `/__pxsig/data` request is recorded by its `project`.
 * @param {(string | null)[]} asked
 */
const twoProjects = (asked) => async (/** @type {import('playwright').Page} */ page) => {
  await page.route('**/__pxsig/projects', (route) =>
    route.fulfill({ json: { projects: [project('demo', 'Demo'), project('docs', 'Docs')] } })
  );
  await page.route('**/__pxsig/data*', (route) => {
    const p = new URL(route.request().url()).searchParams.get('project');
    asked.push(p);
    return p
      ? route.fulfill({ json: { ...d, project: p } })
      : route.fulfill({ status: 400, json: { error: 'name a project (projects: demo, docs)' } });
  });
};

test('a bare /report/ with several projects opens on the first, with the picker and the project in the URL', async (t) => {
  if (skip) return t.skip(skip);
  /** @type {(string | null)[]} */
  const asked = [];
  const { page, posts } = await open(d, {
    hash: '#tab=stories',
    routes: twoProjects(asked),
    answers: { check: { ok: true, queued: [id] } },
  });
  try {
    const picker = page.getByRole('combobox', { name: 'Project' });
    await picker.waitFor();
    assert.match((await picker.textContent()) ?? '', /Demo/);
    assert.deepEqual([...new Set(asked)], ['demo'], 'never a request without a project');
    const u = new URL(page.url());
    assert.equal(u.searchParams.get('project'), 'demo');
    assert.equal(u.hash, '#stories', 'the section is kept');
    // A write from this page names the project it shows.
    const card = page.getByRole('group', { name: id });
    await card.getByRole('button', { name: 'Re-check' }).click();
    await card.getByRole('button', { name: /Checking/ }).waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'check')?.body, { project: 'demo', ids: [id] });
    // A reload keeps the project.
    asked.length = 0;
    await page.reload();
    await picker.waitFor();
    assert.deepEqual([...new Set(asked)], ['demo']);
  } finally {
    await page.close();
  }
});

test('a URL that names a project opens on it; one project keeps its URL as it was', async (t) => {
  if (skip) return t.skip(skip);
  /** @type {(string | null)[]} */
  const asked = [];
  const named = await open(d, { hash: '?project=docs#overview', routes: twoProjects(asked) });
  try {
    await named.page.getByRole('combobox', { name: 'Project' }).waitFor();
    assert.deepEqual([...new Set(asked)], ['docs']);
    assert.equal(new URL(named.page.url()).searchParams.get('project'), 'docs');
  } finally {
    await named.page.close();
  }
  const one = await open(d, { hash: '#overview' });
  try {
    await one.page.getByRole('navigation', { name: 'Report sections' }).waitFor();
    assert.equal(new URL(one.page.url()).search, '', 'one project: no ?project= is added');
    assert.equal(await one.page.getByRole('combobox', { name: 'Project' }).count(), 0);
  } finally {
    await one.page.close();
  }
});
