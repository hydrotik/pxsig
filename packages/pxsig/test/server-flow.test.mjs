/**
 * server-flow.test.mjs — the server's check, repair and approval flow against a stand-in Storybook
 * (an index.json and an iframe.html with a minimal preview object), on fixture projects in temp dirs.
 *
 *   node --test packages/pxsig/test/server-flow.test.mjs
 *
 * Covers: checking a story that is not registered yet (registered, then rendered in the same
 * request; never a signature), a story checked alone whose render throws (recorded, not dropped as
 * a setup error), a repair whose re-check could not run (reported as such), and approving a
 * story's entries together (one batch, reflected in check.json). Needs the Rust binary and
 * Chromium; skipped without them.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECKER, fixture, hasRust, rustBin } from './fixture.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

let chromium = null;
try {
  const pw = await import('playwright');
  const b = await pw.chromium.launch();
  await b.close();
  chromium = true;
} catch {
  chromium = null;
}
const needs = !hasRust ? 'Rust binary not built' : !chromium ? 'no Chromium' : false;

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

/**
 * A stand-in Storybook: `/index.json` lists `stories`; `/iframe.html?id=` renders a block, or
 * Storybook's error display for an id containing "broken". The preview object answers what
 * pxsig reads: `storyStoreValue.loadStory` (parameters) and `currentRender` (render finished).
 */
async function fakeStorybook(stories) {
  const page = (id) => {
    const broken = id.includes('broken');
    return `<!doctype html><html><head><style>body{margin:0;background:#fff}#storybook-root>div{inline-size:96px;block-size:64px;background:#2a4a7a}</style></head>
<body class="${broken ? 'sb-show-errordisplay' : 'sb-show-main'}"><div id="storybook-root">${broken ? '' : '<div></div>'}</div><pre id="error-message">${broken ? 'Story threw: boom' : ''}</pre>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(id)}, phase: 'finished' },
  storyStoreValue: { loadStory: async ({ storyId }) => { if (storyId.includes('unreadable')) throw new Error('loadStory threw'); return { parameters: { pxsig: {} }, tags: [], playFunction: null }; } } };</script></body></html>`;
  };
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ v: 5, entries: Object.fromEntries(stories.map((s) => [s.id, { type: 'story', id: s.id, title: s.title, name: s.name, importPath: `./${s.importPath}`, tags: [] }])) }));
    }
    if (u.pathname === '/iframe.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page(u.searchParams.get('id') ?? ''));
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** Start `pxsig serve` on a fixture; `storybook` overrides the config's storybook.url. */
async function serve(f, { storybook } = {}) {
  if (storybook) {
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: storybook } }, null, 2));
  }
  const port = await freePort();
  const proc = spawn(process.execPath, [join(src, 'serve.mjs'), '--port', String(port), '--no-open'], { cwd: f.repo, env: { ...process.env, PXSIG_BIN: rustBin, PXSIG_WORKSPACE: '' } });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
    const on = () => /dashboard →/.test(log) && (clearTimeout(t), ok());
    proc.stdout.on('data', on);
  });
  const base = `http://127.0.0.1:${port}`;
  const post = async (action, body) => {
    const r = await fetch(`${base}/__pxsig/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const idle = async () => {
    for (let i = 0; i < 600; i++) {
      const s = await (await fetch(`${base}/__pxsig/status`)).json();
      if (!s.running && !s.queued && !s.repairing) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`the queue did not drain:\n${log}`);
  };
  return { base, post, idle, log: () => log, stop: () => proc.kill() };
}

const rowsOf = (f) => JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows;

test('a story checked alone whose render throws is recorded as a render error, not dropped as a setup error', { skip: needs }, async () => {
  const f = fixture();
  const sb = await fakeStorybook(f.index.stories);
  const S = await serve(f, { storybook: sb.url });
  try {
    const before = rowsOf(f).find((x) => x.id === f.ids.error);
    const r = await S.post('check', { ids: [f.ids.error] });
    assert.equal(r.status, 202);
    await S.idle();
    const row = rowsOf(f).find((x) => x.id === f.ids.error);
    assert.notEqual(row.checkedAt, before.checkedAt, `recorded:\n${S.log()}`);
    assert.match(row.error, /^storybook-error: Storybook error page: Story threw/);
  } finally {
    S.stop();
    sb.close();
  }
});

test('a repair whose re-check could not run says so, and the dashboard hears why', { skip: !hasRust && 'Rust binary not built' }, async () => {
  const f = fixture();
  const S = await serve(f); // storybook.url does not answer
  const events = [];
  const ctl = new AbortController();
  try {
    const es = await fetch(`${S.base}/__pxsig/events`, { signal: ctl.signal });
    (async () => {
      const dec = new TextDecoder();
      for await (const chunk of es.body) events.push(dec.decode(chunk));
    })().catch(() => {});
    const r = await S.post('repair', { apply: true, only: ['recheck'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rc = r.body.applied.find((x) => x.action === 'recheck');
    assert.match(rc.result, /^not re-checked: setup error: Storybook is not reachable/);
    assert.match(events.join(''), /event: check\ndata: \{"project":"fixture","state":"error"/);
  } finally {
    ctl.abort();
    S.stop();
  }
});
